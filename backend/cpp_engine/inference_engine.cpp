#include <pybind11/pybind11.h>
#include <pybind11/stl.h> // 极其重要！用于自动转换 Python list 和 C++ std::vector
#include <opencv2/opencv.hpp>
#include <cuda_runtime_api.h>
#include "NvInfer.h"
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>
#include <queue>
#include <mutex>
#include <condition_variable>


namespace py = pybind11;

// ==========================================
// 1. 定义数据结构 (用于传回 Python)
// ==========================================
struct Detection {
    std::vector<float> bbox; // [x1, y1, x2, y2]
    float score;              // 置信度
    int class_id;            // 类别 ID
    std::string class_name;  // 类别名称
};

// 单张图片的处理结果，包含耗时统计
struct ImageResult {
    std::string image_path;
    std::vector<Detection> detections;
    float pre_process_ms = 0.0f;
    float infer_ms = 0.0f; // 由 cudaEvent 统计
    float post_process_ms = 0.0f;
};

// 预处理后的数据载体 (用于生产者-消费者队列)
struct PreprocessedData {
    std::string image_path;
    std::vector<float> blob_data; // 存放处理好的连续 CHW 浮点流
    int left = 0;
    int top = 0;
    float scale_factor = 1.0f;
    float pre_ms;
    bool is_eof = false; // 结束标志
};

std::tuple<std::vector<float>, int, int, float> preprocess_image(const cv::Mat& image, int input_width, int input_height) {
    // 将图像缩放到输入尺寸，保持宽高比
    float original_height = image.rows;
    float original_width = image.cols;
    float aspect_ratio = original_width / original_height;
    std::cout << "[Preprocess Info] Original image (h, w) : " << original_height << ", " << original_width << ", " << "Aspect ratio: " << aspect_ratio<< std::endl;
    float new_width = input_width;
    float new_height = input_width / aspect_ratio;
    if (new_height > input_height) {
        new_height = input_height;
        new_width = input_height * aspect_ratio;
    }
    cv::Mat resized_image;
    cv::resize(image, resized_image, cv::Size(static_cast<int>(new_width), static_cast<int>(new_height)), 0, 0, cv::INTER_LINEAR);
    float scale_factor = resized_image.cols / original_width;
    std::cout << "[Preprocess Info] Resized image (h, w): " << resized_image.rows << ", " << resized_image.cols << ", " << "Scale factor: " << scale_factor << std::endl;
    
    // 将图像填充为输入尺寸，保持宽高比
    int top = (input_height - new_height) / 2;
    int bottom = input_height - new_height - top;
    int left = (input_width - new_width) / 2;
    int right = input_width - new_width - left;
    cv::Mat letterbox_image;
    cv::copyMakeBorder(resized_image, letterbox_image, top, bottom, left, right, cv::BORDER_CONSTANT, cv::Scalar(114, 114, 114));
    std::cout << "[Preprocess Info] Letterbox image (h, w): " << letterbox_image.rows << ", " << letterbox_image.cols << std::endl;

    // 将图像转换为RGB格式
    cv::cvtColor(letterbox_image, letterbox_image, cv::COLOR_BGR2RGB);

    // 将图像转换为浮点数,归一化到0-1
    cv::Mat float_image;
    letterbox_image.convertTo(float_image, CV_32F);
    float_image = float_image / 255.0;

    // 将图像转换为NCHW格式
    cv::Mat nchw_image;
    cv::dnn::blobFromImage(float_image, nchw_image, 1.0, cv::Size(input_width, input_height), cv::Scalar(0, 0, 0), false, false);

    // 将图像转换为向量
    std::vector<float> input_data(nchw_image.total() * nchw_image.channels());
    memcpy(input_data.data(), nchw_image.data, nchw_image.total() * nchw_image.channels() * sizeof(float));
    return std::make_tuple(input_data, left, top, scale_factor);
}


float compute_iou(const std::vector<float>& bbox1, const std::vector<float>& bbox2) {
    float x1 = std::max(bbox1[0], bbox2[0]);
    float y1 = std::max(bbox1[1], bbox2[1]);
    float x2 = std::min(bbox1[2], bbox2[2]);
    float y2 = std::min(bbox1[3], bbox2[3]);
    float intersection_area = std::max(0.0f, x2 - x1) * std::max(0.0f, y2 - y1);
    float area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1]);
    float area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1]);
    float union_area = area1 + area2 - intersection_area;
    if (union_area <= 0.0f) {
        return 0.0f;
    }
    return intersection_area / union_area;
}

std::vector<Detection> nms(const std::vector<Detection>& input_detections, float iou_threshold) {
    std::vector<Detection> result;
    if (input_detections.empty()) {
        return result;
    }
    std::vector<Detection> detections = input_detections; // 先拷贝一份
    std::sort(detections.begin(), detections.end(), [](const Detection& a, const Detection& b) {
        return a.score > b.score;
    });
    
    std::vector<bool> keep(detections.size(), false);
    for (int i = 0; i < detections.size(); i++) {
        if (keep[i]) {
            continue;
        }
        result.emplace_back(detections[i]);
        for (int j = i + 1; j < detections.size(); j++) {
            if (keep[j]) {
                continue;
            }
            // 只对同一类别做 NMS
            if (detections[i].class_id != detections[j].class_id) {
                continue;
            }
            if (compute_iou(detections[i].bbox, detections[j].bbox) > iou_threshold) {
                keep[j] = true;
            }
        }
    }
    return result;
}

std::vector<Detection> postprocess(
    const cv::Mat& bboxes, 
    const cv::Mat& scores, 
    float nms_iou_thr) {
    std::cout << "[Postprocess Info] Bboxes shape: " << bboxes.rows << " x " << bboxes.cols << std::endl;
    std::cout << "[Postprocess Info] Scores shape: " << scores.rows << " x " << scores.cols << std::endl;

    float conf_thr = 0.001f;
    int min_bbox_size = 10;
    int max_bbox_size = 4096;
    
    size_t num_bboxes = bboxes.rows;
    std::vector<Detection> detections;
    detections.reserve(num_bboxes);
    for (int i = 0; i < num_bboxes; i++) {
        float score = 0.0;
        int class_index;
        for (int j = 0; j < scores.cols; j++) {
            if (scores.at<float>(i, j) > score) {
                score = scores.at<float>(i, j);
                class_index = j;
            }
        }
        if (score > conf_thr) {
            float x1 = bboxes.at<float>(i, 0);
            float y1 = bboxes.at<float>(i, 1);
            float x2 = bboxes.at<float>(i, 2);
            float y2 = bboxes.at<float>(i, 3);
            if (x2 - x1 < min_bbox_size || y2 - y1 < min_bbox_size || x2 - x1 > max_bbox_size || y2 - y1 > max_bbox_size) {
                continue;
            }
            Detection det;
            det.class_id = class_index;
            det.score = score;
            det.bbox = {x1, y1, x2, y2};
            detections.emplace_back(det);
        }
    }
    std::vector<Detection> nms_detections = nms(detections, nms_iou_thr);


    std::cout << "[Postprocess Info] Detections size: " << detections.size() << std::endl;
    std::cout << "[Postprocess Info] NMS detections size: " << nms_detections.size() << std::endl;
   
    return nms_detections;
}

// ==========================================
// 2. 推理引擎类
// ==========================================

class TrtLogger : public nvinfer1::ILogger
{
public:
    void log(nvinfer1::ILogger::Severity severity, const char* msg) noexcept override
    {
        if (severity == nvinfer1::ILogger::Severity::kERROR)
        {
            std::cout << "TrtLogger Error: " << msg << std::endl;
        }
        else if (severity == nvinfer1::ILogger::Severity::kWARNING)
        {
            std::cout << "TrtLogger Warning: " << msg << std::endl;
        }
    }
};

class InferenceEngine {
public:
    InferenceEngine(
        const std::string& model_path,
        const std::vector<std::string> input_names,
        const std::vector<std::string> output_names,
        const std::vector<std::vector<int64_t>> input_sizes,
        const std::vector<std::vector<int64_t>> output_sizes,
        const std::vector<std::string> class_names,
        const float nms_iou_thr
    ) {
        input_names_ = input_names;
        output_names_ = output_names;
        input_sizes_ = input_sizes;
        output_sizes_ = output_sizes;
        class_names_ = class_names;
        nms_iou_thr_ = nms_iou_thr;

        std::ifstream file(model_path, std::ios::binary | std::ios::ate);
        if (!file.good()) {
            std::cerr << "Error: Cannot open engine file: " << model_path << std::endl;
            exit(-1);
        }
        size_t size = file.tellg();
        file.seekg(0, std::ios::beg);
        std::vector<char> engine_data(size);
        file.read(engine_data.data(), size);
        file.close();
    
        // 实例化 TRT Runtime 并反序列化模型
        runtime_ = nvinfer1::createInferRuntime(logger_);
        engine_ = runtime_->deserializeCudaEngine(engine_data.data(), engine_data.size());
        context_ = engine_->createExecutionContext();

        // 创建 CUDA 流 (用于异步内存拷贝和推理)
        cudaStreamCreate(&stream_);
        cudaEventCreate(&start_event_);
        cudaEventCreate(&stop_event_);
    
        // 在 GPU 上为输入和输出分配显存 (cudaMalloc)
        for (size_t i = 0; i < input_names_.size(); i++) {
            size_t size = 1;
            for (const auto& shape : input_sizes_[i]) {
                size *= shape;
            }
            input_elements_.emplace_back(size);
            cudaMalloc(&device_inputs_[i], size * sizeof(float));
        }
        for (size_t i = 0; i < output_names_.size(); i++) {
            size_t size = 1;
            for (const auto& shape : output_sizes_[i]) {
                size *= shape;
            }
            output_elements_.emplace_back(size);
            cudaMalloc(&device_outputs_[i], size * sizeof(float));
            host_outputs_.emplace_back(size);
        }

        std::cout << "[Engine Info] TensorRT Engine initialized successfully!" << std::endl;

    }

    ~InferenceEngine() {
        for (void* device_input : device_inputs_) {
            cudaFree(device_input);
        }
        for (void* device_output : device_outputs_) {
            cudaFree(device_output);
        }
        for (std::vector<float> host_output : host_outputs_) {
            cudaFreeHost(host_output.data());
        }

        cudaStreamDestroy(stream_);
        cudaEventDestroy(start_event_);
        cudaEventDestroy(stop_event_);

        if (context_) delete context_;
        if (engine_) delete engine_;
        if (runtime_) delete runtime_;

        std::cout << "[Engine Info] TensorRT Engine destroyed successfully!" << std::endl;
    }
    // 核心函数：接收图片路径列表，返回嵌套的结果列表c
    std::vector<ImageResult> infer_from_paths(const std::vector<std::string>& image_paths) {
        std::vector<ImageResult> final_results;

        py::gil_scoped_release release;
        std::queue<PreprocessedData> data_queue;
        std::mutex queue_mtx;
        std::condition_variable queue_cv;

        int64_t input_width = input_sizes_[0][3];
        int64_t input_height = input_sizes_[0][2];
        
        // ---------------------------------------------------------
        // 线程 1：生产者 (负责 OpenCV I/O 和 CPU 预处理)
        // ---------------------------------------------------------
        std::thread producer([&]() {
            for (const auto& image_path : image_paths) {
                auto t0 = std::chrono::high_resolution_clock::now();

                cv::Mat image = cv::imread(image_path);
                if (image.empty()) {
                    std::cerr << "[C++] 警告: 无法读取图片: " << image_path << std::endl;
                    continue;
                }
                std::vector<float> input_data;
                int left, top;
                float scale_factor;
                std::tie(input_data, left, top, scale_factor) = preprocess_image(image, input_width, input_height);

                auto t1 = std::chrono::high_resolution_clock::now();
                float pre_ms = std::chrono::duration<float, std::milli>(t1 - t0).count();

                // 压入队列
                {
                    std::lock_guard<std::mutex> lock(queue_mtx);
                    data_queue.push({image_path, std::move(input_data), left, top, scale_factor, pre_ms, false});
                }
                queue_cv.notify_one();
            }

            // 发送结束信号
            {
                std::lock_guard<std::mutex> lock(queue_mtx);
                data_queue.push({"", std::vector<float>(), 0, 0, 1.0f, 0.0f, true});
            }
            queue_cv.notify_one();
        });

        // ---------------------------------------------------------
        // 线程 2：消费者 (负责 CUDA 传输、TRT 推理、后处理)
        // ---------------------------------------------------------
        std::thread consumer([&]() {
            while (true) {
                PreprocessedData data;
                {
                    std::unique_lock<std::mutex> lock(queue_mtx);
                    queue_cv.wait(lock, [&]() { return !data_queue.empty(); });
                    data = data_queue.front();
                    data_queue.pop();
                }

                if (data.is_eof) break;

                ImageResult result;
                result.image_path = data.image_path;
                result.pre_process_ms = data.pre_ms;
                int left = data.left;
                int top = data.top;
                float scale_factor = data.scale_factor;
            
                cudaEventRecord(start_event_, stream_);

                cudaMemcpyAsync(
                    device_inputs_[0], 
                    data.blob_data.data(), 
                    input_elements_[0] * sizeof(float), 
                    cudaMemcpyHostToDevice, 
                    stream_);
                context_->setTensorAddress(
                    input_names_[0].c_str(), 
                    device_inputs_[0]);

                for (int i = 0; i < output_names_.size(); i++) {
                    context_->setTensorAddress(
                        output_names_[i].c_str(), 
                        device_outputs_[i]);
                }

                context_->enqueueV3(stream_);

                for (int i = 0; i < output_names_.size(); i++) {
                    cudaMemcpyAsync(
                        host_outputs_[i].data(), 
                        device_outputs_[i], 
                        output_elements_[i] * sizeof(float), 
                        cudaMemcpyDeviceToHost, 
                        stream_);
                }

                cudaEventRecord(stop_event_, stream_);
                cudaStreamSynchronize(stream_);
                cudaEventElapsedTime(&result.infer_ms, start_event_, stop_event_);

                auto t_post_0 = std::chrono::high_resolution_clock::now();
                // 后处理
                cv::Mat bboxes = cv::Mat(
                    output_sizes_[0][1], 
                    output_sizes_[0][3], 
                    CV_32F, (void*)host_outputs_[0].data());
                cv::Mat scores = cv::Mat(
                    output_sizes_[1][1], 
                    output_sizes_[1][2], 
                    CV_32F, (void*)host_outputs_[1].data());
                
                
                std::vector<Detection> detections = postprocess(bboxes, scores, nms_iou_thr_);
                for (int i = 0; i < detections.size(); i++) {
                    std::vector<float> bbox = detections[i].bbox;
                    bbox[0] = (bbox[0] - left) / scale_factor;
                    bbox[1] = (bbox[1] - top) / scale_factor;
                    bbox[2] = (bbox[2] - left) / scale_factor;
                    bbox[3] = (bbox[3] - top) / scale_factor;
                    // std::cout << bbox[0] << " " << bbox[1] << " " << bbox[2] << " " << bbox[3] << " " << detections[i].score << " " << class_names_[detections[i].class_id] << std::endl;
                    result.detections.emplace_back(Detection{bbox, detections[i].score, detections[i].class_id, class_names_[detections[i].class_id]});
                }

                auto t_post_1 = std::chrono::high_resolution_clock::now();
                result.post_process_ms = std::chrono::duration<float, std::milli>(t_post_1 - t_post_0).count();

                final_results.push_back(result);
            }
        });

        // 等待所有线程完成
        producer.join();
        consumer.join();

        return final_results;
    }

private:
    // TensorRT 运行时核心组件
    TrtLogger logger_;
    nvinfer1::IRuntime* runtime_{nullptr};
    nvinfer1::ICudaEngine* engine_{nullptr};
    nvinfer1::IExecutionContext* context_{nullptr};
    cudaStream_t stream_;
    cudaEvent_t start_event_;
    cudaEvent_t stop_event_;

    // 内存与显存管理
    std::vector<void*> device_inputs_{nullptr};        // GPU 输入显存
    std::vector<void*> device_outputs_{nullptr}; // GPU 输出显存 
    std::vector<std::vector<float>> host_outputs_; // CPU 输出数据

    std::vector<std::string> input_names_;
    std::vector<std::string> output_names_;
    std::vector<std::vector<int64_t>> input_sizes_;
    std::vector<std::vector<int64_t>> output_sizes_;
    std::vector<int64_t> input_elements_;
    std::vector<int64_t> output_elements_;

    std::vector<std::string> class_names_;
    float nms_iou_thr_;
};

// ==========================================
// 3. Pybind11 绑定定义
// ==========================================
PYBIND11_MODULE(inference_engine, m) {
    m.doc() = "High Performance C++ TensorRT Engine"; // 模块说明

    // 绑定 Detection 结构体
    py::class_<Detection>(m, "Detection")
        .def_readwrite("bbox", &Detection::bbox)
        .def_readwrite("score", &Detection::score)
        .def_readwrite("class_id", &Detection::class_id)
        .def_readwrite("class_name", &Detection::class_name);
    
    // 绑定 ImageResult 结构体
    py::class_<ImageResult>(m, "ImageResult")
        .def_readwrite("image_path", &ImageResult::image_path)
        .def_readwrite("detections", &ImageResult::detections)
        .def_readwrite("pre_process_ms", &ImageResult::pre_process_ms)
        .def_readwrite("infer_ms", &ImageResult::infer_ms)
        .def_readwrite("post_process_ms", &ImageResult::post_process_ms);

    // 绑定 InferenceEngine 类
    py::class_<InferenceEngine>(m, "InferenceEngine")
        .def(
            py::init<const std::string&,
            std::vector<std::string>,
            std::vector<std::string>,
            std::vector<std::vector<int64_t>>,
            std::vector<std::vector<int64_t>>,
            std::vector<std::string>,
            float
            >()) // 绑定构造函数
        .def("infer_from_paths", &InferenceEngine::infer_from_paths); // 绑定推理函数
}
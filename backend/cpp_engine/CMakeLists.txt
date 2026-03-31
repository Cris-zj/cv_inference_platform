cmake_minimum_required(VERSION 3.20)
project(inference_engine)

# 1. 设置 C++ 标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 2. 查找并使用 OpenCV 库、CUDA 库 和 TensorRT 核心库
find_package(OpenCV REQUIRED)
find_package(CUDAToolkit REQUIRED)

# 寻找头文件 (NvInfer.h)
find_path(TENSORRT_INCLUDE_DIR NvInfer.h
    HINTS 
    /usr/include/x86_64-linux-gnu 
    /usr/include 
    /usr/local/cuda/include
)

# 寻找动态库 (libnvinfer.so)
find_library(TENSORRT_LIBRARY nvinfer
    HINTS 
    /usr/lib/x86_64-linux-gnu 
    /usr/lib 
    /usr/local/cuda/lib64
)

# 严谨的错误检查
if(NOT TENSORRT_INCLUDE_DIR OR NOT TENSORRT_LIBRARY)
    message(FATAL_ERROR "💥 找不到 TensorRT！请检查当前 Docker 环境是否包含 TensorRT。")
else()
    message(STATUS "✅ 成功找到 TensorRT 头文件: ${TENSORRT_INCLUDE_DIR}")
    message(STATUS "✅ 成功找到 TensorRT 动态库: ${TENSORRT_LIBRARY}")
endif()

# 3. 查找 Pybind11
set(PYBIND11_FINDPYTHON ON)
find_package(pybind11 REQUIRED)


# 5. 指定头文件搜索路径
include_directories(${CMAKE_SOURCE_DIR})
include_directories(${OpenCV_INCLUDE_DIRS})
include_directories(${CUDAToolkit_INCLUDE_DIRS})
include_directories(${TENSORRT_INCLUDE_DIR})


# 4. 定义要生成的 Python 模块 (.so 文件)
pybind11_add_module(inference_engine inference_engine.cpp)

# 5. 链接 OpenCV 库
target_link_libraries(
    inference_engine 
    PRIVATE 
    ${OpenCV_LIBS} 
    CUDA::cudart
    ${TENSORRT_LIBRARY})

# 6. (可选) 编译完成自动复制到 FastAPI 的目录，方便 import
# 这一步极其有用！省去了手动复制的麻烦
add_custom_command(TARGET inference_engine POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
    $<TARGET_FILE:inference_engine>
    ${CMAKE_CURRENT_SOURCE_DIR}/../app/
    COMMENT "Copying compiled .so library to FastAPI app directory..."
)
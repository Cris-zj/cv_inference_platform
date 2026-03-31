import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// 1. 按照你提供的新 JSON 格式定义接口
interface ModelConfig {
  model_name: string;
  model_version: string;
  nms_iou_thr: number;
  score_thr: number; 
  min_bbox_size: number;
  class_names: string[];
}

export const InferencePage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- 状态管理 ---
  const [currentUsername, setCurrentUsername] = useState<string>(
    localStorage.getItem('username') || '');
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  
  const [files, setFiles] = useState<File[]>([]);
  const [isInferencing, setIsInferencing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [inferenceData, setInferenceData] = useState<any>(null);

  // 2. 真实网络请求：从后端 API 动态拉取配置文件
  useEffect(() => {
    const fetchModelsConfig = async () => {
      setIsLoadingModels(true);
      try {
        // 调用 FastAPI 后端接口
        const response = await fetch(`http://${window.location.hostname}:3061/api/models`);
        
        // 检查网络响应状态（非 200 状态码抛出异常）
        if (!response.ok) {
          throw new Error(`HTTP 请求错误！状态码: ${response.status}`);
        }
        
        // 解析后端返回的 JSON 数据
        const realServerData: ModelConfig[] = await response.json();
        
        setAvailableModels(realServerData);
      } catch (error) {
        console.error("加载模型配置失败", error);
        alert("无法连接到服务器读取模型配置！");
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchModelsConfig(); // 组件加载时自动执行
  }, []); // 空依赖数组，确保只在首次进入页面时请求一次

  // --- 处理文件与推理逻辑 ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const fileArray = Array.from(e.target.files).filter(file => 
        file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|bmp)$/i)
      );
      setFiles(fileArray);
      setProgress(0);
      setIsCompleted(false);
    }
  };

  const handleStartInference = async () => {
    if (files.length > 1000) {
      alert(`⚠️ 选中的图片数量 (${files.length}张) 过多！\n为了保证浏览器的稳定和推理速度，单次最多支持 1000 张图片。\n请分批次进行推理。`);
      return;
    }
    // 终极防御：如果没选模型或没选图片，直接拦截
    if (!selectedModel || files.length === 0) return;

    setIsInferencing(true);
    setProgress(0);
    setIsCompleted(false);

    // ==========================================
    // 1. 核心组装：使用 FormData 打包二进制文件和文本
    // ==========================================
    const formData = new FormData();
    
    // 放入模型路径 (后端需要凭这个去加载 C++ 引擎)
    formData.append('model_config_json', JSON.stringify(selectedModel));
    
    // 遍历所有选中的图片，全部追加到一个叫 'images' 的数组字段里
    files.forEach((file) => {
      formData.append('images', file);
    });

    try {
      // 2. 🚨 抛弃 fetch，使用 Promise 包装原生的 XMLHttpRequest
      const resultData = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `http://${window.location.hostname}:3061/api/inference/start`);

        // 设置登录 Token
        const token = localStorage.getItem('auth_token');
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        // ==========================================
        // 🌟 核心魔法：监听真实的物理上传进度
        // ==========================================
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            // event.loaded 是已上传的字节数，event.total 是总字节数
            // 我们把物理上传过程映射到 0% ~ 90% 的进度条上
            const percentComplete = Math.round((event.loaded / event.total) * 90);
            setProgress(percentComplete);
          }
        };

        // 请求成功完成后的回调
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            // 解析后端返回的 JSON 数据
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`推理引擎异常！状态码: ${xhr.status}`));
          }
        };

        // 网络级别报错的回调
        xhr.onerror = () => reject(new Error("无法连接到后端服务器，请检查网络"));

        // 正式发送数据！
        xhr.send(formData);
      });

      console.log("✅ 后端推理完成，返回数据:", resultData);

      // ==========================================
      // 3. 完美收尾
      // ==========================================
      setInferenceData(resultData);
      setProgress(100); // 瞬间拉满
      
      // 稍微延迟一下展示“推理完成”，视觉体验更平滑
      setTimeout(() => {
        setIsInferencing(false);
        setIsCompleted(true);
      }, 500);

    } catch (error: any) {
      console.error("推理请求失败:", error);
      alert(error.message || "无法连接到推理引擎，请检查后端状态。");
      setIsInferencing(false);
      setProgress(0); // 报错后重置进度条
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800 tracking-wide">方寸知微 - 输电检测平台</h1>
        <div className="flex items-center gap-4">
          {/* 👇 这里把写死的 Admin 换成我们的动态变量 currentUsername */}
          <span className="text-sm text-gray-500 font-medium">当前用户: <span className="text-blue-600">{currentUsername}</span></span>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-red-500 transition-colors">退出登录</button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：模型选择 (经典垂直列表布局) */}
        {/* 修复补丁：加入 self-start h-fit，去掉 min-h，防止网格拉伸空白 */}
        <div className="lg:col-span-7 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col self-start h-fit">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center shrink-0">
            <h2 className="text-lg font-semibold text-gray-800">1. 选择推理模型</h2>
            {isLoadingModels && <span className="text-sm text-blue-500 animate-pulse">正在加载配置...</span>}
          </div>
          
          {/* 修复补丁：将 flex-1 替换为 max-h-[350px]，超出高度才滚动，不再强行撑出空白 */}
          <div className="overflow-y-auto max-h-[350px]">
            {isLoadingModels ? (
              // 加载骨架屏
              <div className="p-6 space-y-4">
                <div className="h-12 bg-gray-100 rounded-lg animate-pulse w-full"></div>
                <div className="h-12 bg-gray-100 rounded-lg animate-pulse w-full"></div>
                <div className="h-12 bg-gray-100 rounded-lg animate-pulse w-3/4"></div>
              </div>
            ) : (
              <div className="flex flex-col">
                {availableModels.map((model) => {
                  const isSelected = selectedModel?.model_name === model.model_name;
                  return (
                    <button
                      key={model.model_name}
                      onClick={() => setSelectedModel(model)}
                      className={`w-full text-left px-6 py-4 border-b border-gray-100 last:border-b-0 transition-all flex items-center justify-between group ${
                        isSelected 
                          ? 'bg-blue-50/80 border-l-4 border-blue-600' 
                          : 'hover:bg-gray-50 border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* 选中时的圆点指示器 */}
                        <div className={`w-2 h-2 rounded-full transition-colors ${isSelected ? 'bg-blue-600' : 'bg-gray-300 group-hover:bg-blue-400'}`}></div>
                        <span className={`font-medium ${isSelected ? 'text-blue-800' : 'text-gray-700 group-hover:text-gray-900'}`}>
                          {model.model_name}
                        </span>
                      </div>
                      
                      {/* 选中时的对勾图标 */}
                      {isSelected && (
                        <span className="text-blue-600 font-bold">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          
          {selectedModel && (
            <div className="p-6 bg-gray-50/50 border-t border-gray-100 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-700">{selectedModel.model_name} | 相关参数</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 参数卡片 0：模型版本 */}
                <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow transition-shadow">
                  <div className="text-xs text-gray-500 mb-1">模型版本</div>
                  <div className="font-bold text-gray-800 text-lg">{selectedModel.model_version}</div>
                </div>

                {/* 参数卡片 1：NMS 阈值 */}
                <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow transition-shadow">
                  <div className="text-xs text-gray-500 mb-1">NMS 阈值 (IoU)</div>
                  <div className="font-bold text-gray-800 text-lg">{selectedModel.nms_iou_thr}</div>
                </div>
                
                {/* 参数卡片 2：置信度阈值 */}
                {/* <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow transition-shadow">
                  <div className="text-xs text-gray-500 mb-1">置信度阈值</div>
                  <div className="font-bold text-gray-800 text-lg">{selectedModel.score_thr}</div>
                </div> */}
                
                {/* 参数卡片 3：最小框尺寸 */}
                {/* <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow transition-shadow">
                  <div className="text-xs text-gray-500 mb-1">最小过滤框尺寸</div>
                  <div className="font-bold text-gray-800 text-lg">
                    {selectedModel.min_bbox_size} <span className="text-xs text-gray-400 font-normal">px</span>
                  </div>
                </div> */}

                {/* 类别标签区域 (占据整整一行) */}
                <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm md:col-span-3">
                  <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
                    <span>模型支持检出的目标类别</span>
                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      共 {selectedModel.class_names.length} 类
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedModel.class_names.map((name, index) => (
                      <span 
                        key={index} 
                        className="bg-blue-50 text-blue-700 border border-blue-100 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors cursor-default"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：数据导入与执行 */}
        {/* 修复 1：加入 self-start 让它不被左侧强行拉伸，加入 sticky top-6 开启丝滑吸顶效果 */}
        <div className="lg:col-span-5 flex flex-col gap-6 self-start sticky top-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">2. 导入图像数据</h2>
            
            {/* 合并为一个宽大的点击区域，UI 更像现代 SaaS 平台 */}
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="w-full py-8 px-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all flex flex-col items-center justify-center gap-3 group"
            >
              {/* 上传图标 */}
              <svg className="w-10 h-10 text-gray-400 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div className="text-center">
                <span className="text-gray-600 font-medium group-hover:text-blue-600 transition-colors">点击导入图片</span>
                <p className="text-xs text-gray-400 mt-1">支持按住 Ctrl 或拉框进行多选</p>
              </div>
            </button>
            
            {/* 核心：保留一个 input，加上 multiple 属性允许框选多张 */}
            <input 
              type="file" 
              accept="image/*" 
              multiple 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
            />
            
            {files.length > 0 && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>✅</span> 
                  <span>已就绪 <strong>{files.length}</strong> 张图片</span>
                </div>
                {/* 增加一个清空按钮，提升体验 */}
                <button 
                  onClick={() => setFiles([])} 
                  className="text-xs text-green-600 hover:text-green-800 underline"
                >
                  重新选择
                </button>
              </div>
            )}
          </div>

          {/* 修复 2：彻底去掉 flex-1 和 justify-center，让它的高度完全由内部内容决定，绝不浮动 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col">
            <h2 className="text-lg font-semibold text-gray-800 mb-6">3. 开始任务</h2>
            
            <button
              onClick={handleStartInference}
              disabled={isInferencing || files.length === 0 || !selectedModel}
              className={`w-full py-4 rounded-xl text-white font-bold text-lg transition-all duration-300 ${
                isInferencing || files.length === 0 || !selectedModel 
                  ? 'bg-gray-300 cursor-not-allowed shadow-none' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0'
              }`}
            >
              {isInferencing ? 'GPU 加速推理中...' : '🚀 开始推理'}
            </button>
            
            {(isInferencing || progress > 0) && (
              <div className="mt-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600 font-medium">任务进度</span>
                  <span className="text-blue-600 font-bold">{progress}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 relative" 
                    style={{ width: `${progress}%` }}
                  >
                    {/* 进度条上的动态光效 (可选小细节) */}
                    <div className="absolute top-0 left-0 bottom-0 right-0 bg-white/20 animate-pulse"></div>
                  </div>
                </div>
              </div>
            )}
            
            {isCompleted && (
              <div className="mt-6 text-center animate-fade-in-up">
                <div className="text-green-600 font-medium mb-4 flex items-center justify-center gap-2">
                  <span>✨</span> 推理完成！
                </div>
                <button 
                  onClick={() => navigate('/results', { 
                    state: { 
                      results: inferenceData.results, 
                      model_used: selectedModel?.model_name,
                      files: files,
                      initial_params: { 
                        score_thr: selectedModel?.score_thr,
                        min_bbox_size: selectedModel?.min_bbox_size,
                      }
                    } 
                  })}
                  className="w-full py-3 border-2 border-blue-600 text-blue-600 rounded-xl hover:bg-blue-50 font-bold transition-colors"
                >
                  查看结果详情 →
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
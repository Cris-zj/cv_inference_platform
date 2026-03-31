import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import JSZip from 'jszip';

export const ResultsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { results = [], model_used = '未知模型', files = [], initial_params = {} } = location.state || {};
  
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scoreThreshold, setScoreThreshold] = useState<number>(initial_params.score_thr || 0.5);
  const [minSize, setMinSize] = useState<number>(initial_params.min_bbox_size || 20);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  if (!files || files.length === 0) {
    return <Navigate to="/inference" replace />;
  }

  const currentFile = files[selectedIndex];
  const currentResult = results.find((r: any) => r.file_name === currentFile.name);

  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [selectedIndex]);

  const allCategories = useMemo(() => {
    const categories = new Set<string>();
    results.forEach((res: any) => res.detections?.forEach((det: any) => categories.add(det.class_name)));
    return ['All', ...Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'))];
  }, [results]);

  const categoryColors = useMemo(() => {
    const realCategories = allCategories.filter(cat => cat !== 'All');
    const colorMap: Record<string, string> = {};
    realCategories.forEach((cat, index) => {
      const hue = Math.floor((index * 360) / realCategories.length);
      colorMap[cat] = `hsl(${hue}, 75%, 55%)`;
    });
    return colorMap;
  }, [allCategories]);

  const currentImageUrl = useMemo(() => {
    if (!currentFile) return '';
    return URL.createObjectURL(currentFile);
  }, [currentFile]);

  const getFilteredDetections = useCallback((detections: any[]) => {
    if (!detections) return [];
    return detections.filter((det: any) => {
      const [x1, y1, x2, y2] = det.bbox;
      return (det.score >= scoreThreshold) && 
             ((x2 - x1) >= minSize && (y2 - y1) >= minSize) && 
             (selectedCategory === 'All' || det.class_name === selectedCategory);
    });
  }, [scoreThreshold, minSize, selectedCategory]);

  const currentFilteredDetections = useMemo(() => {
    return getFilteredDetections(currentResult?.detections || []);
  }, [currentResult, getFilteredDetections]);

  const drawImageAndBoxes = useCallback((canvas: HTMLCanvasElement, img: HTMLImageElement, detections: any[]) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const validDetections = getFilteredDetections(detections);
    
    validDetections.forEach((det: any) => {
      const [x1, y1, x2, y2] = det.bbox;
      const color = categoryColors[det.class_name] || '#00ff00';

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(img.width * 0.003, 2); 
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const text = `${det.class_name} ${det.score.toFixed(2)}`;
      const fontSize = Math.max(img.width * 0.015, 14); 
      ctx.font = `bold ${fontSize}px sans-serif`;
      const textWidth = ctx.measureText(text).width;
      const textHeight = fontSize * 1.2;

      ctx.fillStyle = color;
      ctx.fillRect(x1, y1 - textHeight, textWidth + 10, textHeight);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x1 + 5, y1 - textHeight / 2);
    });
  }, [getFilteredDetections, categoryColors]);

  useEffect(() => {
    if (!currentImageUrl || !canvasRef.current) return;
    const img = new Image();
    img.src = currentImageUrl;
    img.onload = () => drawImageAndBoxes(canvasRef.current!, img, currentResult?.detections || []);
  }, [currentImageUrl, currentResult, drawImageAndBoxes]);

  const handleWheel = (e: React.WheelEvent) => {
    const zoomFactor = 0.001;
    const delta = -e.deltaY * zoomFactor;
    setScale(s => Math.min(Math.max(0.1, s + delta * s * 5), 10)); 
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const triggerDownload = (canvas: HTMLCanvasElement, filename: string) => {
    const url = canvas.toDataURL('image/jpeg', 0.95);
    const link = document.createElement('a');
    link.href = url;
    link.download = `分析结果_${filename}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveCurrent = () => {
    if (canvasRef.current) triggerDownload(canvasRef.current, currentFile.name);
  };

  const handleBatchSave = async () => {
    setIsExporting(true);
    setExportProgress(0);

    const zip = new JSZip();
    const folder = zip.folder("智能检测报告_批量导出"); 
    if (!folder) return setIsExporting(false);

    const offscreenCanvas = document.createElement('canvas');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const res = results.find((r: any) => r.file_name === file.name);
      
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
          drawImageAndBoxes(offscreenCanvas, img, res?.detections || []);
          offscreenCanvas.toBlob((blob) => {
            if (blob) folder.file(`分析结果_${file.name}`, blob);
            URL.revokeObjectURL(img.src);
            resolve();
          }, 'image/jpeg', 0.95); 
        };
      });
      setExportProgress(Math.round(((i + 1) / files.length) * 50)); 
    }

    try {
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } }, 
        (metadata) => setExportProgress(50 + Math.round(metadata.percent / 2))
      );

      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = zipUrl;
      const now = new Date();
      const timeStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours()}${now.getMinutes()}`;
      link.download = `视觉检测报告_${timeStr}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(zipUrl); 
    } catch (error) {
      alert("ZIP 打包失败，可能是图片过多导致内存不足。");
    } finally {
      setIsExporting(false);
      setExportProgress(100);
      setTimeout(() => setExportProgress(0), 1000); 
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center shrink-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/inference')} className="text-gray-500 hover:text-blue-600 font-medium">← 返回</button>
          <div className="h-6 w-px bg-gray-200"></div>
          <h1 className="text-xl font-bold text-gray-800">检测分析报告</h1>
        </div>
        <div className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-1 rounded">Model: {model_used}</div>
      </header>

      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        
        {/* ================= 左侧控制台 (Col-span-3) ================= */}
        <div className="lg:col-span-3 flex flex-col gap-4 h-full min-h-0">
          <div className="bg-white rounded-xl shadow-sm border p-4 space-y-5 shrink-0">
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">🔍 结果过滤</h3>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500">置信度阈值 (score)</span>
                <span className="font-mono text-blue-600 font-bold">{scoreThreshold.toFixed(2)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.01" value={scoreThreshold} onChange={(e) => setScoreThreshold(parseFloat(e.target.value))} className="w-full h-1.5 bg-gray-100 rounded-lg accent-blue-600" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500">最小尺寸 (px)</span>
                <span className="font-mono text-blue-600 font-bold">{minSize}px</span>
              </div>
              <input type="range" min="0" max="500" step="5" value={minSize} onChange={(e) => setMinSize(parseInt(e.target.value))} className="w-full h-1.5 bg-gray-100 rounded-lg accent-blue-600" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">类别筛选</label>
              <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full text-sm border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-4 flex-1 flex flex-col min-h-0">
            <h3 className="text-sm font-bold text-gray-800 mb-3 shrink-0">图像序列 ({files.length})</h3>
            <div className="overflow-y-auto space-y-2 flex-1 pr-1 custom-scrollbar">
              {files.map((file: File, index: number) => {
                const res = results.find((r: any) => r.file_name === file.name);
                const filteredCount = res ? getFilteredDetections(res.detections).length : 0;
                let statusLabel = { text: '图片未做分析', color: 'text-gray-400', bg: 'border-gray-100' };
                if (res) {
                  statusLabel = filteredCount > 0 
                    ? { text: '有检测结果', color: 'text-blue-600', bg: 'border-blue-100 bg-blue-50/30' } 
                    : { text: '无检测结果', color: 'text-green-500', bg: 'border-gray-100' };
                }
                return (
                  <button key={index} onClick={() => setSelectedIndex(index)} className={`w-full text-left p-3 rounded-lg border transition-all ${selectedIndex === index ? 'border-blue-500 ring-2 ring-blue-500/10' : statusLabel.bg}`}>
                    <div className="text-xs font-medium text-gray-800 truncate mb-1">{file.name}</div>
                    <div className={`text-[10px] font-bold uppercase tracking-wider ${statusLabel.color}`}>{statusLabel.text}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ================= 右侧主区域 (Col-span-9) ================= */}
        <div className="lg:col-span-9 bg-white rounded-xl shadow-sm border p-6 flex flex-col h-full min-h-0 gap-4">
          
          {/* 顶部工具栏 (保持不变) */}
          <div className="flex items-center justify-between shrink-0">
            <h2 className="text-lg font-bold text-gray-800 truncate max-w-[500px]" title={currentFile?.name}>
              {currentFile?.name || '未选择图片'}
            </h2>
            <div className="flex gap-3 items-center">
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button onClick={() => setScale(s => Math.min(s + 0.5, 10))} className="px-3 py-1 hover:bg-white rounded text-gray-600 font-medium text-sm transition-all" title="放大">🔍+</button>
                <button onClick={() => setScale(s => Math.max(s - 0.5, 0.1))} className="px-3 py-1 hover:bg-white rounded text-gray-600 font-medium text-sm transition-all" title="缩小">🔍-</button>
                <button onClick={() => { setScale(1); setPosition({x:0, y:0}); }} className="px-3 py-1 hover:bg-white rounded text-gray-600 font-medium text-sm transition-all">1:1</button>
              </div>
              <div className="w-px h-6 bg-gray-200 mx-1"></div>
              <button onClick={handleSaveCurrent} className="px-4 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-bold transition-all border border-blue-200">
                💾 保存当前图
              </button>
              <button onClick={handleBatchSave} disabled={isExporting} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all text-white shadow-md ${isExporting ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'}`}>
                {isExporting ? `正在导出... ${exportProgress}%` : '📥 批量导出所有'}
              </button>
            </div>
          </div>
          
          {/* 🚨 核心重构：将画布和表格水平并排 (flex-row) */}
          <div className="flex-1 flex flex-row gap-4 min-h-0">
            
            {/* 中间区：图像渲染画布 (占满剩余空间 flex-1) */}
            <div 
              ref={containerRef}
              className={`flex-1 bg-gray-200 rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center relative ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-md pointer-events-none z-10 flex flex-col gap-1 shadow-sm">
                <span>🖱️ 滚轮: 缩放图像 (当前: {(scale * 100).toFixed(0)}%)</span>
                <span>✋ 按住: 拖拽平移</span>
              </div>
              <canvas 
                ref={canvasRef} 
                className="max-w-full max-h-full transition-transform duration-75 ease-out shadow-sm" 
                style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transformOrigin: 'center' }} 
              />
            </div>

            {/* 右侧的右侧：坐标数据看板 (固定宽度 w-[360px]) */}
            <div className="w-[360px] shrink-0 bg-white border border-gray-200 rounded-lg flex flex-col h-full overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center shrink-0">
                <h3 className="text-sm font-bold text-gray-800">
                  检测明细 <span className="text-blue-600 font-mono bg-blue-100 px-1.5 py-0.5 rounded text-xs ml-1">{currentFilteredDetections.length}</span>
                </h3>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-2 font-medium text-gray-500 w-8 text-center">#</th>
                      <th className="px-2 py-2 font-medium text-gray-500">类别</th>
                      <th className="px-2 py-2 font-medium text-gray-500">置信度</th>
                      <th className="px-2 py-2 font-medium text-gray-500">坐标 [x1, y1, x2, y2]</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentFilteredDetections.length > 0 ? (
                      currentFilteredDetections.map((det: any, idx: number) => {
                        const [x1, y1, x2, y2] = det.bbox;
                        const color = categoryColors[det.class_name] || '#00ff00';
                        
                        return (
                          <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                            <td className="px-3 py-2 font-mono text-gray-400 text-center">{idx + 1}</td>
                            <td className="px-2 py-2">
                              <span 
                                className="px-1.5 py-0.5 rounded text-white font-bold tracking-wide text-[10px] whitespace-nowrap" 
                                style={{ backgroundColor: color }}
                              >
                                {det.class_name}
                              </span>
                            </td>
                            <td className="px-2 py-2 font-mono text-gray-700">{det.score.toFixed(2)}</td>
                            {/* 坐标数据字体缩小一号，防止由于固定侧边栏过窄导致换行错乱 */}
                            <td className="px-2 py-2 font-mono text-gray-500 text-[10px]">
                              [{x1.toFixed(0)}, {y1.toFixed(0)}, {x2.toFixed(0)}, {y2.toFixed(0)}]
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        {/* 由于删除了宽x高，空状态占位需要改为 colSpan=4 */}
                        <td colSpan={4} className="px-4 py-10 text-center text-gray-400 leading-relaxed">
                          当前无目标<br/>请调整左侧阈值
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
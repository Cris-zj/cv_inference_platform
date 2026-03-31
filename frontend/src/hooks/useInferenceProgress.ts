import { useState, useEffect } from 'react';

export const useInferenceProgress = (taskId: string | null) => {
  const [progress, setProgress] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  useEffect(() => {
    if (!taskId) return;

    // 连接后端的 SSE 端点
    const eventSource = new EventSource(`http://localhost:8000/api/inference/progress/${taskId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setProgress(data.progress);
      
      if (data.progress >= 100) {
        setIsCompleted(true);
        eventSource.close();
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE Connection Error:", error);
      eventSource.close();
    };

    // 组件卸载时断开连接，触发后端的断线取消机制
    return () => {
      eventSource.close();
    };
  }, [taskId]);

  return { progress, isCompleted };
};
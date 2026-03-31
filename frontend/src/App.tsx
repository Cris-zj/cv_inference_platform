import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Login } from './pages/Login';
import { InferencePage } from './pages/InferencePage';
import { ResultsPage } from './pages/ResultsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* 默认访问根路径时，重定向到推理控制台 */}
        <Route path="/" element={<Navigate to="/inference" replace />} />
        
        {/* 开放路由：登录页 */}
        <Route path="/login" element={<Login />} />

        {/* 保护路由：Page 2 (模型推理) */}
        <Route 
          path="/inference" 
          element={
            <RequireAuth>
              <InferencePage />
            </RequireAuth>
          } 
        />

        {/* 保护路由：Page 3 (结果展示) */}
        <Route 
          path="/results" 
          element={
            <RequireAuth>
              <ResultsPage />
            </RequireAuth>
          } 
        />

        {/* 404 捕获 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
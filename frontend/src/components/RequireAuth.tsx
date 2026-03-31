import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface RequireAuthProps {
  children: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children }) => {
  const location = useLocation();
  const token = localStorage.getItem('auth_token');
  const username = localStorage.getItem('username');

  // 核心防御：如果没有 token，或者没有合法的用户名，统统拦截并重定向到登录页
  if (!token || !username) {
    // 强制清理可能残留的半截数据
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 如果有 token，放行，渲染具体的页面内容
  return <>{children}</>;
};
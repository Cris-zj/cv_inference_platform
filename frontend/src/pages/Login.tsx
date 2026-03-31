import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(''); // 每次点击登录清空之前的报错

    try {
      // 1. 向 FastAPI 发送真实的账号密码
      const response = await fetch(`http://${window.location.hostname}:3061/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      // 2. 如果后端返回 401，说明密码错了
      if (!response.ok) {
        throw new Error('用户名或密码错误！');
      }

      // 3. 解析后端返回的成功数据
      const data = await response.json();

      // 4. 将后端发来的真实 token 和 username 存入缓存
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('username', data.username);
      
      // 5. 放行，进入推理页面
      const from = location.state?.from?.pathname || '/inference';
      navigate(from, { replace: true });

    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-blue-600 p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">方寸知微-输电检测平台</h2>
          <p className="text-blue-200 text-sm">Maicro CV Model Inference</p>
        </div>
        <div className="p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {errorMessage && (
              <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
                {errorMessage}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-3 px-4 rounded-lg text-white font-medium text-lg flex justify-center items-center ${
                isLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-md'
              }`}
            >
              {isLoading ? '登录中...' : '登 录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
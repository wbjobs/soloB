import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MusicOutlined, UserOutlined, LogoutOutlined } from '@ant-design/icons';
import useStore from '../store';

function Header() {
  const { user, logout, token } = useStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="bg-primary text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <MusicOutlined className="text-3xl text-secondary" />
          <h1 className="font-display text-2xl font-bold">乐谱协同批注</h1>
        </Link>
        
        {token && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <UserOutlined />
              <span className="font-medium">{user?.name || user?.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <LogoutOutlined />
              退出
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;

import { Link, useLocation } from 'react-router-dom';

export function Navbar() {
  const location = useLocation();

  const navItems = [
    { path: '/', label: '录制控制台', icon: '🎥' },
    { path: '/sessions', label: '历史会话', icon: '📁' },
  ];

  return (
    <nav className="bg-slate-800 border-b border-slate-700 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-xl">
            📹
          </div>
          <h1 className="text-xl font-bold text-white">WebRTC 录制平台</h1>
        </div>

        <div className="flex items-center gap-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                location.pathname === item.path
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

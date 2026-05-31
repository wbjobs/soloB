import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import './App.css';

function App() {
  const [timeRange, setTimeRange] = useState(24);

  const handleTimeRangeChange = (hours) => {
    setTimeRange(hours);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>系统资源监控</h1>
        <div className="time-range-selector">
          <span>时间范围：</span>
          <button 
            className={`time-btn ${timeRange === 1 ? 'active' : ''}`}
            onClick={() => handleTimeRangeChange(1)}
          >
            过去1小时
          </button>
          <button 
            className={`time-btn ${timeRange === 24 ? 'active' : ''}`}
            onClick={() => handleTimeRangeChange(24)}
          >
            过去24小时
          </button>
          <button 
            className={`time-btn ${timeRange === 168 ? 'active' : ''}`}
            onClick={() => handleTimeRangeChange(168)}
          >
            过去7天
          </button>
        </div>
      </header>
      <main className="app-main">
        <Dashboard timeRange={timeRange} />
      </main>
    </div>
  );
}

export default App;

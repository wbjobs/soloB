import React, { useState, useEffect } from 'react';
import './App.css';
import BatchUpgradePage from './components/BatchUpgradePage';
import UpgradeLog from './components/UpgradeLog';
import { initDB, getAllLogs } from './services/indexedDB';

function App() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    initDB();
    loadLogs();
  }, []);

  const loadLogs = async () => {
    const allLogs = await getAllLogs();
    setLogs(allLogs);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>FPGA 固件管理器 (批量升级 + A/B 双备份)</h1>
      </header>
      
      <main className="app-main">
        <div className="content-grid" style={{ gridTemplateColumns: '1fr 360px', gap: '24px' }}>
          <div>
            <BatchUpgradePage />
          </div>
          <div className="right-panel">
            <UpgradeLog logs={logs} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

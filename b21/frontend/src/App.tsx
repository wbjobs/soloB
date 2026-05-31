import { useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { SyscallTable } from './components/SyscallTable'
import { Stats } from './components/Stats'
import { FlameGraph } from './components/FlameGraph'

type ViewMode = 'table' | 'flamegraph' | 'both'

function App() {
  const [autoScroll, setAutoScroll] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const { events, isConnected, clearEvents, reconnectCount } = useWebSocket('/ws')

  const getConnectionStatus = () => {
    if (isConnected) {
      return { text: 'Connected', className: 'connected' }
    }
    if (reconnectCount > 0) {
      return { text: `Reconnecting (attempt ${reconnectCount})...`, className: 'reconnecting' }
    }
    return { text: 'Disconnected', className: 'disconnected' }
  }

  const status = getConnectionStatus()

  const handleClearData = async () => {
    try {
      await fetch('/api/clear', { method: 'POST' })
      clearEvents()
    } catch (err) {
      console.error('Failed to clear data:', err)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="title">
            <span className="icon">🔧</span>
            Syscall Analyzer
          </h1>
          <div className={`connection-status ${status.className}`}>
            <span className="status-dot"></span>
            {status.text}
          </div>
        </div>
        <div className="header-right">
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              📊 Table
            </button>
            <button
              className={`view-btn ${viewMode === 'flamegraph' ? 'active' : ''}`}
              onClick={() => setViewMode('flamegraph')}
            >
              🔥 Flame Graph
            </button>
            <button
              className={`view-btn ${viewMode === 'both' ? 'active' : ''}`}
              onClick={() => setViewMode('both')}
            >
              👁️ Both
            </button>
          </div>
          {viewMode !== 'flamegraph' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
          )}
          <button className="btn btn-clear" onClick={handleClearData}>
            Clear All
          </button>
        </div>
      </header>

      <main className="main">
        <Stats events={events} />
        
        {viewMode === 'table' && (
          <div className="table-section">
            <h2 className="section-title">Real-time System Call Stream</h2>
            <SyscallTable events={events} autoScroll={autoScroll} />
          </div>
        )}

        {viewMode === 'flamegraph' && (
          <div className="flamegraph-section">
            <FlameGraph refreshInterval={2000} />
          </div>
        )}

        {viewMode === 'both' && (
          <>
            <div className="table-section">
              <h2 className="section-title">Real-time System Call Stream</h2>
              <SyscallTable events={events} autoScroll={autoScroll} />
            </div>
            <div className="flamegraph-section">
              <FlameGraph refreshInterval={2000} />
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        <p>Monitoring nginx process for: openat, read, write, connect</p>
      </footer>
    </div>
  )
}

export default App

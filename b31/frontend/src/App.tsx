import React, { useState, useEffect, useCallback } from 'react'
import OceanSurface from './components/OceanSurface'
import ControlPanel from './components/ControlPanel'
import { WaveParameters } from './types'
import webSocketService from './services/WebSocketService'

const App: React.FC = () => {
  const [parameters, setParameters] = useState<WaveParameters>({
    wind_speed: 10.0,
    fetch: 10000.0,
    peak_frequency: null,
    main_direction: 0.0
  })

  const [heightData, setHeightData] = useState<number[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  const handleParametersChange = useCallback((newParams: WaveParameters) => {
    setParameters(newParams)
    webSocketService.updateParameters(newParams)
  }, [])

  useEffect(() => {
    const connect = async () => {
      try {
        await webSocketService.connect()
        setIsConnected(webSocketService.isConnected())
      } catch (error) {
        console.error('Failed to connect to WebSocket:', error)
      }
    }

    connect()

    const unsubscribeData = webSocketService.onData((data, time) => {
      setHeightData(data)
      setCurrentTime(time)
    })

    const unsubscribeParams = webSocketService.onParamsUpdated((params) => {
      setParameters(params)
    })

    const connectionCheck = setInterval(() => {
      setIsConnected(webSocketService.isConnected())
    }, 1000)

    return () => {
      clearInterval(connectionCheck)
      unsubscribeData()
      unsubscribeParams()
      webSocketService.disconnect()
    }
  }, [])

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #3b82f6;
        cursor: pointer;
        border: 2px solid #1e40af;
        box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4);
      }
      input[type="range"]::-webkit-slider-thumb:hover {
        background: #60a5fa;
      }
      input[type="range"]::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #3b82f6;
        cursor: pointer;
        border: 2px solid #1e40af;
      }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  return (
    <div style={{
      position: 'relative',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden'
    }}>
      <OceanSurface
        heightData={heightData}
        gridSize={512}
      />
      
      <ControlPanel
        parameters={parameters}
        onParametersChange={handleParametersChange}
        isConnected={isConnected}
        currentTime={currentTime}
      />

      {!isConnected && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          padding: '30px 40px',
          borderRadius: '12px',
          textAlign: 'center',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid #3b82f6',
            borderTop: '4px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          <h2 style={{ color: '#e2e8f0', marginBottom: '8px', fontSize: '18px' }}>
            连接到后端服务器中...
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>
            请确保后端服务正在运行 (ws://localhost:8000)
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default App

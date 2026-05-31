import { useState, useRef, useEffect, useCallback } from 'react'
import { ModelLoader } from './ml/model-loader'
import { GestureClassifier, GESTURES } from './ml/gesture-classifier'
import { GestureStore, DEFAULT_ACTIONS } from './ml/gesture-store'
import { ControlPanel } from './ui/ControlPanel'
import { GestureTrainer } from './ui/GestureTrainer'
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils'

function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const modelLoaderRef = useRef(null)
  const gestureClassifierRef = useRef(null)
  const gestureStoreRef = useRef(null)
  
  const [isRunning, setIsRunning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [currentGesture, setCurrentGesture] = useState(GESTURES.UNKNOWN)
  const [currentGestureInfo, setCurrentGestureInfo] = useState(null)
  const [lightOn, setLightOn] = useState(false)
  const [carPosition, setCarPosition] = useState({ x: 0.5, y: 0.5 })
  const [enhancementEnabled, setEnhancementEnabled] = useState(true)
  const [enhancementLevel, setEnhancementLevel] = useState(0)
  const [frameBrightness, setFrameBrightness] = useState(0)
  const [showTrainer, setShowTrainer] = useState(false)
  const [lastResults, setLastResults] = useState(null)
  const [customGestureCount, setCustomGestureCount] = useState(0)
  const lastGestureRef = useRef(null)
  const brightnessCheckInterval = useRef(null)

  useEffect(() => {
    gestureStoreRef.current = new GestureStore()
    modelLoaderRef.current = new ModelLoader({
      enableEnhancement: enhancementEnabled
    })
    gestureClassifierRef.current = new GestureClassifier(gestureStoreRef.current)

    setCustomGestureCount(gestureStoreRef.current.getAllGestures().length)

    return () => {
      if (brightnessCheckInterval.current) {
        clearInterval(brightnessCheckInterval.current)
      }
      if (modelLoaderRef.current) {
        modelLoaderRef.current.destroy()
      }
    }
  }, [])

  const refreshCustomGestureCount = useCallback(() => {
    if (gestureStoreRef.current) {
      setCustomGestureCount(gestureStoreRef.current.getAllGestures().length)
    }
  }, [])

  const executeAction = useCallback((gestureId) => {
    if (!gestureStoreRef.current) return

    const action = gestureStoreRef.current.getGestureAction(gestureId)
    if (!action) return

    switch (action) {
      case DEFAULT_ACTIONS.LIGHT_ON:
        setLightOn(true)
        break
      case DEFAULT_ACTIONS.LIGHT_OFF:
        setLightOn(false)
        break
      case DEFAULT_ACTIONS.CAR_RESET:
        setCarPosition({ x: 0.5, y: 0.5 })
        break
      case DEFAULT_ACTIONS.STOP:
        break
      default:
        break
    }
  }, [])

  const updateEnhancementInfo = useCallback(() => {
    if (modelLoaderRef.current && isRunning) {
      const info = modelLoaderRef.current.getEnhancementInfo()
      setEnhancementLevel(info.level)
      
      if (videoRef.current && canvasRef.current) {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const video = videoRef.current
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        if (canvas.width > 0 && canvas.height > 0) {
          ctx.drawImage(video, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const data = imageData.data
          let sum = 0
          const step = 4 * 20
          let count = 0
          for (let i = 0; i < data.length; i += step) {
            const brightness = (0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]) / 255
            sum += brightness
            count++
          }
          setFrameBrightness(count > 0 ? sum / count : 0)
        }
      }
    }
  }, [isRunning])

  const toggleEnhancement = useCallback(() => {
    const newState = !enhancementEnabled
    setEnhancementEnabled(newState)
    if (modelLoaderRef.current) {
      modelLoaderRef.current.setEnhancementEnabled(newState)
    }
  }, [enhancementEnabled])

  const processResults = useCallback((results) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    setLastResults(results)

    const ctx = canvas.getContext('2d')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height)

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      for (const landmarks of results.multiHandLandmarks) {
        drawConnectors(ctx, landmarks, [[0, 1], [1, 2], [2, 3], [3, 4],
          [0, 5], [5, 6], [6, 7], [7, 8],
          [5, 9], [9, 10], [10, 11], [11, 12],
          [9, 13], [13, 14], [14, 15], [15, 16],
          [13, 17], [17, 18], [18, 19], [19, 20],
          [0, 17]], { color: '#00FF00', lineWidth: 2 })
        drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1 })
      }
    }
    ctx.restore()

    const result = gestureClassifierRef.current.classify(results)
    const { gesture, confidence, isCustom, gestureName, gestureIcon } = result
    const handPosition = gestureClassifierRef.current.getHandPosition(results)

    if (gesture !== lastGestureRef.current && confidence > 0.7) {
      lastGestureRef.current = gesture
      setCurrentGesture(gesture)
      setCurrentGestureInfo({ gesture, confidence, isCustom, gestureName, gestureIcon })

      if (isCustom) {
        executeAction(gesture)
      } else {
        switch (gesture) {
          case GESTURES.VICTORY:
            setLightOn(true)
            break
          case GESTURES.FIST:
            setLightOn(false)
            break
          case GESTURES.WAVE:
            setCarPosition({ x: 0.5, y: 0.5 })
            break
          default:
            break
        }
      }
    }

    if (gesture === GESTURES.POINT && handPosition) {
      setCarPosition({
        x: Math.max(0, Math.min(1, handPosition.centerX)),
        y: Math.max(0, Math.min(1, handPosition.centerY))
      })
    }
  }, [executeAction])

  const startCamera = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const video = videoRef.current
      if (!video) {
        throw new Error('Video element not found')
      }

      await modelLoaderRef.current.init(video, processResults)
      await modelLoaderRef.current.start()
      setIsRunning(true)

      brightnessCheckInterval.current = setInterval(() => {
        updateEnhancementInfo()
      }, 500)
    } catch (err) {
      setError(err.message || '启动摄像头失败，请确保已授权摄像头访问')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const stopCamera = () => {
    if (brightnessCheckInterval.current) {
      clearInterval(brightnessCheckInterval.current)
      brightnessCheckInterval.current = null
    }
    if (modelLoaderRef.current) {
      modelLoaderRef.current.stop()
    }
    if (gestureClassifierRef.current) {
      gestureClassifierRef.current.reset()
    }
    setIsRunning(false)
    setCurrentGesture(GESTURES.UNKNOWN)
    setEnhancementLevel(0)
    setFrameBrightness(0)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎮 手势控制系统</h1>
        <p>通过手势控制网页元素</p>
      </header>

      <main className="main-content">
        <div className="left-panel">
          <div className="video-container">
            <video
              ref={videoRef}
              className="input-video"
              playsInline
              muted
              style={{ display: 'none' }}
            />
            <canvas
              ref={canvasRef}
              className="output-canvas"
            />
            {!isRunning && (
              <div className="placeholder">
                <p>点击下方按钮启动摄像头</p>
              </div>
            )}
          </div>

          <div className="controls">
            {!isRunning ? (
              <button
                onClick={startCamera}
                disabled={isLoading}
                className="btn btn-primary"
              >
                {isLoading ? '加载中...' : '📷 启动摄像头'}
              </button>
            ) : (
              <>
                <button
                  onClick={stopCamera}
                  className="btn btn-danger"
                >
                  ⏹ 停止摄像头
                </button>
                <button
                  onClick={toggleEnhancement}
                  className={`btn ${enhancementEnabled ? 'btn-success' : 'btn-secondary'}`}
                >
                  {enhancementEnabled ? '✨ 增强开启' : '🌙 增强关闭'}
                </button>
                <button
                  onClick={() => setShowTrainer(true)}
                  className="btn btn-secondary"
                >
                  🎯 训练手势 {customGestureCount > 0 && `(${customGestureCount})`}
                </button>
              </>
            )}
          </div>

          {isRunning && (
            <div className="enhancement-status">
              <div className="status-item">
                <span>📊 画面亮度:</span>
                <div className="progress-bar">
                  <div
                    className={`progress-fill ${frameBrightness < 0.35 ? 'low' : frameBrightness < 0.6 ? 'medium' : 'high'}`}
                    style={{ width: `${frameBrightness * 100}%` }}
                  />
                </div>
                <span>{(frameBrightness * 100).toFixed(0)}%</span>
              </div>
              {enhancementEnabled && enhancementLevel > 0 && (
                <div className="status-item">
                  <span>⚡ 增强强度:</span>
                  <div className="progress-bar">
                    <div
                      className="progress-fill enhancing"
                      style={{ width: `${enhancementLevel * 100}%` }}
                    />
                  </div>
                  <span>{(enhancementLevel * 100).toFixed(0)}%</span>
                </div>
              )}
              {frameBrightness < 0.35 && enhancementEnabled && (
                <div className="enhancement-active">
                  🛡️ 弱光环境检测，直方图均衡化已激活
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="error-message">
              ❌ {error}
            </div>
          )}

          <div className="demo-area">
            <h3>控制区域</h3>
            <div className={`light-demo ${lightOn ? 'on' : 'off'}`}>
              <span className="light-icon">💡</span>
              <span>{lightOn ? '灯光已开启' : '灯光已关闭'}</span>
            </div>

            <div className="car-demo-container">
              <div className="car-track">
                <div
                  className="car"
                  style={{
                    left: `${carPosition.x * 100}%`,
                    top: `${carPosition.y * 100}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                >
                  🚗
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="right-panel">
          <ControlPanel
            currentGesture={currentGesture}
            lightOn={lightOn}
            carPosition={carPosition}
            isRunning={isRunning}
            customGestureInfo={currentGestureInfo}
          />
        </div>
      </main>

      {showTrainer && gestureStoreRef.current && (
        <GestureTrainer
          gestureStore={gestureStoreRef.current}
          onClose={() => setShowTrainer(false)}
          onUpdate={refreshCustomGestureCount}
          currentResults={lastResults}
        />
      )}
    </div>
  )
}

export default App

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Timeline from './timeline/Timeline'
import exportManager from './export/ExportManager'
import {
  loadFFmpeg,
  isFFmpegLoaded,
  writeFile,
  readFile,
  deleteFile,
  executeCommand,
  buildTrimCommand,
  buildConcatCommand,
  buildWatermarkCommand,
  getVideoDuration,
  buildConcatWithDynamicTransition
} from './ffmpeg/worker'
import './App.css'

const OPERATION_TYPES = {
  TRIM: 'trim',
  CONCAT: 'concat',
  WATERMARK: 'watermark'
}

function App() {
  const [ffmpegLoading, setFfmpegLoading] = useState(true)
  const [ffmpegLoadError, setFfmpegLoadError] = useState(false)
  
  const [operation, setOperation] = useState(OPERATION_TYPES.TRIM)
  
  const [videoFile, setVideoFile] = useState(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoURL, setVideoURL] = useState(null)
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  
  const [video1File, setVideo1File] = useState(null)
  const [video2File, setVideo2File] = useState(null)
  const [video1URL, setVideo1URL] = useState(null)
  const [video2URL, setVideo2URL] = useState(null)
  const [video1Duration, setVideo1Duration] = useState(0)
  const [video2Duration, setVideo2Duration] = useState(0)
  const [enableTransition, setEnableTransition] = useState(true)
  const [transitionDuration, setTransitionDuration] = useState(1.0)
  
  const [watermarkVideoFile, setWatermarkVideoFile] = useState(null)
  const [watermarkImageFile, setWatermarkImageFile] = useState(null)
  const [watermarkVideoURL, setWatermarkVideoURL] = useState(null)
  const [watermarkImageURL, setWatermarkImageURL] = useState(null)
  const [watermarkPosition, setWatermarkPosition] = useState('top-left')
  
  const [exportState, setExportState] = useState(exportManager.getState())
  
  const videoRef = useRef(null)

  useEffect(() => {
    const unsubscribe = exportManager.subscribe((state) => {
      setExportState(state)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const initFFmpeg = async () => {
      try {
        const success = await loadFFmpeg()
        setFfmpegLoading(false)
        if (!success) {
          setFfmpegLoadError(true)
        }
      } catch (e) {
        setFfmpegLoading(false)
        setFfmpegLoadError(true)
      }
    }
    initFFmpeg()
  }, [])

  const handleVideoSelect = useCallback((event) => {
    const file = event.target.files[0]
    if (!file) return
    
    if (videoURL) {
      URL.revokeObjectURL(videoURL)
    }
    
    const url = URL.createObjectURL(file)
    setVideoFile(file)
    setVideoURL(url)
    setCurrentTime(0)
    setStartTime(0)
    
    const tempVideo = document.createElement('video')
    tempVideo.preload = 'metadata'
    tempVideo.onloadedmetadata = () => {
      setVideoDuration(tempVideo.duration)
      setEndTime(tempVideo.duration)
    }
    tempVideo.src = url
  }, [videoURL])

  const handleConcatVideo1Select = useCallback((event) => {
    const file = event.target.files[0]
    if (!file) return
    if (video1URL) URL.revokeObjectURL(video1URL)
    const url = URL.createObjectURL(file)
    setVideo1File(file)
    setVideo1URL(url)
    
    const tempVideo = document.createElement('video')
    tempVideo.preload = 'metadata'
    tempVideo.onloadedmetadata = () => {
      setVideo1Duration(tempVideo.duration)
    }
    tempVideo.src = url
  }, [video1URL])

  const handleConcatVideo2Select = useCallback((event) => {
    const file = event.target.files[0]
    if (!file) return
    if (video2URL) URL.revokeObjectURL(video2URL)
    const url = URL.createObjectURL(file)
    setVideo2File(file)
    setVideo2URL(url)
    
    const tempVideo = document.createElement('video')
    tempVideo.preload = 'metadata'
    tempVideo.onloadedmetadata = () => {
      setVideo2Duration(tempVideo.duration)
    }
    tempVideo.src = url
  }, [video2URL])

  const handleWatermarkVideoSelect = useCallback((event) => {
    const file = event.target.files[0]
    if (!file) return
    if (watermarkVideoURL) URL.revokeObjectURL(watermarkVideoURL)
    const url = URL.createObjectURL(file)
    setWatermarkVideoFile(file)
    setWatermarkVideoURL(url)
  }, [watermarkVideoURL])

  const handleWatermarkImageSelect = useCallback((event) => {
    const file = event.target.files[0]
    if (!file) return
    if (watermarkImageURL) URL.revokeObjectURL(watermarkImageURL)
    const url = URL.createObjectURL(file)
    setWatermarkImageFile(file)
    setWatermarkImageURL(url)
  }, [watermarkImageURL])

  const handleTrimChange = useCallback((start, end) => {
    setStartTime(start)
    setEndTime(end)
  }, [])

  const handleSeek = useCallback((time) => {
    setCurrentTime(time)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }, [])

  const handleVideoTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }, [])

  const executeTrim = async (onProgress) => {
    if (!videoFile) throw new Error('请选择视频文件')
    
    const inputName = 'input_video.mp4'
    const outputName = 'trimmed_video.mp4'
    
    await writeFile(inputName, videoFile)
    const args = buildTrimCommand(inputName, outputName, startTime, endTime)
    const success = await executeCommand(args, onProgress)
    
    if (!success) {
      await deleteFile(inputName)
      throw new Error('裁剪失败')
    }
    
    const data = await readFile(outputName)
    await deleteFile(inputName)
    await deleteFile(outputName)
    
    return data
  }

  const executeConcat = async (onProgress) => {
    if (!video1File || !video2File) throw new Error('请选择两个视频文件')
    
    const input1Name = 'video1.mp4'
    const input2Name = 'video2.mp4'
    const outputName = 'concatenated_video.mp4'
    
    await writeFile(input1Name, video1File)
    await writeFile(input2Name, video2File)
    
    if (enableTransition && video1Duration > 0 && video2Duration > 0) {
      const actualTransitionDuration = Math.min(
        transitionDuration,
        video1Duration * 0.5,
        video2Duration * 0.5
      )
      
      if (actualTransitionDuration < 0.1) {
        const args = buildConcatCommand([input1Name, input2Name], outputName)
        const success = await executeCommand(args, onProgress)
        if (!success) {
          await deleteFile(input1Name)
          await deleteFile(input2Name)
          throw new Error('拼接失败')
        }
      } else {
        const success = await buildConcatWithDynamicTransition(
          [input1Name, input2Name],
          outputName,
          [video1Duration, video2Duration],
          {
            transitionDuration: actualTransitionDuration,
            transitionType: 'fade',
            onProgress
          }
        )
        if (!success) {
          await deleteFile(input1Name)
          await deleteFile(input2Name)
          throw new Error('拼接失败')
        }
      }
    } else {
      const args = buildConcatCommand([input1Name, input2Name], outputName)
      const success = await executeCommand(args, onProgress)
      if (!success) {
        await deleteFile(input1Name)
        await deleteFile(input2Name)
        throw new Error('拼接失败')
      }
    }
    
    const data = await readFile(outputName)
    await deleteFile(input1Name)
    await deleteFile(input2Name)
    await deleteFile(outputName)
    
    return data
  }

  const executeWatermark = async (onProgress) => {
    if (!watermarkVideoFile || !watermarkImageFile) throw new Error('请选择视频和水印图片')
    
    const videoName = 'watermark_video.mp4'
    const imageName = 'watermark.png'
    const outputName = 'watermarked_video.mp4'
    
    await writeFile(videoName, watermarkVideoFile)
    await writeFile(imageName, watermarkImageFile)
    
    const args = buildWatermarkCommand(videoName, imageName, outputName, watermarkPosition)
    const success = await executeCommand(args, onProgress)
    
    if (!success) {
      await deleteFile(videoName)
      await deleteFile(imageName)
      throw new Error('添加水印失败')
    }
    
    const data = await readFile(outputName)
    await deleteFile(videoName)
    await deleteFile(imageName)
    await deleteFile(outputName)
    
    return data
  }

  const handleExport = async () => {
    exportManager.reset()
    
    try {
      let operationFn
      let operationName
      
      switch (operation) {
        case OPERATION_TYPES.TRIM:
          operationFn = executeTrim
          operationName = '裁剪视频'
          break
        case OPERATION_TYPES.CONCAT:
          operationFn = executeConcat
          operationName = '拼接视频'
          break
        case OPERATION_TYPES.WATERMARK:
          operationFn = executeWatermark
          operationName = '添加水印'
          break
        default:
          throw new Error('未知操作')
      }
      
      await exportManager.startExport(operationFn, operationName)
    } catch (error) {
      console.error('导出错误:', error)
      alert(`操作失败: ${error.message}`)
    }
  }

  const handleDownload = () => {
    exportManager.download()
  }

  const isExportButtonDisabled = () => {
    if (!isFFmpegLoaded()) return true
    if (exportState.isExporting) return true
    
    switch (operation) {
      case OPERATION_TYPES.TRIM:
        return !videoFile
      case OPERATION_TYPES.CONCAT:
        return !video1File || !video2File
      case OPERATION_TYPES.WATERMARK:
        return !watermarkVideoFile || !watermarkImageFile
      default:
        return true
    }
  }

  if (ffmpegLoading) {
    return (
      <div className="app-container loading">
        <div className="loading-content">
          <h1>视频剪辑工具</h1>
          <p className="loading-text">正在加载 FFmpeg... (首次加载可能需要一些时间)</p>
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (ffmpegLoadError) {
    return (
      <div className="app-container error">
        <div className="error-content">
          <h1>视频剪辑工具</h1>
          <p className="error-text">FFmpeg 加载失败。请确保您的浏览器支持 WebAssembly，并且网络连接正常。</p>
          <p className="error-hint">提示: 首次加载需要从 CDN 下载 FFmpeg WASM 文件 (约 25MB)。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>视频剪辑工具</h1>
        <p className="subtitle">基于 FFmpeg WASM 的纯前端视频处理</p>
      </header>

      <div className="operation-tabs">
        <button
          className={`tab-button ${operation === OPERATION_TYPES.TRIM ? 'active' : ''}`}
          onClick={() => setOperation(OPERATION_TYPES.TRIM)}
        >
          视频裁剪
        </button>
        <button
          className={`tab-button ${operation === OPERATION_TYPES.CONCAT ? 'active' : ''}`}
          onClick={() => setOperation(OPERATION_TYPES.CONCAT)}
        >
          视频拼接
        </button>
        <button
          className={`tab-button ${operation === OPERATION_TYPES.WATERMARK ? 'active' : ''}`}
          onClick={() => setOperation(OPERATION_TYPES.WATERMARK)}
        >
          添加水印
        </button>
      </div>

      <main className="main-content">
        {operation === OPERATION_TYPES.TRIM && (
          <section className="operation-panel">
            <h2>视频裁剪</h2>
            <div className="file-input-section">
              <label className="file-label">
                <span>选择视频文件</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoSelect}
                  className="file-input"
                />
              </label>
              {videoFile && <p className="file-name">已选择: {videoFile.name}</p>}
            </div>
            
            {videoURL && (
              <div className="video-preview">
                <video
                  ref={videoRef}
                  src={videoURL}
                  controls
                  onTimeUpdate={handleVideoTimeUpdate}
                />
              </div>
            )}
            
            {videoDuration > 0 && (
              <Timeline
                duration={videoDuration}
                startTime={startTime}
                endTime={endTime}
                currentTime={currentTime}
                onTrimChange={handleTrimChange}
                onSeek={handleSeek}
              />
            )}
          </section>
        )}

        {operation === OPERATION_TYPES.CONCAT && (
          <section className="operation-panel">
            <h2>视频拼接</h2>
            <div className="concat-videos">
              <div className="concat-video-item">
                <label className="file-label">
                  <span>视频 1</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleConcatVideo1Select}
                    className="file-input"
                  />
                </label>
                {video1File && <p className="file-name">{video1File.name}</p>}
                {video1URL && (
                  <video src={video1URL} controls className="small-preview" />
                )}
              </div>
              
              <div className="concat-arrow">+</div>
              
              <div className="concat-video-item">
                <label className="file-label">
                  <span>视频 2</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleConcatVideo2Select}
                    className="file-input"
                  />
                </label>
                {video2File && <p className="file-name">{video2File.name}</p>}
                {video2URL && (
                  <video src={video2URL} controls className="small-preview" />
                )}
              </div>
            </div>
            
            <div className="transition-options">
              <div className="transition-toggle">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={enableTransition}
                    onChange={(e) => setEnableTransition(e.target.checked)}
                  />
                  <span>启用淡入淡出转场</span>
                </label>
              </div>
              
              {enableTransition && (
                <div className="transition-duration">
                  <label>转场时长:</label>
                  <div className="duration-control">
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.1"
                      value={transitionDuration}
                      onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
                      className="slider"
                    />
                    <span className="duration-value">{transitionDuration.toFixed(1)} 秒</span>
                  </div>
                  <p className="tip">
                    实际转场时长将根据视频时长自动调整（不超过每个视频的 50%）
                  </p>
                </div>
              )}
            </div>
            
            <p className="tip">两个视频将按顺序首尾相接。建议使用相同分辨率和帧率的视频。</p>
          </section>
        )}

        {operation === OPERATION_TYPES.WATERMARK && (
          <section className="operation-panel">
            <h2>添加水印</h2>
            <div className="watermark-inputs">
              <div className="watermark-item">
                <label className="file-label">
                  <span>视频文件</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleWatermarkVideoSelect}
                    className="file-input"
                  />
                </label>
                {watermarkVideoFile && <p className="file-name">{watermarkVideoFile.name}</p>}
                {watermarkVideoURL && (
                  <video src={watermarkVideoURL} controls className="small-preview" />
                )}
              </div>
              
              <div className="watermark-item">
                <label className="file-label">
                  <span>水印图片 (PNG 支持透明)</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleWatermarkImageSelect}
                    className="file-input"
                  />
                </label>
                {watermarkImageFile && <p className="file-name">{watermarkImageFile.name}</p>}
                {watermarkImageURL && (
                  <img src={watermarkImageURL} alt="水印预览" className="image-preview" />
                )}
              </div>
            </div>
            
            <div className="position-selector">
              <label>水印位置:</label>
              <select
                value={watermarkPosition}
                onChange={(e) => setWatermarkPosition(e.target.value)}
                className="select-input"
              >
                <option value="top-left">左上角</option>
                <option value="top-right">右上角</option>
                <option value="bottom-left">左下角</option>
                <option value="bottom-right">右下角</option>
              </select>
            </div>
          </section>
        )}

        <div className="export-section">
          {exportState.isExporting && (
            <div className="progress-container">
              <div className="progress-label">
                {exportState.currentOperation} - {exportState.progress}%
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${exportState.progress}%` }}
                />
              </div>
            </div>
          )}
          
          {exportState.status === 'completed' && exportState.resultURL && (
            <div className="result-container">
              <h3>处理完成!</h3>
              <video src={exportState.resultURL} controls className="result-video" />
              <div className="result-actions">
                <button className="download-button" onClick={handleDownload}>
                  下载视频
                </button>
              </div>
            </div>
          )}
          
          <button
            className="export-button"
            onClick={handleExport}
            disabled={isExportButtonDisabled()}
          >
            {exportState.isExporting ? '处理中...' : '开始处理'}
          </button>
        </div>
      </main>

      <footer className="app-footer">
        <p>所有处理都在您的浏览器中完成，文件不会上传到服务器。</p>
      </footer>
    </div>
  )
}

export default App

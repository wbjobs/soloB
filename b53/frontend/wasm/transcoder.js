import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const isSafari = () => {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}

const isMobile = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
}

const checkCrossOriginIsolated = () => {
  if (typeof window !== 'undefined' && 'crossOriginIsolated' in window) {
    return window.crossOriginIsolated
  }
  return false
}

const fetchAsArrayBuffer = async (url) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return response.arrayBuffer()
}

const arrayBufferToBlob = (buffer, mimeType) => {
  return new Blob([buffer], { type: mimeType })
}

const arrayBufferToBlobURL = (buffer, mimeType) => {
  const blob = arrayBufferToBlob(buffer, mimeType)
  return URL.createObjectURL(blob)
}

class ProgressReporter {
  constructor(options = {}) {
    this.jobId = options.jobId || null
    this.apiBase = options.apiBase || '/api'
    this.lastReportedProgress = -1
    this.reportThreshold = options.reportThreshold || 1
    this.debounceInterval = options.debounceInterval || 500
    this.lastReportTime = 0
    this.pendingProgress = null
    this.isReporting = false
    this.onProgress = options.onProgress || null
    this.onLog = options.onLog || null
    this.logs = []
    this.maxLogs = options.maxLogs || 50
  }

  addLog(message) {
    this.logs.push({
      message,
      timestamp: Date.now()
    })
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
    if (this.onLog) {
      this.onLog(message)
    }
  }

  updateProgress(progress, logMessage = null) {
    const progressPercent = Math.round(progress * 100)

    if (this.onProgress) {
      this.onProgress(progress, {
        percent: progressPercent,
        log: logMessage
      })
    }

    if (logMessage) {
      this.addLog(logMessage)
    }

    if (this.jobId) {
      this.pendingProgress = progressPercent
      this.scheduleReport()
    }
  }

  scheduleReport() {
    const now = Date.now()
    const timeSinceLastReport = now - this.lastReportTime

    if (this.pendingProgress === this.lastReportedProgress) {
      return
    }

    if (timeSinceLastReport < this.debounceInterval) {
      if (!this.isReporting) {
        this.isReporting = true
        setTimeout(() => {
          this.reportToBackend()
          this.isReporting = false
        }, this.debounceInterval)
      }
    } else {
      this.reportToBackend()
    }
  }

  async reportToBackend() {
    if (!this.jobId || this.pendingProgress === null) {
      return
    }

    const progressToReport = this.pendingProgress

    try {
      const response = await fetch(`${this.apiBase}/transcode/job/${this.jobId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          progress: progressToReport,
          status: 'processing',
          log: this.logs[this.logs.length - 1]?.message
        })
      })

      if (response.ok) {
        this.lastReportedProgress = progressToReport
        this.lastReportTime = Date.now()
        this.pendingProgress = null
      }
    } catch (error) {
      console.warn('Failed to report progress to backend:', error)
    }
  }

  async reportComplete(outputSize = 0, outputKey = null) {
    if (!this.jobId) return

    try {
      await fetch(`${this.apiBase}/transcode/job/${this.jobId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          output_size: outputSize,
          output_key: outputKey
        })
      })
    } catch (error) {
      console.warn('Failed to report completion to backend:', error)
    }
  }

  async reportFailed(errorMessage) {
    if (!this.jobId) return

    try {
      await fetch(`${this.apiBase}/transcode/job/${this.jobId}/fail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error_message: errorMessage
        })
      })
    } catch (error) {
      console.warn('Failed to report failure to backend:', error)
    }
  }

  getLogs() {
    return [...this.logs]
  }
}

class VideoTranscoder {
  constructor() {
    this.ffmpeg = null
    this.isLoaded = false
    this.progress = 0
    this.onProgress = null
    this.onLog = null
    this._blobURLs = []
    this.progressReporter = null
    this._lastTime = null
    this._duration = null
    this._rawProgress = 0
  }

  async _loadWithBlobURL(baseURL) {
    const coreJSBuffer = await fetchAsArrayBuffer(
      `${baseURL}/ffmpeg-core.js`
    )
    const wasmBuffer = await fetchAsArrayBuffer(
      `${baseURL}/ffmpeg-core.wasm`
    )

    const coreURL = arrayBufferToBlobURL(coreJSBuffer, 'text/javascript')
    const wasmURL = arrayBufferToBlobURL(wasmBuffer, 'application/wasm')

    this._blobURLs.push(coreURL, wasmURL)

    return { coreURL, wasmURL }
  }

  async _loadWithToBlobURL(baseURL) {
    return {
      coreURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        'text/javascript'
      ),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        'application/wasm'
      )
    }
  }

  async load() {
    if (this.isLoaded) {
      return true
    }

    const isSafariBrowser = isSafari()
    const isMobileDevice = isMobile()
    const isCrossOriginIsolated = checkCrossOriginIsolated()

    console.log('Environment check:', {
      isSafari: isSafariBrowser,
      isMobile: isMobileDevice,
      isCrossOriginIsolated
    })

    if (!isCrossOriginIsolated) {
      console.warn(
        'Warning: crossOriginIsolated is false. SharedArrayBuffer may not work.'
      )
    }

    try {
      this.ffmpeg = new FFmpeg()

      this.ffmpeg.on('progress', ({ progress, time, duration }) => {
        if (time !== undefined) {
          this._lastTime = time
        }
        if (duration !== undefined && duration > 0) {
          this._duration = duration
        }

        let calculatedProgress = progress

        if (this._duration && this._lastTime && this._lastTime > 0) {
          const timeBasedProgress = this._lastTime / this._duration
          if (timeBasedProgress > calculatedProgress) {
            calculatedProgress = Math.min(timeBasedProgress, 0.99)
          }
        }

        this._rawProgress = calculatedProgress
        this.progress = calculatedProgress

        if (this.progressReporter) {
          this.progressReporter.updateProgress(calculatedProgress)
        } else if (this.onProgress) {
          this.onProgress(calculatedProgress)
        }
      })

      this.ffmpeg.on('log', ({ message }) => {
        this._parseFfmpegLog(message)

        if (this.progressReporter) {
          this.progressReporter.addLog(message)
        } else if (this.onLog) {
          this.onLog(message)
        }
      })

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

      let urls
      let loadSuccess = false
      let lastError = null

      if (isSafariBrowser) {
        console.log('Safari detected, using alternative loading strategy...')

        try {
          console.log('Attempting arrayBuffer + Blob URL strategy...')
          urls = await this._loadWithBlobURL(baseURL)
          console.log('Strategy 1 successful')
          loadSuccess = true
        } catch (error) {
          console.warn('Strategy 1 failed:', error.message)
          lastError = error

          try {
            console.log('Attempting toBlobURL strategy...')
            urls = await this._loadWithToBlobURL(baseURL)
            console.log('Strategy 2 successful')
            loadSuccess = true
          } catch (error2) {
            console.warn('Strategy 2 failed:', error2.message)
            lastError = error2
          }
        }
      } else {
        try {
          urls = await this._loadWithToBlobURL(baseURL)
          loadSuccess = true
        } catch (error) {
          console.warn('Primary strategy failed, trying alternative...')
          lastError = error
          try {
            urls = await this._loadWithBlobURL(baseURL)
            loadSuccess = true
          } catch (error2) {
            lastError = error2
          }
        }
      }

      if (!loadSuccess || !urls) {
        throw new Error(
          `Failed to load FFmpeg files: ${lastError?.message || 'Unknown error'}`
        )
      }

      console.log('Loading FFmpeg with URLs:', {
        coreURL: urls.coreURL?.substring(0, 50) + '...',
        wasmURL: urls.wasmURL?.substring(0, 50) + '...'
      })

      await this.ffmpeg.load({
        coreURL: urls.coreURL,
        wasmURL: urls.wasmURL
      })

      this.isLoaded = true
      console.log('FFmpeg loaded successfully!')
      return true
    } catch (error) {
      console.error('Failed to load FFmpeg:', error)
      this._cleanupBlobURLs()
      throw error
    }
  }

  _parseFfmpegLog(message) {
    const durationMatch = message.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
    if (durationMatch) {
      const hours = parseInt(durationMatch[1])
      const minutes = parseInt(durationMatch[2])
      const seconds = parseFloat(durationMatch[3])
      this._duration = hours * 3600 + minutes * 60 + seconds
    }

    const timeMatch = message.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    if (timeMatch && this._duration) {
      const hours = parseInt(timeMatch[1])
      const minutes = parseInt(timeMatch[2])
      const seconds = parseFloat(timeMatch[3])
      this._lastTime = hours * 3600 + minutes * 60 + seconds
    }
  }

  _cleanupBlobURLs() {
    this._blobURLs.forEach((url) => {
      try {
        URL.revokeObjectURL(url)
      } catch (e) {
        console.warn('Failed to revoke blob URL:', e)
      }
    })
    this._blobURLs = []
  }

  async transcodeToWebM(file, options = {}) {
    if (!this.isLoaded) {
      await this.load()
    }

    const {
      quality = 'medium',
      videoCodec = 'libvpx-vp9',
      audioCodec = 'libvorbis',
      crf = 30,
      onProgress = null,
      onLog = null,
      jobId = null,
      reportToBackend = true
    } = options

    this._lastTime = null
    this._duration = null
    this._rawProgress = 0

    if (jobId && reportToBackend) {
      this.progressReporter = new ProgressReporter({
        jobId,
        onProgress,
        onLog
      })
    } else {
      this.onProgress = onProgress
      this.onLog = onLog
      this.progressReporter = null
    }

    const inputName = 'input.mp4'
    const outputName = 'output.webm'

    try {
      const fileData = await fetchFile(file)
      await this.ffmpeg.writeFile(inputName, fileData)

      if (this.progressReporter) {
        this.progressReporter.updateProgress(0.01, 'Starting transcode...')
      } else if (this.onProgress) {
        this.onProgress(0.01)
      }

      const args = [
        '-i', inputName,
        '-c:v', videoCodec,
        '-c:a', audioCodec,
        '-crf', crf.toString(),
        '-b:v', '0',
        '-deadline', 'realtime',
        '-cpu-used', '4',
        '-progress', 'pipe:1',
        '-y',
        outputName
      ]

      await this.ffmpeg.exec(args)

      if (this.progressReporter) {
        this.progressReporter.updateProgress(0.99, 'Reading output file...')
      }

      const outputData = await this.ffmpeg.readFile(outputName)
      const outputSize = outputData.length

      const blob = new Blob([outputData], { type: 'video/webm' })

      await this.ffmpeg.deleteFile(inputName)
      await this.ffmpeg.deleteFile(outputName)

      if (this.progressReporter) {
        this.progressReporter.updateProgress(1.0, 'Transcode completed!')
        await this.progressReporter.reportComplete(outputSize)
      } else if (this.onProgress) {
        this.onProgress(1.0)
      }

      return {
        blob,
        url: URL.createObjectURL(blob),
        size: outputSize
      }
    } catch (error) {
      console.error('Transcoding failed:', error)

      if (this.progressReporter) {
        await this.progressReporter.reportFailed(error.message)
      }

      throw error
    }
  }

  async transcodeToWebMFromURL(url, options = {}) {
    if (!this.isLoaded) {
      await this.load()
    }

    const response = await fetch(url)
    const blob = await response.blob()
    return this.transcodeToWebM(blob, options)
  }

  getProgress() {
    return this.progress
  }

  getRawProgress() {
    return this._rawProgress
  }

  getDuration() {
    return this._duration
  }

  getCurrentTime() {
    return this._lastTime
  }

  async terminate() {
    if (this.progressReporter) {
      this.progressReporter = null
    }

    if (this.ffmpeg) {
      this.ffmpeg.terminate()
      this.isLoaded = false
    }
    this._cleanupBlobURLs()
  }
}

export default VideoTranscoder

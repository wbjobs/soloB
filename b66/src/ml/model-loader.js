import { Hands } from '@mediapipe/hands'
import { Camera } from '@mediapipe/camera_utils'
import { ImageEnhancer } from './image-enhancer'

class ModelLoader {
  constructor(options = {}) {
    this.hands = null
    this.camera = null
    this.isInitialized = false
    this.onResultsCallback = null
    this.videoElement = null
    this.imageEnhancer = new ImageEnhancer({
      enableEnhancement: options.enableEnhancement ?? true,
      brightnessThreshold: options.brightnessThreshold ?? 0.35,
      clipLimit: options.clipLimit ?? 2.0
    })
    this.enhancementEnabled = options.enableEnhancement ?? true
    this.frameCount = 0
    this.enhanceInterval = options.enhanceInterval ?? 1
  }

  async init(videoElement, onResults) {
    this.onResultsCallback = onResults
    this.videoElement = videoElement

    this.hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      }
    })

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    })

    this.hands.onResults((results) => {
      if (this.onResultsCallback) {
        this.onResultsCallback(results)
      }
    })

    this.camera = new Camera(videoElement, {
      onFrame: async () => {
        await this.processFrame()
      },
      width: 640,
      height: 480
    })

    this.isInitialized = true
    return true
  }

  async processFrame() {
    if (!this.videoElement || !this.hands) return

    this.frameCount++

    let imageSource = this.videoElement

    if (this.enhancementEnabled && this.frameCount % this.enhanceInterval === 0) {
      try {
        imageSource = this.imageEnhancer.enhance(this.videoElement)
      } catch (error) {
        console.warn('图像增强失败，使用原始图像:', error)
        imageSource = this.videoElement
      }
    }

    await this.hands.send({ image: imageSource })
  }

  setEnhancementEnabled(enabled) {
    this.enhancementEnabled = enabled
    this.imageEnhancer.setOptions({ enableEnhancement: enabled })
  }

  getEnhancementInfo() {
    return this.imageEnhancer.getEnhancementInfo()
  }

  setEnhancementOptions(options) {
    this.imageEnhancer.setOptions(options)
  }

  async start() {
    if (!this.camera) {
      throw new Error('模型未初始化，请先调用 init()')
    }
    await this.camera.start()
  }

  stop() {
    if (this.camera) {
      this.camera.stop()
    }
  }

  destroy() {
    this.stop()
    if (this.hands) {
      this.hands.close()
    }
    this.isInitialized = false
  }
}

export { ModelLoader }

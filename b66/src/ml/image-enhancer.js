class ImageEnhancer {
  constructor(options = {}) {
    this.enableEnhancement = options.enableEnhancement ?? true
    this.clipLimit = options.clipLimit ?? 2.0
    this.gridSize = options.gridSize ?? 8
    this.brightnessThreshold = options.brightnessThreshold ?? 0.35
    this.processCanvas = document.createElement('canvas')
    this.processCtx = this.processCanvas.getContext('2d', { willReadFrequently: true })
    this.enhancementLevel = 0
  }

  calculateBrightness(imageData) {
    const data = imageData.data
    let sum = 0
    const step = 4 * 10
    let count = 0

    for (let i = 0; i < data.length; i += step) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      sum += brightness
      count++
    }

    return sum / count
  }

  createHistogram(channel) {
    const hist = new Array(256).fill(0)
    for (let i = 0; i < channel.length; i++) {
      hist[channel[i]]++
    }
    return hist
  }

  createCDF(hist) {
    const cdf = new Array(256).fill(0)
    cdf[0] = hist[0]
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + hist[i]
    }
    return cdf
  }

  equalizeChannel(channel) {
    const hist = this.createHistogram(channel)
    const cdf = this.createCDF(hist)
    const totalPixels = channel.length
    const cdfMin = cdf.find(v => v > 0)

    if (!cdfMin) return channel

    const equalized = new Uint8Array(channel.length)
    for (let i = 0; i < channel.length; i++) {
      const value = channel[i]
      equalized[i] = Math.round(((cdf[value] - cdfMin) / (totalPixels - cdfMin)) * 255)
    }
    return equalized
  }

  claheChannel(channel, width, height) {
    const gridW = this.gridSize
    const gridH = this.gridSize
    const tileW = Math.ceil(width / gridW)
    const tileH = Math.ceil(height / gridH)
    const clipLimit = this.clipLimit

    const tileHistograms = []

    for (let gy = 0; gy < gridH; gy++) {
      tileHistograms[gy] = []
      for (let gx = 0; gx < gridW; gx++) {
        const startX = gx * tileW
        const startY = gy * tileH
        const endX = Math.min(startX + tileW, width)
        const endY = Math.min(startY + tileH, height)

        const hist = new Array(256).fill(0)
        let pixelCount = 0

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * width + x
            hist[channel[idx]]++
            pixelCount++
          }
        }

        const excess = hist.reduce((sum, count) => sum + Math.max(0, count - clipLimit * pixelCount / 256), 0)
        if (excess > 0) {
          const redistribution = excess / 256
          for (let i = 0; i < 256; i++) {
            hist[i] = Math.min(hist[i], clipLimit * pixelCount / 256) + redistribution
          }
        }

        const cdf = this.createCDF(hist)
        tileHistograms[gy][gx] = { cdf, totalPixels: pixelCount }
      }
    }

    const result = new Uint8Array(channel.length)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = channel[y * width + x]

        const gx = x / tileW - 0.5
        const gy = y / tileH - 0.5

        const gx1 = Math.max(0, Math.floor(gx))
        const gx2 = Math.min(gridW - 1, gx1 + 1)
        const gy1 = Math.max(0, Math.floor(gy))
        const gy2 = Math.min(gridH - 1, gy1 + 1)

        const fx = gx - gx1
        const fy = gy - gy1

        const getMapped = (tileHist) => {
          const cdf = tileHist.cdf[value]
          const cdfMin = tileHist.cdf.find(v => v > 0) || 0
          if (tileHist.totalPixels - cdfMin <= 0) return value
          return ((cdf - cdfMin) / (tileHist.totalPixels - cdfMin)) * 255
        }

        const v11 = getMapped(tileHistograms[gy1][gx1])
        const v12 = getMapped(tileHistograms[gy1][gx2])
        const v21 = getMapped(tileHistograms[gy2][gx1])
        const v22 = getMapped(tileHistograms[gy2][gx2])

        const v1 = v11 * (1 - fx) + v12 * fx
        const v2 = v21 * (1 - fx) + v22 * fx
        const v = v1 * (1 - fy) + v2 * fy

        result[y * width + x] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }

    return result
  }

  enhance(source) {
    if (!this.enableEnhancement) {
      return source
    }

    let width, height, imageData

    if (source instanceof HTMLVideoElement || source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      width = source.videoWidth || source.width
      height = source.videoHeight || source.height
      
      if (width === 0 || height === 0) {
        return source
      }

      this.processCanvas.width = width
      this.processCanvas.height = height
      this.processCtx.drawImage(source, 0, 0)
      imageData = this.processCtx.getImageData(0, 0, width, height)
    } else if (source instanceof ImageData) {
      width = source.width
      height = source.height
      imageData = source
    } else {
      return source
    }

    const brightness = this.calculateBrightness(imageData)
    this.enhancementLevel = Math.max(0, Math.min(1, (this.brightnessThreshold - brightness) / this.brightnessThreshold))

    if (brightness >= this.brightnessThreshold) {
      this.enhancementLevel = 0
      return source
    }

    const data = imageData.data
    const yChannel = new Uint8Array(width * height)

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      yChannel[j] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    }

    const enhancedY = this.claheChannel(yChannel, width, height)

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const oldY = yChannel[j]
      const newY = enhancedY[j]
      
      if (oldY === 0) oldY === 1
      
      const ratio = newY / Math.max(1, oldY)
      
      data[i] = Math.max(0, Math.min(255, data[i] * ratio))
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * ratio))
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * ratio))
    }

    this.processCtx.putImageData(imageData, 0, 0)
    return this.processCanvas
  }

  getEnhancementInfo() {
    return {
      enabled: this.enableEnhancement,
      level: this.enhancementLevel,
      threshold: this.brightnessThreshold
    }
  }

  setOptions(options) {
    if (options.enableEnhancement !== undefined) {
      this.enableEnhancement = options.enableEnhancement
    }
    if (options.clipLimit !== undefined) {
      this.clipLimit = options.clipLimit
    }
    if (options.brightnessThreshold !== undefined) {
      this.brightnessThreshold = options.brightnessThreshold
    }
  }
}

export { ImageEnhancer }

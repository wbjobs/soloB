class ExportManager {
  constructor() {
    this.isExporting = false
    this.progress = 0
    this.status = 'idle'
    this.listeners = []
    this.currentOperation = null
    this.resultBlob = null
    this.resultURL = null
  }

  subscribe(listener) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  notify() {
    this.listeners.forEach(listener => listener(this.getState()))
  }

  getState() {
    return {
      isExporting: this.isExporting,
      progress: this.progress,
      status: this.status,
      currentOperation: this.currentOperation,
      resultBlob: this.resultBlob,
      resultURL: this.resultURL
    }
  }

  setProgress(progress) {
    this.progress = progress
    this.notify()
  }

  setStatus(status, operation = null) {
    this.status = status
    if (operation) {
      this.currentOperation = operation
    }
    this.notify()
  }

  async startExport(exportFn, operationName) {
    if (this.isExporting) {
      throw new Error('已有导出任务正在进行')
    }

    this.isExporting = true
    this.progress = 0
    this.resultBlob = null
    this.resultURL = null
    this.setStatus('running', operationName)

    try {
      this.setProgress(5)

      const data = await exportFn((progress) => {
        this.setProgress(5 + Math.min(progress * 0.9, 90))
      })

      this.setProgress(95)

      const blob = new Blob([data], { type: 'video/mp4' })
      this.resultBlob = blob
      this.resultURL = URL.createObjectURL(blob)

      this.setProgress(100)
      this.setStatus('completed')

      return this.resultURL
    } catch (error) {
      console.error('导出失败:', error)
      this.setStatus('error')
      throw error
    } finally {
      this.isExporting = false
      this.notify()
    }
  }

  download(fileName = 'output.mp4') {
    if (!this.resultURL) {
      throw new Error('没有可下载的文件')
    }

    const link = document.createElement('a')
    link.href = this.resultURL
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  reset() {
    if (this.resultURL) {
      URL.revokeObjectURL(this.resultURL)
    }
    this.isExporting = false
    this.progress = 0
    this.status = 'idle'
    this.currentOperation = null
    this.resultBlob = null
    this.resultURL = null
    this.notify()
  }

  destroy() {
    this.reset()
    this.listeners = []
  }
}

const exportManager = new ExportManager()

export default exportManager

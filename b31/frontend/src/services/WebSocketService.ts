import { WaveParameters, WebSocketMessage } from '../types'

type DataCallback = (data: number[], time: number) => void
type ParamsCallback = (params: WaveParameters) => void

class WebSocketService {
  private ws: WebSocket | null = null
  private dataCallbacks: DataCallback[] = []
  private paramsCallbacks: ParamsCallback[] = []
  private url: string
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 10
  private reconnectDelay: number = 2000

  constructor(url: string = 'ws://localhost:8000/ws/wave') {
    this.url = url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)
        
        this.ws.onopen = () => {
          console.log('WebSocket connected')
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data)
            this.handleMessage(message)
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e)
          }
        }

        this.ws.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code)
          this.ws = null
          this.attemptReconnect()
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          reject(error)
        }
      } catch (e) {
        reject(e)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)
      
      setTimeout(() => {
        this.connect().catch(() => {
          console.log('Reconnection failed')
        })
      }, this.reconnectDelay)
    } else {
      console.log('Max reconnection attempts reached')
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'wave_data':
        this.dataCallbacks.forEach(callback => {
          callback(message.data, message.time)
        })
        break
      case 'params_updated':
        this.paramsCallbacks.forEach(callback => {
          callback(message.params)
        })
        break
    }
  }

  updateParameters(params: WaveParameters): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'update_params',
        params: params
      }))
    }
  }

  onData(callback: DataCallback): () => void {
    this.dataCallbacks.push(callback)
    return () => {
      this.dataCallbacks = this.dataCallbacks.filter(cb => cb !== callback)
    }
  }

  onParamsUpdated(callback: ParamsCallback): () => void {
    this.paramsCallbacks.push(callback)
    return () => {
      this.paramsCallbacks = this.paramsCallbacks.filter(cb => cb !== callback)
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

export default new WebSocketService()

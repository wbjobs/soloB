import { useEffect, useRef, useState, useCallback } from 'react'
import { SyscallEvent } from '../types'

const MAX_RECONNECT_DELAY = 30000
const INITIAL_RECONNECT_DELAY = 1000
const BACKOFF_MULTIPLIER = 2

export function useWebSocket(url: string) {
  const [events, setEvents] = useState<SyscallEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectCount, setReconnectCount] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const isManuallyClosedRef = useRef(false)
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY)

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const resetReconnectDelay = useCallback(() => {
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY
    setReconnectCount(0)
  }, [])

  const connect = useCallback(() => {
    if (isManuallyClosedRef.current) {
      return
    }

    clearReconnectTimeout()

    console.log(`Attempting WebSocket connection to ${url} (retry #${reconnectCount})`)
    
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        resetReconnectDelay()
        console.log('WebSocket connected successfully')
      }

      ws.onmessage = (event) => {
        try {
          const data: SyscallEvent = JSON.parse(event.data)
          setEvents(prev => [data, ...prev].slice(0, 1000))
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      ws.onclose = (event) => {
        setIsConnected(false)
        console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`)
        
        if (!isManuallyClosedRef.current) {
          const delay = reconnectDelayRef.current
          console.log(`Reconnecting in ${delay}ms...`)
          
          reconnectTimeoutRef.current = window.setTimeout(() => {
            setReconnectCount(prev => prev + 1)
            reconnectDelayRef.current = Math.min(
              delay * BACKOFF_MULTIPLIER,
              MAX_RECONNECT_DELAY
            )
            connect()
          }, delay)
        }
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      
      const delay = reconnectDelayRef.current
      reconnectTimeoutRef.current = window.setTimeout(() => {
        setReconnectCount(prev => prev + 1)
        reconnectDelayRef.current = Math.min(
          delay * BACKOFF_MULTIPLIER,
          MAX_RECONNECT_DELAY
        )
        connect()
      }, delay)
    }
  }, [url, reconnectCount, clearReconnectTimeout, resetReconnectDelay])

  const disconnect = useCallback(() => {
    isManuallyClosedRef.current = true
    clearReconnectTimeout()
    
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [clearReconnectTimeout])

  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])

  useEffect(() => {
    isManuallyClosedRef.current = false
    connect()

    return () => {
      disconnect()
    }
  }, [url, connect, disconnect])

  return { 
    events, 
    isConnected, 
    clearEvents, 
    reconnectCount,
    disconnect 
  }
}

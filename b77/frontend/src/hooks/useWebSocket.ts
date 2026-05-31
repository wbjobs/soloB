import { useEffect, useRef, useCallback } from 'react';
import { useRenderStore } from '../store/useRenderStore';

export const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const lastHeartbeatRef = useRef<number>(Date.now());
  const { setConnected, addTile, setCurrentTask, setDebugData, addRenderHistory } = useRenderStore();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//localhost:8080/ws`;

    const ws = new WebSocket(wsUrl);
    lastHeartbeatRef.current = Date.now();

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      lastHeartbeatRef.current = Date.now();

      if (event.data instanceof Blob) {
        return;
      }

      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      setTimeout(connect, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [setConnected]);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'tile_result':
        addTile({
          tileX: message.tileX,
          tileY: message.tileY,
          tileWidth: message.tileWidth,
          tileHeight: message.tileHeight,
          pixels: new Uint8ClampedArray(message.pixels),
        });
        break;
      case 'task_status':
        const task = {
          taskId: message.taskId,
          status: message.status,
          progress: message.progress,
          totalTiles: message.totalTiles,
          completedTiles: message.completedTiles,
          renderTimeMs: message.renderTimeMs,
          adaptiveSampling: message.adaptiveSampling,
          totalSamples: message.totalSamples,
          samplesSaved: message.samplesSaved,
        };
        setCurrentTask(task);

        if (message.status === 'completed' && message.renderTimeMs) {
          addRenderHistory({
            taskId: message.taskId,
            timestamp: Date.now(),
            renderTimeMs: message.renderTimeMs,
            adaptiveSampling: message.adaptiveSampling,
            totalSamples: message.totalSamples,
            samplesSaved: message.samplesSaved || 0,
          });
        }
        break;
      case 'debug_pixel_result':
        setDebugData(message);
        break;
    }
  }, [addTile, setCurrentTask, setDebugData, addRenderHistory]);

  const send = useCallback((request: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(request));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  const sendRenderRequest = useCallback((objData: string, params: any) => {
    send({
      type: 'render_request',
      objData,
      params: {
        ...params,
        adaptiveSampling: params.adaptiveSampling,
        edgeThreshold: params.edgeThreshold,
        maxSamples: params.maxSamples,
      },
    });
  }, [send]);

  const sendDebugPixelRequest = useCallback((taskId: string, x: number, y: number) => {
    send({
      type: 'debug_pixel',
      taskId,
      x,
      y,
    });
  }, [send]);

  useEffect(() => {
    connect();

    const heartbeatCheck = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeatRef.current > 90000) {
        console.log('Heartbeat timeout, reconnecting...');
        wsRef.current?.close();
      }
    }, 30000);

    return () => {
      clearInterval(heartbeatCheck);
      wsRef.current?.close();
    };
  }, [connect]);

  return { sendRenderRequest, sendDebugPixelRequest };
};

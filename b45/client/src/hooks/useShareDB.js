import { useState, useEffect, useRef, useCallback } from 'react';
import ShareDB from 'sharedb/lib/client';
import ReconnectingWebSocket from 'reconnecting-websocket';

const WS_URL = window.location.protocol === 'https:' 
  ? `wss://${window.location.host}` 
  : `ws://${window.location.hostname}:3001`;

export function useShareDB(docId = 'default') {
  const [code, setCode] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [docData, setDocData] = useState(null);
  
  const connectionRef = useRef(null);
  const docRef = useRef(null);
  const socketRef = useRef(null);
  const isRemoteChangeRef = useRef(false);
  const isLocalChangeRef = useRef(false);

  const defaultShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float iTime;
uniform vec2 iResolution;
uniform vec4 iMouse;

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));
    fragColor = vec4(col, 1.0);
}`;

  useEffect(() => {
    let mounted = true;
    
    const createSocket = () => {
      const socket = new ReconnectingWebSocket(WS_URL, null, {
        maxReconnectionDelay: 5000,
        minReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.3,
        connectionTimeout: 4000,
        maxRetries: Infinity,
        debug: false,
      });
      return socket;
    };

    const socket = createSocket();
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      if (!mounted) return;
      console.log('WebSocket connected');
      setIsConnected(true);
      setError(null);
    });

    socket.addEventListener('close', () => {
      if (!mounted) return;
      console.log('WebSocket disconnected');
      setIsConnected(false);
    });

    socket.addEventListener('error', (err) => {
      if (!mounted) return;
      console.error('WebSocket error:', err);
      setError('Connection error, attempting to reconnect...');
    });

    const connection = new ShareDB.Connection(socket);
    connectionRef.current = connection;

    connection.on('state', (state) => {
      console.log('ShareDB connection state:', state);
      if (state === 'connected') {
        setIsConnected(true);
      } else if (state === 'disconnected') {
        setIsConnected(false);
      }
    });

    connection.on('error', (err) => {
      console.error('ShareDB connection error:', err);
      setError('Connection error');
    });

    const doc = connection.get('shaders', docId);
    docRef.current = doc;

    doc.subscribe((err) => {
      if (!mounted) return;
      
      if (err) {
        console.error('Failed to subscribe to document:', err);
        setError('Failed to load document: ' + err.message);
        setIsLoading(false);
        setCode(defaultShader);
        return;
      }

      console.log('Document subscribed, type:', doc.type);

      if (doc.type === null) {
        console.log('Document does not exist, creating...');
        doc.create({
          title: 'My Shader',
          code: defaultShader,
          createdAt: Date.now()
        }, (err) => {
          if (!mounted) return;
          
          if (err) {
            console.error('Failed to create document:', err);
            setError('Failed to create document: ' + err.message);
            setCode(defaultShader);
          } else {
            console.log('Document created successfully');
            setCode(defaultShader);
            setDocData(doc.data);
          }
          setIsLoading(false);
        });
      } else {
        console.log('Document loaded');
        setCode(doc.data ? doc.data.code || '' : '');
        setDocData(doc.data);
        setIsLoading(false);
      }
    });

    doc.on('op', (op, source) => {
      if (!mounted) return;
      
      console.log('Operation received, source:', source ? 'local' : 'remote');
      
      if (!source) {
        isRemoteChangeRef.current = true;
        if (doc.data && doc.data.code !== undefined) {
          setCode(doc.data.code);
          setDocData({ ...doc.data });
        }
        setTimeout(() => {
          isRemoteChangeRef.current = false;
        }, 50);
      }
    });

    doc.on('load', () => {
      console.log('Document loaded event');
    });

    doc.on('create', () => {
      console.log('Document created event');
    });

    doc.on('del', () => {
      console.log('Document deleted event');
      setError('Document was deleted');
    });

    return () => {
      mounted = false;
      
      console.log('Cleaning up ShareDB connection');
      
      if (doc) {
        try {
          doc.unsubscribe();
        } catch (err) {
          console.error('Error unsubscribing:', err);
        }
      }
      
      if (connection) {
        try {
          connection.close();
        } catch (err) {
          console.error('Error closing connection:', err);
        }
      }
      
      if (socket) {
        try {
          socket.close();
        } catch (err) {
          console.error('Error closing socket:', err);
        }
      }
    };
  }, [docId, defaultShader]);

  const submitOp = useCallback((newCode) => {
    const doc = docRef.current;
    if (!doc || !doc.subscribed) {
      console.warn('Document not ready, cannot submit op');
      return;
    }

    const currentCode = doc.data ? doc.data.code || '' : '';
    if (currentCode === newCode) {
      return;
    }

    try {
      const op = [
        { p: ['code'], od: currentCode, oi: newCode }
      ];
      
      isLocalChangeRef.current = true;
      
      doc.submitOp(op, (err) => {
        isLocalChangeRef.current = false;
        
        if (err) {
          console.error('Failed to submit operation:', err);
          setError('Failed to sync: ' + err.message);
        }
      });
    } catch (err) {
      console.error('Error submitting operation:', err);
      isLocalChangeRef.current = false;
    }
  }, []);

  const updateCode = useCallback((newCode) => {
    if (isRemoteChangeRef.current) {
      return;
    }
    
    setCode(newCode);
    submitOp(newCode);
  }, [submitOp]);

  return {
    code,
    setCode: updateCode,
    isConnected,
    isLoading,
    error,
    docData,
    isRemoteChangeRef,
  };
}

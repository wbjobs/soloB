import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import useStore from '../store';

function useSocket(scoreId) {
  const [socket, setSocket] = useState(null);
  const { token } = useStore();
  const socketRef = useRef(null);

  useEffect(() => {
    if (!token || !scoreId) return;

    const newSocket = io({
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('Socket 连接成功');
      newSocket.emit('join-room', { scoreId });
    });

    newSocket.on('disconnect', () => {
      console.log('Socket 断开连接');
    });

    newSocket.on('error', (error) => {
      console.error('Socket 错误:', error);
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      newSocket.emit('leave-room', { scoreId });
      newSocket.disconnect();
    };
  }, [token, scoreId]);

  return { socket };
}

export default useSocket;

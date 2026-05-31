import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useConferenceStore } from '../store/useConferenceStore';

const PEER_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export const useWebRTC = () => {
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const {
    userId,
    roomId,
    localStream,
    addParticipant,
    removeParticipant,
    updateParticipant,
    setLocalStream,
    setSocketConnected,
    isVideoEnabled,
    isAudioEnabled
  } = useConferenceStore();

  const initLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Failed to get local stream:', error);
      throw error;
    }
  }, [setLocalStream]);

  const createPeerConnection = useCallback((targetId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(PEER_CONFIG);
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      addParticipant({
        id: targetId,
        stream,
        videoEnabled: true,
        audioEnabled: true
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          target: targetId,
          candidate: event.candidate
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || 
          pc.iceConnectionState === 'failed') {
        removeParticipant(targetId);
        peerConnectionsRef.current.delete(targetId);
      }
    };

    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }, [localStream, addParticipant, removeParticipant]);

  const createOffer = useCallback(async (targetId: string) => {
    const pc = peerConnectionsRef.current.get(targetId) || createPeerConnection(targetId);
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (socketRef.current) {
        socketRef.current.emit('offer', {
          target: targetId,
          offer
        });
      }
    } catch (error) {
      console.error('Failed to create offer:', error);
    }
  }, [createPeerConnection]);

  const handleOffer = useCallback(async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
    const pc = peerConnectionsRef.current.get(data.from) || createPeerConnection(data.from);
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (socketRef.current) {
        socketRef.current.emit('answer', {
          target: data.from,
          answer
        });
      }
    } catch (error) {
      console.error('Failed to handle offer:', error);
    }
  }, [createPeerConnection]);

  const handleAnswer = useCallback(async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
    const pc = peerConnectionsRef.current.get(data.from);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (error) {
        console.error('Failed to handle answer:', error);
      }
    }
  }, []);

  const handleIceCandidate = useCallback(async (data: { from: string; candidate: RTCIceCandidateInit }) => {
    const pc = peerConnectionsRef.current.get(data.from);
    if (pc && data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('Failed to add ICE candidate:', error);
      }
    }
  }, []);

  const setupSocketListeners = useCallback((socket: Socket, roomId: string, userId: string) => {
    socket.on('connect', () => {
      console.log('[Socket] Connected');
      setSocketConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setSocketConnected(false);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
      setSocketConnected(true);
      if (roomId && userId) {
        console.log('[Socket] Rejoining room after reconnect');
        socket.emit('join-room', roomId, userId);
      }
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('[Socket] Reconnect attempt:', attemptNumber);
    });

    socket.on('reconnect_failed', () => {
      console.log('[Socket] Reconnect failed');
    });

    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    
    socket.on('user-joined', (newUserId: string) => {
      if (newUserId !== userId) {
        createOffer(newUserId);
      }
    });
    
    socket.on('user-left', (leftUserId: string) => {
      removeParticipant(leftUserId);
      peerConnectionsRef.current.delete(leftUserId);
    });
    
    socket.on('participants', (userIds: string[]) => {
      userIds.forEach(participantId => {
        if (participantId !== userId && !peerConnectionsRef.current.has(participantId)) {
          createOffer(participantId);
        }
      });
    });

    socket.on('video-toggled', (userId: string, enabled: boolean) => {
      updateParticipant(userId, { videoEnabled: enabled });
    });

    socket.on('audio-toggled', (userId: string, enabled: boolean) => {
      updateParticipant(userId, { audioEnabled: enabled });
    });
  }, [handleOffer, handleAnswer, handleIceCandidate, createOffer, removeParticipant, updateParticipant, setSocketConnected]);

  const joinRoom = useCallback(async (roomId: string, userId: string) => {
    if (!socketRef.current) {
      console.log('[WebRTC] Creating new socket connection');
      socketRef.current = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001', {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000
      });
      
      setupSocketListeners(socketRef.current, roomId, userId);
    }

    if (!localStream) {
      await initLocalStream();
    }

    console.log('[WebRTC] Joining room:', roomId, 'user:', userId);
    socketRef.current.emit('join-room', roomId, userId);
  }, [localStream, initLocalStream, setupSocketListeners]);

  const leaveRoom = useCallback(() => {
    console.log('[WebRTC] Leaving room');
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current && roomId) {
      socketRef.current.emit('leave-room', roomId, userId);
    }

    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setSocketConnected(false);
  }, [roomId, userId, localStream, setLocalStream, setSocketConnected]);

  const toggleVideoBroadcast = useCallback(() => {
    if (socketRef.current && roomId) {
      socketRef.current.emit('toggle-video', roomId, userId, !isVideoEnabled);
    }
  }, [socketRef, roomId, userId, isVideoEnabled]);

  const toggleAudioBroadcast = useCallback(() => {
    if (socketRef.current && roomId) {
      socketRef.current.emit('toggle-audio', roomId, userId, !isAudioEnabled);
    }
  }, [socketRef, roomId, userId, isAudioEnabled]);

  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, [leaveRoom]);

  return {
    initLocalStream,
    joinRoom,
    leaveRoom,
    toggleVideoBroadcast,
    toggleAudioBroadcast
  };
};

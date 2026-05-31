import { useState, useCallback, useRef, useEffect } from 'react';
import { LiveCaption } from '../types';
import { socketService } from '../services/socket';

export interface AudioChunkCapture {
  id: string;
  startTime: number;
  endTime: number;
  blob: Blob;
}

export function useLiveCaptions(sessionId: string | null) {
  const [captions, setCaptions] = useState<LiveCaption[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);

  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioChunkTimerRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const chunkStartTimeRef = useRef<number>(0);

  const generateChunkId = () => {
    return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  const startAudioCapture = useCallback((audioStream: MediaStream) => {
    if (!audioStream) {
      console.warn('No audio stream provided for live captions');
      return;
    }

    const mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    audioChunksRef.current = [];
    recordingStartTimeRef.current = Date.now();
    chunkStartTimeRef.current = 0;
    setIsCapturing(true);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (audioChunksRef.current.length > 0 && sessionId) {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const now = Date.now();
        const endTime = (now - recordingStartTimeRef.current) / 1000;

        const reader = new FileReader();
        reader.onload = () => {
          const arrayBuffer = reader.result as ArrayBuffer;
          const chunkId = generateChunkId();

          socketService.emit('recorder:audioChunk', {
            sessionId,
            chunkId,
            startTime: chunkStartTimeRef.current,
            endTime,
            audioData: Array.from(new Uint8Array(arrayBuffer)),
          });

          chunkStartTimeRef.current = endTime;
        };
        reader.readAsArrayBuffer(blob);
        audioChunksRef.current = [];
      }
    };

    mediaRecorder.start(1000);

    audioChunkTimerRef.current = window.setInterval(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.start(1000);
      }
    }, 3000);

    return mediaRecorder;
  }, [sessionId]);

  const stopAudioCapture = useCallback(() => {
    if (audioChunkTimerRef.current) {
      clearInterval(audioChunkTimerRef.current);
      audioChunkTimerRef.current = null;
    }
    audioChunksRef.current = [];
    setIsCapturing(false);
  }, []);

  const handleNewCaption = useCallback((caption: LiveCaption) => {
    setCaptions((prev) => {
      const existing = prev.find((c) => c.id === caption.id);
      if (existing) {
        return prev.map((c) => (c.id === caption.id ? { ...c, ...caption } : c));
      }
      return [...prev, caption].sort((a, b) => a.startTime - b.startTime);
    });
  }, []);

  const handleCaptionUpdated = useCallback((updated: { id: string; textZh: string; textEn?: string; isEdited: boolean }) => {
    setCaptions((prev) =>
      prev.map((c) =>
        c.id === updated.id
          ? { ...c, textZh: updated.textZh, textEn: updated.textEn, isEdited: updated.isEdited }
          : c
      )
    );
  }, []);

  const editCaption = useCallback(
    (captionId: string, textZh: string, textEn?: string) => {
      if (!sessionId) return;
      socketService.emit('caption:edit', {
        sessionId,
        captionId,
        textZh,
        textEn: textEn || '',
      });
      setEditingCaptionId(null);
    },
    [sessionId]
  );

  const getRecentCaptions = useCallback((count: number = 5): LiveCaption[] => {
    return captions.slice(-count);
  }, [captions]);

  const getLatestCaption = useCallback((): LiveCaption | null => {
    return captions.length > 0 ? captions[captions.length - 1] : null;
  }, [captions]);

  useEffect(() => {
    if (!sessionId) return;

    socketService.on('caption:new', handleNewCaption);
    socketService.on('caption:updated', handleCaptionUpdated);

    return () => {
      socketService.off('caption:new');
      socketService.off('caption:updated');
    };
  }, [sessionId, handleNewCaption, handleCaptionUpdated]);

  useEffect(() => {
    return () => {
      stopAudioCapture();
    };
  }, [stopAudioCapture]);

  return {
    captions,
    isCapturing,
    editingCaptionId,
    setEditingCaptionId,
    startAudioCapture,
    stopAudioCapture,
    editCaption,
    getRecentCaptions,
    getLatestCaption,
  };
}

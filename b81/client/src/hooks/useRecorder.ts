import { useState, useRef, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { socketService } from '../services/socket';
import { RecordingState, ProcessingState } from '../types';
import { AudioBufferPool, AudioVideoSynchronizer, createSyncConstraints, getRecorderOptions } from '../utils/AudioSyncManager';

const SEGMENT_DURATION = 5 * 60 * 1000;
const DRIFT_CHECK_INTERVAL = 2000;
const MAX_CORRECTION_FACTOR = 0.1;

export function useRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    sessionId: null,
    title: '',
    duration: 0,
    currentSegment: 1,
  });

  const [processingState, setProcessingState] = useState<ProcessingState>({
    isProcessing: false,
    progress: 0,
    status: '',
  });

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const segmentIntervalRef = useRef<number | null>(null);
  const driftCheckIntervalRef = useRef<number | null>(null);
  const audioBufferPoolRef = useRef<AudioBufferPool | null>(null);
  const synchronizerRef = useRef<AudioVideoSynchronizer | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const driftInfoRef = useRef<{ drift: number; avgDrift: number; trend: string }>({ drift: 0, avgDrift: 0, trend: 'stable' });

  const requestMediaDevices = async (): Promise<{ combinedStream: MediaStream; audioOnlyStream: MediaStream }> => {
    const audioConstraints = createSyncConstraints().audio as MediaTrackConstraints;
    
    const [audioStream, screenStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: audioConstraints }),
      navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: 30,
        },
        audio: true,
      }),
    ]);

    const audioOnlyStream = audioStream.clone();

    const combinedStream = new MediaStream([
      ...screenStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    screenStream.getAudioTracks().forEach((track) => {
      combinedStream.addTrack(track);
    });

    audioStream.getTracks().forEach((track) => {
      track.onended = () => {
        console.log('Track ended:', track.kind);
      };
    });

    return { combinedStream, audioOnlyStream };
  };

  const startRecording = useCallback(async (title: string) => {
    try {
      const sessionId = uuidv4();
      const { combinedStream, audioOnlyStream } = await requestMediaDevices();
      mediaStreamRef.current = combinedStream;
      audioStreamRef.current = audioOnlyStream;

      audioBufferPoolRef.current = new AudioBufferPool(100);
      synchronizerRef.current = new AudioVideoSynchronizer();
      
      const now = Date.now();
      synchronizerRef.current.setVideoStartTime(now);
      synchronizerRef.current.setAudioStartTime(now);
      audioBufferPoolRef.current.setBaseTimestamp(now);

      const recorderOptions = getRecorderOptions();
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          socketService.emit('recorder:data', {
            sessionId,
            data: event.data,
          });
        }
      };

      mediaRecorder.start(1000);

      socketService.emit('recorder:start', { sessionId, title });

      setRecordingState({
        isRecording: true,
        isPaused: false,
        sessionId,
        title,
        duration: 0,
        currentSegment: 1,
      });

      durationIntervalRef.current = window.setInterval(() => {
        setRecordingState((prev) => ({
          ...prev,
          duration: prev.duration + 1,
        }));
      }, 1000);

      segmentIntervalRef.current = window.setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.requestData();
          socketService.emit('recorder:segment', { sessionId });
          setRecordingState((prev) => ({
            ...prev,
            currentSegment: prev.currentSegment + 1,
          }));
        }
      }, SEGMENT_DURATION);

      driftCheckIntervalRef.current = window.setInterval(() => {
        if (synchronizerRef.current && recordingState.isRecording && !recordingState.isPaused) {
          const drift = synchronizerRef.current.getCurrentDrift();
          synchronizerRef.current.recordDrift(drift);
          
          const avgDrift = synchronizerRef.current.getAverageDrift();
          const trend = synchronizerRef.current.getTrend();
          
          driftInfoRef.current = { drift, avgDrift, trend };

          if (Math.abs(avgDrift) > 300) {
            socketService.emit('recorder:syncInfo', {
              sessionId,
              drift: avgDrift,
              trend,
              timestamp: Date.now(),
            });
          }
        }
      }, DRIFT_CHECK_INTERVAL);

      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

      return sessionId;
    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingState.isRecording) {
      mediaRecorderRef.current.pause();
      
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      if (segmentIntervalRef.current) {
        clearInterval(segmentIntervalRef.current);
        segmentIntervalRef.current = null;
      }

      setRecordingState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [recordingState.isRecording]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingState.isPaused) {
      mediaRecorderRef.current.resume();
      
      durationIntervalRef.current = window.setInterval(() => {
        setRecordingState((prev) => ({
          ...prev,
          duration: prev.duration + 1,
        }));
      }, 1000);

      segmentIntervalRef.current = window.setInterval(() => {
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.requestData();
          socketService.emit('recorder:segment', { 
            sessionId: recordingState.sessionId 
          });
          setRecordingState((prev) => ({
            ...prev,
            currentSegment: prev.currentSegment + 1,
          }));
        }
      }, SEGMENT_DURATION);

      setRecordingState((prev) => ({ ...prev, isPaused: false }));
    }
  }, [recordingState.isPaused, recordingState.sessionId]);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (segmentIntervalRef.current) {
      clearInterval(segmentIntervalRef.current);
      segmentIntervalRef.current = null;
    }
    if (driftCheckIntervalRef.current) {
      clearInterval(driftCheckIntervalRef.current);
      driftCheckIntervalRef.current = null;
    }

    if (synchronizerRef.current) {
      await synchronizerRef.current.close();
      synchronizerRef.current = null;
    }

    if (audioBufferPoolRef.current) {
      audioBufferPoolRef.current.clear();
      audioBufferPoolRef.current = null;
    }

    if (recordingState.sessionId) {
      socketService.emit('recorder:stop', { 
        sessionId: recordingState.sessionId,
        finalDrift: driftInfoRef.current.avgDrift,
      });
    }

    setRecordingState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
    }));

    setProcessingState({
      isProcessing: true,
      progress: 0,
      status: 'Starting processing...',
    });
  }, [recordingState.sessionId]);

  useEffect(() => {
    const handleProgress = ({ progress, status }: { progress: number; status: string }) => {
      setProcessingState((prev) => ({
        ...prev,
        progress,
        status,
      }));
    };

    const handleStopped = () => {
      setProcessingState({
        isProcessing: false,
        progress: 100,
        status: 'Completed!',
      });
    };

    socketService.on('processing:progress', handleProgress);
    socketService.on('recorder:stopped', handleStopped);

    return () => {
      socketService.off('processing:progress', handleProgress);
      socketService.off('recorder:stopped', handleStopped);
    };
  }, []);

  useEffect(() => {
    socketService.connect();
    return () => {
      socketService.disconnect();
    };
  }, []);

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return {
    recordingState,
    processingState,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    formatDuration,
    mediaStream: mediaStreamRef.current,
    audioStream: audioStreamRef.current,
  };
}

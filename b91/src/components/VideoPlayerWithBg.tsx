import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, VideoOff } from 'lucide-react';
import { useBackgroundSeg } from '../hooks/useBackgroundSeg';
import { BackgroundOption } from '../types';

interface VideoPlayerWithBgProps {
  stream?: MediaStream;
  userId: string;
  isLocal?: boolean;
  videoEnabled?: boolean;
  audioEnabled?: boolean;
  backgroundEnabled?: boolean;
  currentBackground?: BackgroundOption | null;
  className?: string;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

export const VideoPlayerWithBg = ({
  stream,
  userId,
  isLocal = false,
  videoEnabled = true,
  audioEnabled = true,
  backgroundEnabled = false,
  currentBackground,
  className = '',
  onCanvasReady
}: VideoPlayerWithBgProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const { modelLoaded, startSegmentation, stopSegmentation, setCustomBackgroundImage } = useBackgroundSeg();

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = isLocal;
    }
  }, [stream, isLocal]);

  useEffect(() => {
    if (currentBackground?.type === 'image' && currentBackground.value) {
      setCustomBackgroundImage(currentBackground.value);
    }
  }, [currentBackground, setCustomBackgroundImage]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsVideoPlaying(true);
    video.addEventListener('play', handlePlay);

    return () => video.removeEventListener('play', handlePlay);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideoPlaying || !backgroundEnabled || !currentBackground || !modelLoaded) {
      stopSegmentation();
      return;
    }

    startSegmentation(video, currentBackground, (canvas) => {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          canvasRef.current.width = canvas.width;
          canvasRef.current.height = canvas.height;
          ctx.drawImage(canvas, 0, 0);
        }
      }
      if (onCanvasReady) {
        onCanvasReady(canvas);
      }
    });

    return () => stopSegmentation();
  }, [isVideoPlaying, backgroundEnabled, currentBackground, modelLoaded, startSegmentation, stopSegmentation, onCanvasReady]);

  const displayUserId = userId.length > 8
    ? userId.substring(userId.length - 8)
    : userId;

  const showCanvas = backgroundEnabled && modelLoaded && currentBackground;

  return (
    <div className={`relative rounded-xl overflow-hidden bg-gray-900 ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          !videoEnabled || showCanvas ? 'opacity-0 absolute' : 'opacity-100'
        }`}
      />

      {showCanvas && (
        <canvas
          ref={canvasRef}
          className="w-full h-full object-cover"
        />
      )}

      {!videoEnabled && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
          <VideoOff className="w-16 h-16 text-gray-500 mb-4" />
          <span className="text-gray-400 text-sm">Camera Off</span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-medium">
              {isLocal ? 'You' : `User ${displayUserId}`}
            </span>
            {isLocal && (
              <span className="px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                You
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {audioEnabled ? (
              <Mic className="w-4 h-4 text-green-400" />
            ) : (
              <MicOff className="w-4 h-4 text-red-400" />
            )}
          </div>
        </div>
      </div>

      {isLocal && (
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-white text-xs">Live</span>
        </div>
      )}

      {backgroundEnabled && !modelLoaded && (
        <div className="absolute top-3 right-3">
          <div className="px-3 py-1 bg-yellow-500/80 text-white text-xs rounded-full flex items-center gap-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            Loading AI Model...
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayerWithBg;

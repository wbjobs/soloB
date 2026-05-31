import { useEffect, useRef } from 'react';
import { Video, Mic, MicOff, VideoOff } from 'lucide-react';

interface VideoPlayerProps {
  stream?: MediaStream;
  userId: string;
  isLocal?: boolean;
  videoEnabled?: boolean;
  audioEnabled?: boolean;
  showControls?: boolean;
  className?: string;
}

export const VideoPlayer = ({
  stream,
  userId,
  isLocal = false,
  videoEnabled = true,
  audioEnabled = true,
  showControls = false,
  className = ''
}: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = isLocal;
    }
  }, [stream, isLocal]);

  const displayUserId = userId.length > 8 
    ? userId.substring(userId.length - 8) 
    : userId;

  return (
    <div className={`relative rounded-xl overflow-hidden bg-gray-900 ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          !videoEnabled ? 'opacity-0' : 'opacity-100'
        }`}
      />
      
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
    </div>
  );
};

export default VideoPlayer;

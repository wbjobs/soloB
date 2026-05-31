import { Participant } from '../types';
import VideoPlayer from './VideoPlayer';
import VideoPlayerWithBg from './VideoPlayerWithBg';
import { BackgroundOption } from '../types';

interface VideoGridProps {
  participants: Map<string, Participant>;
  localUserId: string;
  localStream?: MediaStream | null;
  isLocalVideoEnabled: boolean;
  isLocalAudioEnabled: boolean;
  backgroundEnabled?: boolean;
  currentBackground?: BackgroundOption | null;
  onLocalCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

export const VideoGrid = ({
  participants,
  localUserId,
  localStream,
  isLocalVideoEnabled,
  isLocalAudioEnabled,
  backgroundEnabled = false,
  currentBackground,
  onLocalCanvasReady
}: VideoGridProps) => {
  const totalParticipants = participants.size + 1;

  const getGridClass = () => {
    switch (totalParticipants) {
      case 1:
        return 'grid-cols-1 grid-rows-1';
      case 2:
        return 'grid-cols-1 md:grid-cols-2';
      case 3:
        return 'grid-cols-1 md:grid-cols-2';
      case 4:
        return 'grid-cols-1 md:grid-cols-2';
      case 5:
      case 6:
        return 'grid-cols-1 md:grid-cols-3';
      default:
        return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
    }
  };

  const participantsArray = Array.from(participants.values());

  return (
    <div className={`w-full h-full grid gap-4 p-4 ${getGridClass()}`}>
      <div className="w-full h-full min-h-0">
        {backgroundEnabled && currentBackground ? (
          <VideoPlayerWithBg
            stream={localStream || undefined}
            userId={localUserId}
            isLocal
            videoEnabled={isLocalVideoEnabled}
            audioEnabled={isLocalAudioEnabled}
            backgroundEnabled={backgroundEnabled}
            currentBackground={currentBackground}
            onCanvasReady={onLocalCanvasReady}
            className="w-full h-full"
          />
        ) : (
          <VideoPlayer
            stream={localStream || undefined}
            userId={localUserId}
            isLocal
            videoEnabled={isLocalVideoEnabled}
            audioEnabled={isLocalAudioEnabled}
            className="w-full h-full"
          />
        )}
      </div>

      {participantsArray.map((participant) => (
        <div key={participant.id} className="w-full h-full min-h-0">
          <VideoPlayer
            stream={participant.stream}
            userId={participant.id}
            videoEnabled={participant.videoEnabled}
            audioEnabled={participant.audioEnabled}
            className="w-full h-full"
          />
        </div>
      ))}
    </div>
  );
};

export default VideoGrid;

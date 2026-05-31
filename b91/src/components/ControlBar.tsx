import { Video, VideoOff, Mic, MicOff, PhoneOff, Circle, Upload, Settings, PanelRightOpen, PanelRightClose } from 'lucide-react';

interface ControlBarProps {
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  isRecording: boolean;
  isRecordingLocked: boolean;
  isVoiceprintVerified: boolean;
  sidebarOpen: boolean;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onToggleRecording: () => void;
  onLeaveRoom: () => void;
  onToggleSidebar: () => void;
  recordingTime?: string;
}

export const ControlBar = ({
  isVideoEnabled,
  isAudioEnabled,
  isRecording,
  isRecordingLocked,
  isVoiceprintVerified,
  sidebarOpen,
  onToggleVideo,
  onToggleAudio,
  onToggleRecording,
  onLeaveRoom,
  onToggleSidebar,
  recordingTime = '00:00'
}: ControlBarProps) => {
  console.log('[ControlBar] Render - isVoiceprintVerified:', isVoiceprintVerified, 'isRecordingLocked:', isRecordingLocked);
  
  const isRecordButtonDisabled = !isRecording && isRecordingLocked && !isVoiceprintVerified;
  console.log('[ControlBar] Record button disabled:', isRecordButtonDisabled);
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20">
      <div className="mx-auto max-w-4xl px-4 pb-4">
        <div className="flex items-center justify-center gap-4 p-4 bg-gray-900/90 backdrop-blur-lg rounded-2xl border border-gray-700/50">
          <button
            onClick={onToggleVideo}
            className={`p-4 rounded-full transition-all duration-200 ${
              isVideoEnabled
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </button>

          <button
            onClick={onToggleAudio}
            className={`p-4 rounded-full transition-all duration-200 ${
              isAudioEnabled
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>

          <div className="relative">
            <button
              onClick={onToggleRecording}
              disabled={isRecordButtonDisabled}
              className={`p-4 rounded-full transition-all duration-200 ${
                isRecording
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                  : isRecordButtonDisabled
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
            >
              {isRecording ? (
                <div className="flex items-center gap-2">
                  <Circle className="w-6 h-6 fill-current" />
                  <span className="text-sm font-medium">{recordingTime}</span>
                </div>
              ) : (
                <Circle className="w-6 h-6" />
              )}
            </button>
            {isRecordButtonDisabled && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-yellow-500 text-white text-xs rounded-full whitespace-nowrap">
                🔒 声纹验证解锁录制
              </div>
            )}
          </div>

          <button
            onClick={onToggleSidebar}
            className={`p-4 rounded-full transition-all duration-200 ${
              sidebarOpen
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
          >
            {sidebarOpen ? <PanelRightClose className="w-6 h-6" /> : <PanelRightOpen className="w-6 h-6" />}
          </button>

          <button
            onClick={onLeaveRoom}
            className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all duration-200"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ControlBar;

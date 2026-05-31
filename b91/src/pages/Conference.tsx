import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useConferenceStore } from '../store/useConferenceStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useRecorder } from '../hooks/useRecorder';
import VideoGrid from '../components/VideoGrid';
import ControlBar from '../components/ControlBar';
import Sidebar from '../components/Sidebar';
import { BackgroundOption } from '../types';

const Conference = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const userId = useConferenceStore((state) => state.userId);
  const setUserId = useConferenceStore((state) => state.setUserId);
  const setRoomId = useConferenceStore((state) => state.setRoomId);
  const localStream = useConferenceStore((state) => state.localStream);
  const setLocalStream = useConferenceStore((state) => state.setLocalStream);
  const participants = useConferenceStore((state) => state.participants);
  const isVideoEnabled = useConferenceStore((state) => state.isVideoEnabled);
  const isAudioEnabled = useConferenceStore((state) => state.isAudioEnabled);
  const currentBackground = useConferenceStore((state) => state.currentBackground);
  const backgroundEnabled = useConferenceStore((state) => state.backgroundEnabled);
  const isVoiceprintVerified = useConferenceStore((state) => state.isVoiceprintVerified);
  const toggleVideo = useConferenceStore((state) => state.toggleVideo);
  const toggleAudio = useConferenceStore((state) => state.toggleAudio);
  const setCurrentBackground = useConferenceStore((state) => state.setCurrentBackground);
  const setBackgroundEnabled = useConferenceStore((state) => state.setBackgroundEnabled);
  const setVoiceprintVerified = useConferenceStore((state) => state.setVoiceprintVerified);
  const reset = useConferenceStore((state) => state.reset);

  console.log('[Conference] Current isVoiceprintVerified:', isVoiceprintVerified);

  const { joinRoom, leaveRoom, toggleVideoBroadcast, toggleAudioBroadcast } = useWebRTC();
  const { isRecording, recordingTime, startRecording, stopRecording, formatTime } = useRecorder();

  useEffect(() => {
    const newUserId = uuidv4();
    setUserId(newUserId);
    if (roomId) {
      setRoomId(roomId);
    }
  }, [roomId, setUserId, setRoomId]);

  const handleJoinRoom = async () => {
    try {
      await joinRoom(roomId || '', userId);
      setIsJoined(true);
    } catch (error) {
      console.error('Failed to join room:', error);
      alert('无法加入会议室，请检查设备权限');
    }
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    reset();
    navigate('/');
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else if (videoRef.current) {
      startRecording(videoRef.current, localStream || undefined);
    }
  };

  const handleSelectBackground = (bg: BackgroundOption | null) => {
    setCurrentBackground(bg);
  };

  const handleToggleBackground = (enabled: boolean) => {
    setBackgroundEnabled(enabled);
  };

  const handleVoiceprintVerify = (verified: boolean) => {
    setVoiceprintVerified(verified);
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">加入会议室</h1>
              <p className="text-gray-400">房间号: {roomId?.slice(-8)}</p>
            </div>

            <div className="space-y-4">
              <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden mb-6">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex gap-2 justify-center mb-6">
                <button
                  onClick={() => {
                    toggleVideo();
                    toggleVideoBroadcast();
                  }}
                  className={`p-3 rounded-full ${
                    isVideoEnabled
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-red-500 hover:bg-red-600 text-white'
                  }`}
                >
                  {isVideoEnabled ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    toggleAudio();
                    toggleAudioBroadcast();
                  }}
                  className={`p-3 rounded-full ${
                    isAudioEnabled
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-red-500 hover:bg-red-600 text-white'
                  }`}
                >
                  {isAudioEnabled ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  )}
                </button>
              </div>

              <button
                onClick={handleJoinRoom}
                className="w-full py-4 px-6 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold text-lg transition-all transform hover:scale-[1.02]"
              >
                加入会议
              </button>

              <button
                onClick={() => navigate('/')}
                className="w-full py-3 px-6 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-all"
              >
                返回大厅
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <VideoGrid
            participants={participants}
            localUserId={userId}
            localStream={localStream}
            isLocalVideoEnabled={isVideoEnabled}
            isLocalAudioEnabled={isAudioEnabled}
            backgroundEnabled={backgroundEnabled}
            currentBackground={currentBackground}
          />
        </div>

        {sidebarOpen && (
          <div className="w-80 flex-shrink-0">
            <Sidebar
              roomId={roomId || ''}
              userId={userId}
              isHost={true}
              currentBackground={currentBackground}
              backgroundEnabled={backgroundEnabled}
              isVoiceprintVerified={isVoiceprintVerified}
              participantsCount={participants.size + 1}
              onSelectBackground={handleSelectBackground}
              onToggleBackground={handleToggleBackground}
              onVoiceprintVerify={handleVoiceprintVerify}
            />
          </div>
        )}
      </div>

      <ControlBar
        isVideoEnabled={isVideoEnabled}
        isAudioEnabled={isAudioEnabled}
        isRecording={isRecording}
        isRecordingLocked={true}
        isVoiceprintVerified={isVoiceprintVerified}
        sidebarOpen={sidebarOpen}
        onToggleVideo={() => {
          toggleVideo();
          toggleVideoBroadcast();
        }}
        onToggleAudio={() => {
          toggleAudio();
          toggleAudioBroadcast();
        }}
        onToggleRecording={handleToggleRecording}
        onLeaveRoom={handleLeaveRoom}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        recordingTime={formatTime(recordingTime)}
      />
    </div>
  );
};

export default Conference;

import { useState } from 'react';
import { Palette, Lock, Users, Download, ChevronDown, ChevronUp } from 'lucide-react';
import BackgroundSelector from './BackgroundSelector';
import VoiceprintPanel from './VoiceprintPanel';
import { BackgroundOption } from '../types';
import { useRecorder } from '../hooks/useRecorder';

interface SidebarProps {
  roomId: string;
  userId: string;
  isHost: boolean;
  currentBackground: BackgroundOption | null;
  backgroundEnabled: boolean;
  isVoiceprintVerified: boolean;
  participantsCount: number;
  onSelectBackground: (bg: BackgroundOption | null) => void;
  onToggleBackground: (enabled: boolean) => void;
  onVoiceprintVerify: (verified: boolean) => void;
}

export const Sidebar = ({
  roomId,
  userId,
  isHost,
  currentBackground,
  backgroundEnabled,
  isVoiceprintVerified,
  participantsCount,
  onSelectBackground,
  onToggleBackground,
  onVoiceprintVerify
}: SidebarProps) => {
  const [activeTab, setActiveTab] = useState<'background' | 'voiceprint' | 'participants' | 'recordings'>('background');
  const { recordedBlob, downloadRecording, previewRecording } = useRecorder();

  const tabs = [
    { id: 'background' as const, label: '虚拟背景', icon: Palette },
    { id: 'voiceprint' as const, label: '声纹锁', icon: Lock, hostOnly: true },
    { id: 'participants' as const, label: '参会者', icon: Users },
    { id: 'recordings' as const, label: '录制', icon: Download },
  ];

  return (
    <div className="w-full h-full bg-gray-900 border-l border-gray-700 flex flex-col">
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {tabs.map((tab) => {
          if (tab.hostOnly && !isHost) return null;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[80px] py-3 px-2 flex flex-col items-center gap-1 text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/10'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'background' && (
          <BackgroundSelector
            currentBackground={currentBackground}
            backgroundEnabled={backgroundEnabled}
            onSelectBackground={onSelectBackground}
            onToggleBackground={onToggleBackground}
          />
        )}

        {activeTab === 'voiceprint' && (
          <VoiceprintPanel
            roomId={roomId}
            userId={userId}
            isVerified={isVoiceprintVerified}
            onVerify={onVoiceprintVerify}
          />
        )}

        {activeTab === 'participants' && (
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-semibold text-white">参会者</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                    你
                  </div>
                  <div>
                    <p className="text-white font-medium">你 (主持人)</p>
                    <p className="text-xs text-gray-400">ID: {userId.slice(-8)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                </div>
              </div>

              {Array.from({ length: participantsCount - 1 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center text-white font-medium">
                      {String.fromCharCode(65 + i)}
                    </div>
                    <div>
                      <p className="text-white font-medium">用户 {String.fromCharCode(65 + i)}</p>
                      <p className="text-xs text-gray-400">参会者</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 bg-gray-800/50 rounded-lg">
              <p className="text-sm text-gray-400">
                当前共有 <span className="text-white font-medium">{participantsCount}</span> 位参会者
              </p>
            </div>
          </div>
        )}

        {activeTab === 'recordings' && (
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-semibold text-white">会议录制</h3>
            
            {recordedBlob ? (
              <div className="space-y-4">
                <div className="p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-white font-medium">最近录制</span>
                    <span className="text-xs text-gray-400">
                      {new Date().toLocaleString()}
                    </span>
                  </div>
                  <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden mb-3">
                    {previewRecording() && (
                      <video
                        src={previewRecording() || ''}
                        controls
                        className="w-full h-full"
                      />
                    )}
                  </div>
                  <button
                    onClick={() => downloadRecording(`meeting-${Date.now()}.webm`)}
                    className="w-full py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    下载录制文件
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <Download className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">暂无录制文件</p>
                <p className="text-xs text-gray-500 mt-1">开始录制后，文件将显示在这里</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;

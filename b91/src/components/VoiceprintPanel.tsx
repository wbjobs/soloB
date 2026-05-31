import { useState, useEffect } from 'react';
import { Mic, MicOff, Lock, Unlock, Check, AlertCircle } from 'lucide-react';
import { useVoiceprint } from '../hooks/useVoiceprint';

interface VoiceprintPanelProps {
  roomId: string;
  userId: string;
  isVerified: boolean;
  onVerify: (verified: boolean) => void;
}

export const VoiceprintPanel = ({
  roomId,
  userId,
  isVerified,
  onVerify
}: VoiceprintPanelProps) => {
  const {
    isRecording,
    startRecording,
    stopRecording,
    registerVoiceprint,
    verifyVoiceprint
  } = useVoiceprint();

  const [mode, setMode] = useState<'register' | 'verify'>('register');
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [visualizer, setVisualizer] = useState<number[]>(Array(20).fill(0));

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording) {
      interval = setInterval(() => {
        setVisualizer(prev => prev.map(() => Math.random() * 100));
      }, 100);
    } else {
      setVisualizer(Array(20).fill(0));
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const showMessage = (msg: string, type: 'success' | 'error' | 'info') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  const handleRegister = async () => {
    if (isProcessing) return;

    try {
      setIsProcessing(true);
      await startRecording();
      showMessage('正在录制声纹，请朗读一段文字...', 'info');

      setTimeout(async () => {
        const success = await registerVoiceprint(roomId, userId);
        stopRecording();
        setIsProcessing(false);

        if (success) {
          showMessage('声纹注册成功！现在可以验证解锁录制功能。', 'success');
          setMode('verify');
        } else {
          showMessage('声纹注册失败，请重试', 'error');
        }
      }, 3000);
    } catch (error) {
      stopRecording();
      setIsProcessing(false);
      showMessage('无法访问麦克风，请检查权限设置', 'error');
    }
  };

  const handleVerify = async () => {
    if (isProcessing) return;

    try {
      setIsProcessing(true);
      await startRecording();
      showMessage('正在验证声纹，请说话...', 'info');

      setTimeout(async () => {
        const result = await verifyVoiceprint(roomId, userId);
        stopRecording();
        setIsProcessing(false);

        console.log('[Voiceprint] Verification result:', result);
        
        if (result.match) {
          showMessage(`声纹验证成功！相似度: ${Math.round(result.similarity * 100)}%`, 'success');
          setTimeout(() => {
            onVerify(true);
            console.log('[Voiceprint] Called onVerify(true)');
          }, 100);
        } else {
          showMessage(`声纹验证失败，请重试 (相似度: ${Math.round(result.similarity * 100)}%)`, 'error');
          onVerify(false);
        }
      }, 2000);
    } catch (error) {
      stopRecording();
      setIsProcessing(false);
      showMessage('无法访问麦克风，请检查权限设置', 'error');
    }
  };

  const handleCancel = () => {
    stopRecording();
    setIsProcessing(false);
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">声纹锁</h3>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
          isVerified
            ? 'bg-green-500/20 text-green-400'
            : 'bg-yellow-500/20 text-yellow-400'
        }`}>
          {isVerified ? (
            <>
              <Unlock className="w-4 h-4" />
              <span>已解锁</span>
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" />
              <span>已锁定</span>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2 p-1 bg-gray-800 rounded-lg">
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              mode === 'register'
                ? 'bg-blue-500 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            注册声纹
          </button>
          <button
            onClick={() => setMode('verify')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
              mode === 'verify'
                ? 'bg-blue-500 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            验证解锁
          </button>
        </div>

        <div className="flex items-end justify-center gap-1 h-20 py-4">
          {visualizer.map((height, index) => (
            <div
              key={index}
              className="w-2 bg-gradient-to-t from-blue-500 to-purple-500 rounded-full transition-all duration-100"
              style={{ height: `${Math.max(4, height)}%` }}
            />
          ))}
        </div>

        {mode === 'register' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              首次使用需要注册声纹。点击下方按钮，然后清晰地朗读一段文字（约3秒）。
            </p>
            {isProcessing ? (
              <button
                onClick={handleCancel}
                className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                <MicOff className="w-5 h-5" />
                取消录制
              </button>
            ) : (
              <button
                onClick={handleRegister}
                disabled={isVerified}
                className={`w-full py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 ${
                  isVerified
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                <Mic className="w-5 h-5" />
                {isVerified ? '已完成注册' : '开始录制声纹'}
              </button>
            )}
          </div>
        )}

        {mode === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              验证声纹以解锁录制功能。请用注册时的声音说话。
            </p>
            {isProcessing ? (
              <button
                onClick={handleCancel}
                className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                <MicOff className="w-5 h-5" />
                取消验证
              </button>
            ) : (
              <button
                onClick={handleVerify}
                disabled={isVerified}
                className={`w-full py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 ${
                  isVerified
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                <Mic className="w-5 h-5" />
                {isVerified ? '已验证通过' : '验证声纹'}
              </button>
            )}
          </div>
        )}

        {message && (
          <div className={`p-3 rounded-lg flex items-start gap-2 ${
            messageType === 'success' ? 'bg-green-500/20 text-green-400' :
            messageType === 'error' ? 'bg-red-500/20 text-red-400' :
            'bg-blue-500/20 text-blue-400'
          }`}>
            {messageType === 'success' ? <Check className="w-5 h-5 flex-shrink-0" /> :
             messageType === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> :
             <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            <span className="text-sm">{message}</span>
          </div>
        )}

        <div className="p-4 bg-gray-800/50 rounded-lg">
          <h4 className="text-sm font-medium text-gray-300 mb-2">使用提示</h4>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>• 在安静的环境中录制声纹</li>
            <li>• 保持自然的说话音量和语速</li>
            <li>• 注册和验证时使用相同的声音</li>
            <li>• 录制时保持麦克风距离适中</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default VoiceprintPanel;

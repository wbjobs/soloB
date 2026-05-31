import { useState, useRef } from 'react';
import { Image as ImageIcon, Palette, Upload, X, Check, Zap, Gauge, Settings, Eye } from 'lucide-react';
import { BackgroundOption } from '../types';

interface BackgroundSelectorProps {
  currentBackground: BackgroundOption | null;
  backgroundEnabled: boolean;
  mode: 'bodypix' | 'chromakey' | 'disabled';
  chromaKeyConfig: {
    color: string;
    similarity: number;
    smoothness: number;
    spillReduction: number;
  };
  metrics: {
    fps: number;
    avgProcessingTime: number;
    backend: string;
  };
  onSelectBackground: (bg: BackgroundOption | null) => void;
  onToggleBackground: (enabled: boolean) => void;
  onModeChange: (mode: 'bodypix' | 'chromakey' | 'disabled') => void;
  onChromaKeyConfigChange: (config: {
    color: string;
    similarity: number;
    smoothness: number;
    spillReduction: number;
  }) => void;
}

const presetColors: BackgroundOption[] = [
  { id: 'color-1', name: '深海蓝', type: 'color', value: '#0f172a' },
  { id: 'color-2', name: '森林绿', type: 'color', value: '#134e4a' },
  { id: 'color-3', name: '珊瑚红', type: 'color', value: '#7f1d1d' },
  { id: 'color-4', name: '薰衣草紫', type: 'color', value: '#581c87' },
  { id: 'color-5', name: '午夜黑', type: 'color', value: '#0f0f0f' },
  { id: 'color-6', name: '商务灰', type: 'color', value: '#374151' },
  { id: 'color-7', name: '天空蓝', type: 'color', value: '#0ea5e9' },
  { id: 'color-8', name: '青草绿', type: 'color', value: '#22c55e' },
];

const presetBlurs: BackgroundOption[] = [
  { id: 'blur-1', name: '模糊效果', type: 'blur', value: 'blur' },
];

const chromaKeyPresets = [
  { name: '标准绿幕', color: '#00FF00' },
  { name: '蓝幕', color: '#0000FF' },
  { name: '自定义颜色', color: '#00FF00' },
];

export const BackgroundSelector = ({
  currentBackground,
  backgroundEnabled,
  mode,
  chromaKeyConfig,
  metrics,
  onSelectBackground,
  onToggleBackground,
  onModeChange,
  onChromaKeyConfigChange,
}: BackgroundSelectorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customImages, setCustomImages] = useState<BackgroundOption[]>([]);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newBg: BackgroundOption = {
          id: `custom-${Date.now()}`,
          name: file.name,
          type: 'image',
          value: event.target?.result as string,
          thumbnail: event.target?.result as string,
        };
        setCustomImages((prev) => [...prev, newBg]);
        onSelectBackground(newBg);
        onToggleBackground(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeCustomImage = (id: string) => {
    setCustomImages((prev) => prev.filter((img) => img.id !== id));
    if (currentBackground?.id === id) {
      onSelectBackground(null);
    }
  };

  const pickColor = (color: string) => {
    onChromaKeyConfigChange({ ...chromaKeyConfig, color });
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">虚拟背景</h3>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={backgroundEnabled}
            onChange={(e) => onToggleBackground(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
        </label>
      </div>

      {backgroundEnabled && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Zap className="w-4 h-4" />
              <span>抠图模式</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onModeChange('bodypix')}
                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  mode === 'bodypix'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                AI 人像分割
              </button>
              <button
                onClick={() => onModeChange('chromakey')}
                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  mode === 'chromakey'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                虚拟绿幕
              </button>
            </div>
          </div>

          {mode === 'chromakey' && (
            <div className="space-y-4 p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Eye className="w-4 h-4" />
                  <span>绿幕颜色</span>
                </div>
                <div
                  className="w-8 h-8 rounded-full border-2 border-gray-600"
                  style={{ backgroundColor: chromaKeyConfig.color }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {chromaKeyPresets.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => pickColor(preset.color)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      chromaKeyConfig.color === preset.color
                        ? 'border-blue-500 scale-110'
                        : 'border-gray-600 hover:border-gray-500'
                    }`}
                    style={{ backgroundColor: preset.color }}
                    title={preset.name}
                  />
                ))}
                <input
                  type="color"
                  value={chromaKeyConfig.color}
                  onChange={(e) => pickColor(e.target.value)}
                  className="w-8 h-8 rounded-full border-2 border-gray-600 cursor-pointer"
                />
              </div>

              <button
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Settings className="w-4 h-4" />
                <span>高级设置</span>
              </button>

              {showAdvancedSettings && (
                <div className="space-y-4 pt-2">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">颜色相似度</span>
                      <span className="text-white">{Math.round(chromaKeyConfig.similarity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={chromaKeyConfig.similarity}
                      onChange={(e) =>
                        onChromaKeyConfigChange({
                          ...chromaKeyConfig,
                          similarity: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">边缘平滑</span>
                      <span className="text-white">{Math.round(chromaKeyConfig.smoothness * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="0.3"
                      step="0.05"
                      value={chromaKeyConfig.smoothness}
                      onChange={(e) =>
                        onChromaKeyConfigChange({
                          ...chromaKeyConfig,
                          smoothness: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">溢色减少</span>
                      <span className="text-white">{Math.round(chromaKeyConfig.spillReduction * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.05"
                      value={chromaKeyConfig.spillReduction}
                      onChange={(e) =>
                        onChromaKeyConfigChange({
                          ...chromaKeyConfig,
                          spillReduction: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">纯色背景</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {presetColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => onSelectBackground(color)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    currentBackground?.id === color.id
                      ? 'border-blue-500 scale-105'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                >
                  {currentBackground?.id === color.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <ImageIcon className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">模糊效果</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {presetBlurs.map((blur) => (
                <button
                  key={blur.id}
                  onClick={() => onSelectBackground(blur)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all bg-gradient-to-br from-gray-700 to-gray-800 ${
                    currentBackground?.id === blur.id
                      ? 'border-blue-500 scale-105'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                  title={blur.name}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-gray-600 blur-sm" />
                  </div>
                  {currentBackground?.id === blur.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {customImages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-300">自定义图片</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {customImages.map((image) => (
                  <div key={image.id} className="relative group">
                    <button
                      onClick={() => onSelectBackground(image)}
                      className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                        currentBackground?.id === image.id
                          ? 'border-blue-500 scale-105'
                          : 'border-gray-600 hover:border-gray-500'
                      }`}
                    >
                      <img
                        src={image.thumbnail}
                        alt={image.name}
                        className="w-full h-full object-cover"
                      />
                      {currentBackground?.id === image.id && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Check className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => removeCustomImage(image.id)}
                      className="absolute -top-1 -right-1 p-1 bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-600 rounded-lg hover:border-gray-500 hover:bg-gray-800/50 transition-all text-gray-400 hover:text-gray-300"
            >
              <Upload className="w-5 h-5" />
              <span>上传自定义背景</span>
            </button>
          </div>

          <div className="p-4 bg-gray-800/50 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">性能监控</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{metrics.fps}</div>
                <div className="text-xs text-gray-500">FPS</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{metrics.avgProcessingTime.toFixed(0)}</div>
                <div className="text-xs text-gray-500">ms/帧</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${
                  metrics.backend === 'webgl' ? 'text-green-400' :
                  metrics.backend === 'wasm' ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {metrics.backend.toUpperCase()}
                </div>
                <div className="text-xs text-gray-500">加速引擎</div>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectBackground(null)}
            className="w-full py-2.5 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-all flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            移除背景效果
          </button>
        </>
      )}
    </div>
  );
};

export default BackgroundSelector;

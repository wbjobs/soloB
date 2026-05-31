import React from 'react';
import {
  SelectOutlined,
  HighlightOutlined,
  EditOutlined,
  FontColorsOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import useStore from '../store';

const tools = [
  { id: 'select', name: '选择', icon: SelectOutlined },
  { id: 'highlight', name: '高亮', icon: HighlightOutlined },
  { id: 'pen', name: '画笔', icon: EditOutlined },
  { id: 'text', name: '文本', icon: FontColorsOutlined },
  { id: 'metronome', name: '节拍标记', icon: ClockCircleOutlined }
];

const colors = [
  '#ff0000', '#ff6600', '#ffcc00', '#00cc00',
  '#0066ff', '#6600ff', '#ff00ff', '#000000'
];

function Toolbar() {
  const { tool, setTool, color, setColor } = useStore();

  return (
    <div className="w-16 bg-white border-r p-2 flex flex-col gap-2">
      <div className="text-xs text-gray-500 text-center mb-2">工具</div>

      {tools.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            className={`tool-btn w-12 h-12 rounded-lg flex items-center justify-center text-lg transition-all ${
              tool === t.id
                ? 'bg-primary text-white shadow-md'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            onClick={() => setTool(t.id)}
            title={t.name}
          >
            <Icon />
          </button>
        );
      })}

      <div className="border-t my-2" />
      <div className="text-xs text-gray-500 text-center mb-2">颜色</div>

      <div className="grid grid-cols-2 gap-1">
        {colors.map((c) => (
          <button
            key={c}
            className={`w-5 h-5 rounded-full border-2 transition-all ${
              color === c ? 'border-primary scale-110' : 'border-gray-300'
            }`}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
    </div>
  );
}

export default Toolbar;

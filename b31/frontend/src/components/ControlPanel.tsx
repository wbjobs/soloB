import React from 'react'
import { WaveParameters } from '../types'

interface ControlPanelProps {
  parameters: WaveParameters
  onParametersChange: (params: WaveParameters) => void
  isConnected: boolean
  currentTime: number
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  parameters,
  onParametersChange,
  isConnected,
  currentTime
}) => {
  const handleWindSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onParametersChange({
      ...parameters,
      wind_speed: parseFloat(e.target.value)
    })
  }

  const handleFetchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onParametersChange({
      ...parameters,
      fetch: parseFloat(e.target.value)
    })
  }

  const handlePeakFrequencyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    onParametersChange({
      ...parameters,
      peak_frequency: value < 0.01 ? null : value
    })
  }

  const handleDirectionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onParametersChange({
      ...parameters,
      main_direction: parseFloat(e.target.value)
    })
  }

  const handleReset = () => {
    onParametersChange({
      wind_speed: 10.0,
      fetch: 10000.0,
      peak_frequency: null,
      main_direction: 0.0
    })
  }

  const directionLabels = ['东', '东南', '南', '西南', '西', '西北', '北', '东北']
  const getDirectionLabel = (deg: number) => {
    const index = Math.round((deg % 360) / 45) % 8
    return directionLabels[index]
  }

  return (
    <div style={controlPanelStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>海洋波浪模拟</h2>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px'
        }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: isConnected ? '#4ade80' : '#ef4444'
          }} />
          <span style={{ color: isConnected ? '#4ade80' : '#ef4444' }}>
            {isConnected ? '已连接' : '未连接'}
          </span>
        </div>
      </div>

      <div style={timeDisplayStyle}>
        <span style={{ color: '#94a3b8' }}>模拟时间:</span>
        <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>
          {currentTime.toFixed(1)}s
        </span>
      </div>

      <div style={dividerStyle} />

      <div style={controlGroupStyle}>
        <div style={labelStyle}>
          <span style={labelTextStyle}>风速</span>
          <span style={valueStyle}>{parameters.wind_speed.toFixed(1)} m/s</span>
        </div>
        <input
          type="range"
          min="1"
          max="50"
          step="0.5"
          value={parameters.wind_speed}
          onChange={handleWindSpeedChange}
          style={sliderStyle}
        />
        <div style={rangeLabelsStyle}>
          <span>1</span>
          <span>50</span>
        </div>
      </div>

      <div style={controlGroupStyle}>
        <div style={labelStyle}>
          <span style={labelTextStyle}>风区长度</span>
          <span style={valueStyle}>{(parameters.fetch / 1000).toFixed(0)} km</span>
        </div>
        <input
          type="range"
          min="1000"
          max="100000"
          step="500"
          value={parameters.fetch}
          onChange={handleFetchChange}
          style={sliderStyle}
        />
        <div style={rangeLabelsStyle}>
          <span>1 km</span>
          <span>100 km</span>
        </div>
      </div>

      <div style={controlGroupStyle}>
        <div style={labelStyle}>
          <span style={labelTextStyle}>峰值频率</span>
          <span style={valueStyle}>
            {parameters.peak_frequency === null
              ? '自动'
              : parameters.peak_frequency.toFixed(2) + ' Hz'}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={parameters.peak_frequency === null ? 0 : parameters.peak_frequency * 100}
          onChange={handlePeakFrequencyChange}
          style={sliderStyle}
        />
        <div style={rangeLabelsStyle}>
          <span>自动</span>
          <span>1.0 Hz</span>
        </div>
      </div>

      <div style={controlGroupStyle}>
        <div style={labelStyle}>
          <span style={labelTextStyle}>浪向</span>
          <span style={valueStyle}>
            {parameters.main_direction.toFixed(0)}° ({getDirectionLabel(parameters.main_direction)})
          </span>
        </div>
        <div style={compassContainerStyle}>
          <svg width="100" height="100" viewBox="0 0 100 100" style={compassStyle}>
            <circle cx="50" cy="50" r="45" fill="#1e293b" stroke="#475569" strokeWidth="1" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#334155" strokeWidth="1" />
            <text x="50" y="14" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="bold">北</text>
            <text x="50" y="94" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="bold">南</text>
            <text x="6" y="54" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="bold">西</text>
            <text x="94" y="54" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="bold">东</text>
            {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => {
              const rad = (angle - 90) * Math.PI / 180
              const x1 = 50 + 35 * Math.cos(rad)
              const y1 = 50 + 35 * Math.sin(rad)
              const x2 = 50 + 40 * Math.cos(rad)
              const y2 = 50 + 40 * Math.sin(rad)
              return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth="1" />
            })}
            <g transform={`rotate(${parameters.main_direction}, 50, 50)`}>
              <polygon
                points="50,12 55,32 50,28 45,32"
                fill="#ef4444"
                stroke="#dc2626"
                strokeWidth="1"
              />
              <polygon
                points="50,88 55,68 50,72 45,68"
                fill="#3b82f6"
                stroke="#2563eb"
                strokeWidth="1"
              />
            </g>
            <circle cx="50" cy="50" r="4" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1" />
          </svg>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          step="1"
          value={parameters.main_direction}
          onChange={handleDirectionChange}
          style={sliderStyle}
        />
        <div style={rangeLabelsStyle}>
          <span>0° (东)</span>
          <span>180° (西)</span>
          <span>360°</span>
        </div>
      </div>

      <div style={dividerStyle} />

      <button onClick={handleReset} style={buttonStyle}>
        重置参数
      </button>

      <div style={infoStyle}>
        <p style={infoTextStyle}>拖动鼠标旋转视角</p>
        <p style={infoTextStyle}>滚轮缩放</p>
      </div>

      <div style={dividerStyle} />

      <div style={aboutStyle}>
        <h3 style={{ color: '#e2e8f0', fontSize: '14px', marginBottom: '8px' }}>关于JONSWAP谱</h3>
        <p style={infoTextStyle}>
          JONSWAP谱是用于描述充分发展的海浪能量分布的标准模型。
          它基于风速和风区长度计算波浪高度场。
        </p>
      </div>
    </div>
  )
}

const controlPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '20px',
  right: '20px',
  width: '320px',
  backgroundColor: 'rgba(15, 23, 42, 0.95)',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(59, 130, 246, 0.2)',
  maxHeight: '90vh',
  overflowY: 'auto'
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px'
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#e2e8f0'
}

const timeDisplayStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  backgroundColor: 'rgba(30, 41, 59, 0.8)',
  borderRadius: '8px',
  marginBottom: '16px'
}

const dividerStyle: React.CSSProperties = {
  height: '1px',
  backgroundColor: 'rgba(71, 85, 105, 0.5)',
  margin: '16px 0'
}

const controlGroupStyle: React.CSSProperties = {
  marginBottom: '20px'
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px'
}

const labelTextStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontSize: '14px',
  fontWeight: '500'
}

const valueStyle: React.CSSProperties = {
  color: '#60a5fa',
  fontSize: '14px',
  fontWeight: 'bold'
}

const sliderStyle: React.CSSProperties = {
  width: '100%',
  height: '6px',
  borderRadius: '3px',
  backgroundColor: '#334155',
  outline: 'none',
  WebkitAppearance: 'none',
  cursor: 'pointer'
}

const rangeLabelsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '12px',
  color: '#64748b',
  marginTop: '4px'
}

const compassContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  margin: '12px 0'
}

const compassStyle: React.CSSProperties = {
  filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))'
}

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  backgroundColor: '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'background-color 0.2s'
}

const infoStyle: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  backgroundColor: 'rgba(30, 41, 59, 0.6)',
  borderRadius: '8px'
}

const infoTextStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '12px',
  margin: '4px 0',
  lineHeight: '1.5'
}

const aboutStyle: React.CSSProperties = {
  marginTop: '8px'
}

export default ControlPanel

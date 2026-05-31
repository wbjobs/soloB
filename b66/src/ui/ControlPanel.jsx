import { GESTURES } from '../ml/gesture-classifier'

function ControlPanel({ currentGesture, lightOn, carPosition, isRunning, customGestureInfo }) {
  const gestureNames = {
    [GESTURES.FIST]: '握拳',
    [GESTURES.VICTORY]: '比耶',
    [GESTURES.WAVE]: '挥手',
    [GESTURES.OPEN]: '张开',
    [GESTURES.POINT]: '指向',
    [GESTURES.UNKNOWN]: '未知'
  }

  const gestureIcons = {
    [GESTURES.FIST]: '✊',
    [GESTURES.VICTORY]: '✌️',
    [GESTURES.WAVE]: '👋',
    [GESTURES.OPEN]: '🖐️',
    [GESTURES.POINT]: '👆',
    [GESTURES.UNKNOWN]: '❓'
  }

  const displayIcon = customGestureInfo?.isCustom ? customGestureInfo.gestureIcon : gestureIcons[currentGesture]
  const displayName = customGestureInfo?.isCustom ? customGestureInfo.gestureName : gestureNames[currentGesture]
  const isCustom = customGestureInfo?.isCustom

  return (
    <div className="control-panel">
      <div className="panel-section">
        <h3>系统状态</h3>
        <div className={`status-badge ${isRunning ? 'running' : 'stopped'}`}>
          {isRunning ? '● 运行中' : '○ 已停止'}
        </div>
      </div>

      <div className="panel-section">
        <h3>当前手势</h3>
        <div className="gesture-display">
          <span className="gesture-icon">{displayIcon}</span>
          <span className="gesture-name">
            {displayName}
            {isCustom && <span className="custom-badge">自定义</span>}
          </span>
        </div>
      </div>

      <div className="panel-section">
        <h3>灯光控制</h3>
        <div className="light-control">
          <div className={`light-indicator ${lightOn ? 'on' : 'off'}`}>
            💡
          </div>
          <span className="light-status">{lightOn ? '已开启' : '已关闭'}</span>
        </div>
        <p className="hint">💡 比耶 = 开灯 | 握拳 = 关灯</p>
      </div>

      <div className="panel-section">
        <h3>小车位置</h3>
        <div className="car-position">
          <div className="position-info">
            <span>X: {carPosition.x.toFixed(2)}</span>
            <span>Y: {carPosition.y.toFixed(2)}</span>
          </div>
        </div>
        <p className="hint">🚗 指向 = 移动 | 挥手 = 重置位置</p>
      </div>

      <div className="panel-section legend">
        <h3>手势说明</h3>
        <ul>
          <li><span className="legend-icon">✌️</span> 比耶 - 开灯</li>
          <li><span className="legend-icon">✊</span> 握拳 - 关灯</li>
          <li><span className="legend-icon">👆</span> 指向 - 移动小车</li>
          <li><span className="legend-icon">👋</span> 挥手 - 重置小车</li>
          <li><span className="legend-icon">🖐️</span> 张开 - 停止动作</li>
        </ul>
      </div>
    </div>
  )
}

export { ControlPanel }

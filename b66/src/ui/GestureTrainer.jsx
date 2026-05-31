import { useState, useEffect, useCallback, useRef } from 'react'

const EMOJI_OPTIONS = ['✋', '👌', '🤘', '🤙', '🤟', '✌️', '✊', '👊', '🤛', '🤜', '🫶', '🤝', '👏', '🙌', '👐']

function GestureTrainer({ gestureStore, onClose, onUpdate, currentResults }) {
  const [step, setStep] = useState('list')
  const [gestureName, setGestureName] = useState('')
  const [selectedEmoji, setSelectedEmoji] = useState('✋')
  const [selectedAction, setSelectedAction] = useState('')
  const [sampleCount, setSampleCount] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingProgress, setRecordingProgress] = useState(0)
  const [samples, setSamples] = useState([])
  const [customGestures, setCustomGestures] = useState([])
  const [editingGesture, setEditingGesture] = useState(null)
  const [availableActions, setAvailableActions] = useState([])
  const recordingTimerRef = useRef(null)

  useEffect(() => {
    setCustomGestures(gestureStore.getAllGestures())
    setAvailableActions(gestureStore.getAvailableActions())
  }, [gestureStore])

  const refreshGestures = useCallback(() => {
    setCustomGestures(gestureStore.getAllGestures())
    if (onUpdate) onUpdate()
  }, [gestureStore, onUpdate])

  const startRecording = useCallback(() => {
    if (!currentResults || !currentResults.multiHandLandmarks) {
      alert('请先启动摄像头并确保手部在画面中可见')
      return
    }

    setIsRecording(true)
    setRecordingProgress(0)
    const targetSamples = 30
    let collected = 0

    recordingTimerRef.current = setInterval(() => {
      if (currentResults && currentResults.multiHandLandmarks) {
        const landmarks = currentResults.multiHandLandmarks[0]
        const handedness = currentResults.multiHandedness[0].label
        const features = gestureStore.extractFeatures(landmarks, handedness)

        if (features) {
          setSamples(prev => [...prev, {
            features,
            landmarks: landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z })),
            timestamp: Date.now()
          }])
          collected++
          setSampleCount(collected)
          setRecordingProgress((collected / targetSamples) * 100)

          if (collected >= targetSamples) {
            stopRecording()
            setStep('review')
          }
        }
      }
    }, 100)
  }, [currentResults, gestureStore])

  const stopRecording = useCallback(() => {
    setIsRecording(false)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const saveGesture = useCallback(() => {
    if (samples.length < 10) {
      alert('样本数量不足，请至少录制 10 帧样本')
      return
    }

    if (!gestureName.trim()) {
      alert('请输入手势名称')
      return
    }

    const gestureData = {
      name: gestureName.trim(),
      icon: selectedEmoji,
      samples,
      action: selectedAction || null
    }

    if (editingGesture) {
      gestureStore.updateGesture(editingGesture.id, gestureData)
    } else {
      gestureStore.addGesture(gestureData)
    }

    refreshGestures()
    resetForm()
    setStep('list')
  }, [samples, gestureName, selectedEmoji, selectedAction, editingGesture, gestureStore, refreshGestures])

  const deleteGesture = useCallback((id) => {
    if (confirm('确定要删除这个手势吗？')) {
      gestureStore.deleteGesture(id)
      refreshGestures()
    }
  }, [gestureStore, refreshGestures])

  const editGesture = useCallback((gesture) => {
    setEditingGesture(gesture)
    setGestureName(gesture.name)
    setSelectedEmoji(gesture.icon)
    setSelectedAction(gestureStore.getGestureAction(gesture.id) || '')
    setSamples(gesture.samples || [])
    setSampleCount(gesture.samples?.length || 0)
    setStep('review')
  }, [gestureStore])

  const exportGestures = useCallback(() => {
    const data = gestureStore.exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gestures_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [gestureStore])

  const importGestures = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target.result)
            if (gestureStore.importData(data)) {
              refreshGestures()
              alert('导入成功！')
            } else {
              alert('导入失败：文件格式错误')
            }
          } catch (err) {
            alert('导入失败：' + err.message)
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }, [gestureStore, refreshGestures])

  const resetForm = useCallback(() => {
    setGestureName('')
    setSelectedEmoji('✋')
    setSelectedAction('')
    setSampleCount(0)
    setRecordingProgress(0)
    setSamples([])
    setEditingGesture(null)
    stopRecording()
  }, [stopRecording])

  const getActionInfo = useCallback((actionId) => {
    return availableActions.find(a => a.id === actionId)
  }, [availableActions])

  return (
    <div className="gesture-trainer-overlay" onClick={onClose}>
      <div className="gesture-trainer" onClick={e => e.stopPropagation()}>
        <div className="trainer-header">
          <h2>🎯 自定义手势训练</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {step === 'list' && (
          <div className="trainer-content">
            <div className="trainer-actions">
              <button
                className="btn btn-primary"
                onClick={() => { resetForm(); setStep('name'); }}
              >
                ➕ 新手势
              </button>
              <button className="btn btn-secondary" onClick={exportGestures}>
                📤 导出
              </button>
              <button className="btn btn-secondary" onClick={importGestures}>
                📥 导入
              </button>
            </div>

            {customGestures.length === 0 ? (
              <div className="empty-state">
                <p>还没有自定义手势</p>
                <p className="hint">点击上方按钮创建第一个手势</p>
              </div>
            ) : (
              <div className="gesture-list">
                {customGestures.map(gesture => {
                  const action = getActionInfo(gestureStore.getGestureAction(gesture.id))
                  return (
                    <div key={gesture.id} className="gesture-item">
                      <div className="gesture-item-main">
                        <span className="gesture-icon-large">{gesture.icon}</span>
                        <div className="gesture-info">
                          <h4>{gesture.name}</h4>
                          <p className="meta">
                            样本数: {gesture.samples?.length || 0}
                            {action && <span className="action-tag">{action.icon} {action.name}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="gesture-item-actions">
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => editGesture(gesture)}
                        >
                          ✏️ 编辑
                        </button>
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => deleteGesture(gesture.id)}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {step === 'name' && (
          <div className="trainer-content">
            <div className="form-group">
              <label>手势名称</label>
              <input
                type="text"
                value={gestureName}
                onChange={e => setGestureName(e.target.value)}
                placeholder="例如：五指张开"
              />
            </div>

            <div className="form-group">
              <label>选择图标</label>
              <div className="emoji-grid">
                {EMOJI_OPTIONS.map(emoji => (
                  <button
                    key={emoji}
                    className={`emoji-btn ${selectedEmoji === emoji ? 'selected' : ''}`}
                    onClick={() => setSelectedEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>绑定动作</label>
              <select
                value={selectedAction}
                onChange={e => setSelectedAction(e.target.value)}
              >
                <option value="">不绑定动作（仅识别）</option>
                {availableActions.map(action => (
                  <option key={action.id} value={action.id}>
                    {action.icon} {action.name} - {action.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-navigation">
              <button className="btn btn-secondary" onClick={() => setStep('list')}>
                返回
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep('record')}
                disabled={!gestureName.trim()}
              >
                下一步 →
              </button>
            </div>
          </div>
        )}

        {step === 'record' && (
          <div className="trainer-content">
            <div className="record-instructions">
              <h3>📹 录制样本</h3>
              <p>将您的手势保持在摄像头前，点击开始录制</p>
              <p className="hint">建议在录制过程中轻微变换角度，以提高识别准确率</p>
            </div>

            <div className="sample-progress">
              <div className="progress-bar-large">
                <div
                  className="progress-fill-recording"
                  style={{ width: `${recordingProgress}%` }}
                />
              </div>
              <p>已采集: {sampleCount} / 30 帧</p>
            </div>

            {!currentResults?.multiHandLandmarks && (
              <div className="warning-box">
                ⚠️ 未检测到手部，请确保手部在画面中
              </div>
            )}

            <div className="form-navigation">
              <button
                className="btn btn-secondary"
                onClick={() => setStep('name')}
                disabled={isRecording}
              >
                返回
              </button>
              {!isRecording ? (
                <button
                  className="btn btn-primary"
                  onClick={startRecording}
                  disabled={!currentResults?.multiHandLandmarks}
                >
                  🎥 开始录制
                </button>
              ) : (
                <button className="btn btn-danger" onClick={stopRecording}>
                  ⏹ 停止
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="trainer-content">
            <div className="review-info">
              <span className="gesture-icon-review">{selectedEmoji}</span>
              <h3>{gestureName}</h3>
              <p className="meta">样本数: {samples.length}</p>
            </div>

            <div className="form-group">
              <label>修改绑定动作</label>
              <select
                value={selectedAction}
                onChange={e => setSelectedAction(e.target.value)}
              >
                <option value="">不绑定动作（仅识别）</option>
                {availableActions.map(action => (
                  <option key={action.id} value={action.id}>
                    {action.icon} {action.name} - {action.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="review-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSamples([])
                  setSampleCount(0)
                  setRecordingProgress(0)
                  setStep('record')
                }}
              >
                🔄 重新录制
              </button>
              <button
                className="btn btn-success"
                onClick={saveGesture}
                disabled={samples.length < 10}
              >
                💾 保存手势
              </button>
            </div>

            <div className="form-navigation">
              <button className="btn btn-secondary" onClick={() => setStep('record')}>
                ← 返回
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export { GestureTrainer }

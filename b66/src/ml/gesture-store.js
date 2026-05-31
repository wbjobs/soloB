const STORAGE_KEY = 'gesture-control-custom-gestures'

const DEFAULT_ACTIONS = {
  LIGHT_ON: 'light_on',
  LIGHT_OFF: 'light_off',
  CAR_RESET: 'car_reset',
  CAR_MOVE: 'car_move',
  STOP: 'stop'
}

const ACTION_INFO = {
  [DEFAULT_ACTIONS.LIGHT_ON]: { name: '开灯', icon: '💡', description: '打开灯光' },
  [DEFAULT_ACTIONS.LIGHT_OFF]: { name: '关灯', icon: '🌑', description: '关闭灯光' },
  [DEFAULT_ACTIONS.CAR_RESET]: { name: '重置小车', icon: '🔄', description: '将小车重置到中心位置' },
  [DEFAULT_ACTIONS.CAR_MOVE]: { name: '移动小车', icon: '🚗', description: '跟随手的位置移动小车' },
  [DEFAULT_ACTIONS.STOP]: { name: '停止', icon: '⛔', description: '停止当前动作' }
}

const BUILTIN_GESTURE_ACTIONS = {
  victory: DEFAULT_ACTIONS.LIGHT_ON,
  fist: DEFAULT_ACTIONS.LIGHT_OFF,
  wave: DEFAULT_ACTIONS.CAR_RESET,
  point: DEFAULT_ACTIONS.CAR_MOVE,
  open: DEFAULT_ACTIONS.STOP
}

class GestureStore {
  constructor() {
    this.customGestures = this.loadFromStorage()
    this.gestureActionMappings = this.loadMappingsFromStorage()
  }

  loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY + '-gestures')
      return data ? JSON.parse(data) : []
    } catch (e) {
      console.error('加载手势数据失败:', e)
      return []
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY + '-gestures', JSON.stringify(this.customGestures))
    } catch (e) {
      console.error('保存手势数据失败:', e)
    }
  }

  loadMappingsFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY + '-mappings')
      return data ? JSON.parse(data) : {}
    } catch (e) {
      console.error('加载映射数据失败:', e)
      return {}
    }
  }

  saveMappingsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY + '-mappings', JSON.stringify(this.gestureActionMappings))
    } catch (e) {
      console.error('保存映射数据失败:', e)
    }
  }

  addGesture(gestureData) {
    const id = 'custom_' + Date.now()
    const gesture = {
      id,
      name: gestureData.name || `自定义手势 ${this.customGestures.length + 1}`,
      icon: gestureData.icon || '✋',
      samples: gestureData.samples || [],
      featureTemplate: this.createFeatureTemplate(gestureData.samples),
      createdAt: Date.now(),
      isCustom: true
    }
    this.customGestures.push(gesture)
    this.saveToStorage()

    if (gestureData.action) {
      this.setGestureAction(id, gestureData.action)
    }

    return gesture
  }

  createFeatureTemplate(samples) {
    if (!samples || samples.length === 0) return null

    const template = {
      means: [],
      stds: []
    }

    const numLandmarks = 21
    const numCoords = 3

    for (let i = 0; i < numLandmarks * numCoords; i++) {
      const values = samples.map(s => s.features[i])
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
      const std = Math.sqrt(variance)
      template.means.push(mean)
      template.stds.push(std)
    }

    template.sampleCount = samples.length
    return template
  }

  updateGesture(id, updates) {
    const index = this.customGestures.findIndex(g => g.id === id)
    if (index === -1) return null

    this.customGestures[index] = {
      ...this.customGestures[index],
      ...updates,
      updatedAt: Date.now()
    }

    if (updates.samples) {
      this.customGestures[index].featureTemplate = this.createFeatureTemplate(updates.samples)
    }

    this.saveToStorage()
    return this.customGestures[index]
  }

  deleteGesture(id) {
    const index = this.customGestures.findIndex(g => g.id === id)
    if (index === -1) return false

    this.customGestures.splice(index, 1)
    delete this.gestureActionMappings[id]
    this.saveToStorage()
    this.saveMappingsToStorage()
    return true
  }

  getGesture(id) {
    return this.customGestures.find(g => g.id === id)
  }

  getAllGestures() {
    return [...this.customGestures]
  }

  setGestureAction(gestureId, action) {
    this.gestureActionMappings[gestureId] = action
    this.saveMappingsToStorage()
  }

  getGestureAction(gestureId) {
    if (BUILTIN_GESTURE_ACTIONS[gestureId]) {
      return BUILTIN_GESTURE_ACTIONS[gestureId]
    }
    return this.gestureActionMappings[gestureId]
  }

  getAvailableActions() {
    return Object.values(DEFAULT_ACTIONS).map(action => ({
      id: action,
      ...ACTION_INFO[action]
    }))
  }

  clearAll() {
    this.customGestures = []
    this.gestureActionMappings = {}
    localStorage.removeItem(STORAGE_KEY + '-gestures')
    localStorage.removeItem(STORAGE_KEY + '-mappings')
  }

  exportData() {
    return {
      gestures: this.customGestures,
      mappings: this.gestureActionMappings,
      version: 1,
      exportedAt: Date.now()
    }
  }

  importData(data) {
    if (!data.gestures || !data.mappings) return false

    this.customGestures = data.gestures
    this.gestureActionMappings = data.mappings
    this.saveToStorage()
    this.saveMappingsToStorage()
    return true
  }

  extractFeatures(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return null

    const features = []
    const wrist = landmarks[0]

    for (const lm of landmarks) {
      features.push(lm.x - wrist.x)
      features.push(lm.y - wrist.y)
      features.push(lm.z - wrist.z)
    }

    const palmCenter = {
      x: (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3,
      y: (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3
    }

    const angles = this.calculateFingerAngles(landmarks)
    features.push(...angles)

    features.push(handedness === 'Right' ? 1 : 0)

    return features
  }

  calculateFingerAngles(landmarks) {
    const angles = []
    const fingerIndices = [
      [0, 1, 2, 3, 4],
      [0, 5, 6, 7, 8],
      [0, 9, 10, 11, 12],
      [0, 13, 14, 15, 16],
      [0, 17, 18, 19, 20]
    ]

    for (const finger of fingerIndices) {
      const angle1 = this.calculateAngle(
        landmarks[finger[0]],
        landmarks[finger[1]],
        landmarks[finger[2]]
      )
      const angle2 = this.calculateAngle(
        landmarks[finger[1]],
        landmarks[finger[2]],
        landmarks[finger[3]]
      )
      const angle3 = this.calculateAngle(
        landmarks[finger[2]],
        landmarks[finger[3]],
        landmarks[finger[4]]
      )
      angles.push(angle1, angle2, angle3)
    }

    return angles
  }

  calculateAngle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z }
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z }

    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z)
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z)

    if (mag1 === 0 || mag2 === 0) return 0

    const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)))
    return Math.acos(cosAngle)
  }
}

export { GestureStore, DEFAULT_ACTIONS, ACTION_INFO, BUILTIN_GESTURE_ACTIONS }

const GESTURES = {
  FIST: 'fist',
  VICTORY: 'victory',
  WAVE: 'wave',
  OPEN: 'open',
  POINT: 'point',
  UNKNOWN: 'unknown'
}

class GestureClassifier {
  constructor(gestureStore) {
    this.lastHandPosition = null
    this.wavePositions = []
    this.waveThreshold = 5
    this.gestureStore = gestureStore
    this.customGestureThreshold = 0.15
  }

  setGestureStore(gestureStore) {
    this.gestureStore = gestureStore
  }

  isFingerExtended(landmarks, fingerIndices) {
    const tip = landmarks[fingerIndices.tip]
    const pip = landmarks[fingerIndices.pip]
    const mcp = landmarks[fingerIndices.mcp]

    if (fingerIndices.thumb) {
      return Math.abs(tip.x - mcp.x) > 0.08
    }

    return tip.y < pip.y
  }

  isThumbExtended(landmarks, handedness) {
    const tip = landmarks[4]
    const mcp = landmarks[2]
    const wrist = landmarks[0]

    if (handedness === 'Right') {
      return tip.x < mcp.x
    } else {
      return tip.x > mcp.x
    }
  }

  classifyFist(landmarks, handedness) {
    const fingerIndices = {
      index: { tip: 8, pip: 6, mcp: 5 },
      middle: { tip: 12, pip: 10, mcp: 9 },
      ring: { tip: 16, pip: 14, mcp: 13 },
      pinky: { tip: 20, pip: 18, mcp: 17 }
    }

    const fingers = ['index', 'middle', 'ring', 'pinky']
    const extendedCount = fingers.filter(f => 
      this.isFingerExtended(landmarks, fingerIndices[f])
    ).length

    return extendedCount === 0
  }

  classifyVictory(landmarks, handedness) {
    const fingerIndices = {
      index: { tip: 8, pip: 6, mcp: 5 },
      middle: { tip: 12, pip: 10, mcp: 9 },
      ring: { tip: 16, pip: 14, mcp: 13 },
      pinky: { tip: 20, pip: 18, mcp: 17 }
    }

    const indexExtended = this.isFingerExtended(landmarks, fingerIndices.index)
    const middleExtended = this.isFingerExtended(landmarks, fingerIndices.middle)
    const ringExtended = this.isFingerExtended(landmarks, fingerIndices.ring)
    const pinkyExtended = this.isFingerExtended(landmarks, fingerIndices.pinky)

    return indexExtended && middleExtended && !ringExtended && !pinkyExtended
  }

  classifyOpen(landmarks, handedness) {
    const fingerIndices = {
      index: { tip: 8, pip: 6, mcp: 5 },
      middle: { tip: 12, pip: 10, mcp: 9 },
      ring: { tip: 16, pip: 14, mcp: 13 },
      pinky: { tip: 20, pip: 18, mcp: 17 }
    }

    const fingers = ['index', 'middle', 'ring', 'pinky']
    const extendedCount = fingers.filter(f => 
      this.isFingerExtended(landmarks, fingerIndices[f])
    ).length

    return extendedCount >= 3
  }

  classifyPoint(landmarks, handedness) {
    const fingerIndices = {
      index: { tip: 8, pip: 6, mcp: 5 },
      middle: { tip: 12, pip: 10, mcp: 9 },
      ring: { tip: 16, pip: 14, mcp: 13 },
      pinky: { tip: 20, pip: 18, mcp: 17 }
    }

    const indexExtended = this.isFingerExtended(landmarks, fingerIndices.index)
    const middleExtended = this.isFingerExtended(landmarks, fingerIndices.middle)
    const ringExtended = this.isFingerExtended(landmarks, fingerIndices.ring)
    const pinkyExtended = this.isFingerExtended(landmarks, fingerIndices.pinky)

    return indexExtended && !middleExtended && !ringExtended && !pinkyExtended
  }

  classifyWave(landmarks) {
    const wrist = landmarks[0]
    
    if (this.lastHandPosition) {
      const dx = wrist.x - this.lastHandPosition.x
      
      if (Math.abs(dx) > 0.02) {
        this.wavePositions.push({ x: wrist.x, time: Date.now() })
        
        if (this.wavePositions.length > 10) {
          this.wavePositions.shift()
        }

        if (this.wavePositions.length >= 4) {
          let directionChanges = 0
          for (let i = 2; i < this.wavePositions.length; i++) {
            const prevDx = this.wavePositions[i - 1].x - this.wavePositions[i - 2].x
            const currDx = this.wavePositions[i].x - this.wavePositions[i - 1].x
            
            if ((prevDx > 0 && currDx < 0) || (prevDx < 0 && currDx > 0)) {
              directionChanges++
            }
          }
          
          if (directionChanges >= 2) {
            return true
          }
        }
      }
    }
    
    this.lastHandPosition = { x: wrist.x, y: wrist.y }
    return false
  }

  classify(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      return { gesture: GESTURES.UNKNOWN, confidence: 0 }
    }

    const landmarks = results.multiHandLandmarks[0]
    const handedness = results.multiHandedness[0].label

    if (this.classifyWave(landmarks)) {
      return { gesture: GESTURES.WAVE, confidence: 0.8 }
    }

    if (this.classifyVictory(landmarks, handedness)) {
      return { gesture: GESTURES.VICTORY, confidence: 0.9 }
    }

    if (this.classifyFist(landmarks, handedness)) {
      return { gesture: GESTURES.FIST, confidence: 0.9 }
    }

    if (this.classifyPoint(landmarks, handedness)) {
      return { gesture: GESTURES.POINT, confidence: 0.85 }
    }

    if (this.classifyOpen(landmarks, handedness)) {
      return { gesture: GESTURES.OPEN, confidence: 0.8 }
    }

    return { gesture: GESTURES.UNKNOWN, confidence: 0 }
  }

  getHandPosition(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      return null
    }

    const landmarks = results.multiHandLandmarks[0]
    const wrist = landmarks[0]
    const middleTip = landmarks[12]

    return {
      centerX: (wrist.x + middleTip.x) / 2,
      centerY: (wrist.y + middleTip.y) / 2,
      raw: landmarks
    }
  }

  matchCustomGesture(landmarks, handedness) {
    if (!this.gestureStore) return null

    const customGestures = this.gestureStore.getAllGestures()
    if (customGestures.length === 0) return null

    const currentFeatures = this.gestureStore.extractFeatures(landmarks, handedness)
    if (!currentFeatures) return null

    let bestMatch = null
    let bestDistance = Infinity

    for (const gesture of customGestures) {
      if (!gesture.featureTemplate) continue

      const distance = this.calculateMahalanobisDistance(
        currentFeatures,
        gesture.featureTemplate
      )

      if (distance < bestDistance && distance < this.customGestureThreshold) {
        bestDistance = distance
        bestMatch = gesture
      }
    }

    if (bestMatch) {
      const confidence = Math.max(0, 1 - bestDistance / this.customGestureThreshold)
      return {
        gesture: bestMatch.id,
        gestureName: bestMatch.name,
        gestureIcon: bestMatch.icon,
        confidence: confidence,
        isCustom: true
      }
    }

    return null
  }

  calculateMahalanobisDistance(features, template) {
    if (!template.means || !template.stds) return Infinity

    let distance = 0
    const epsilon = 0.0001

    for (let i = 0; i < features.length && i < template.means.length; i++) {
      const diff = features[i] - template.means[i]
      const std = template.stds[i] + epsilon
      distance += (diff * diff) / (std * std)
    }

    return Math.sqrt(distance / features.length)
  }

  calculateEuclideanDistance(f1, f2) {
    if (f1.length !== f2.length) return Infinity

    let sum = 0
    for (let i = 0; i < f1.length; i++) {
      sum += Math.pow(f1[i] - f2[i], 2)
    }
    return Math.sqrt(sum / f1.length)
  }

  classify(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      return { gesture: GESTURES.UNKNOWN, confidence: 0 }
    }

    const landmarks = results.multiHandLandmarks[0]
    const handedness = results.multiHandedness[0].label

    const customMatch = this.matchCustomGesture(landmarks, handedness)
    if (customMatch && customMatch.confidence > 0.6) {
      return customMatch
    }

    if (this.classifyWave(landmarks)) {
      return { gesture: GESTURES.WAVE, confidence: 0.8 }
    }

    if (this.classifyVictory(landmarks, handedness)) {
      return { gesture: GESTURES.VICTORY, confidence: 0.9 }
    }

    if (this.classifyFist(landmarks, handedness)) {
      return { gesture: GESTURES.FIST, confidence: 0.9 }
    }

    if (this.classifyPoint(landmarks, handedness)) {
      return { gesture: GESTURES.POINT, confidence: 0.85 }
    }

    if (this.classifyOpen(landmarks, handedness)) {
      return { gesture: GESTURES.OPEN, confidence: 0.8 }
    }

    if (customMatch) {
      return customMatch
    }

    return { gesture: GESTURES.UNKNOWN, confidence: 0 }
  }

  reset() {
    this.lastHandPosition = null
    this.wavePositions = []
  }
}

export { GestureClassifier, GESTURES }

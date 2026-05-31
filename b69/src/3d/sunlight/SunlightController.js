import * as THREE from 'three'
import SunPositionCalculator from './SunPositionCalculator.js'

export default class SunlightController {
  constructor(room) {
    this.room = room
    this.scene = room.getScene()
    this.camera = room.getCamera()
    this.renderer = room.getRenderer()
    
    this.sunCalc = new SunPositionCalculator()
    
    this.sunLight = null
    this.sunHelper = null
    this.lightAreaMesh = null
    
    this.enabled = false
    this.date = new Date()
    this.latitude = 39.9042
    this.longitude = 116.4074
    this.timezone = 8
    
    this.sunDistance = 30
    
    this.onSunPositionChange = null
    
    this.init()
  }

  init() {
    this.createSunLight()
    this.createLightAreaVisualization()
  }

  createSunLight() {
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 0)
    this.sunLight.position.set(10, 15, 10)
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.width = 2048
    this.sunLight.shadow.mapSize.height = 2048
    this.sunLight.shadow.camera.near = 0.5
    this.sunLight.shadow.camera.far = 100
    this.sunLight.shadow.camera.left = -20
    this.sunLight.shadow.camera.right = 20
    this.sunLight.shadow.camera.top = 20
    this.sunLight.shadow.camera.bottom = -20
    this.sunLight.shadow.bias = -0.0005
    
    this.scene.add(this.sunLight)

    const sphereGeometry = new THREE.SphereGeometry(0.5, 16, 16)
    const sphereMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffd700,
      transparent: true,
      opacity: 0
    })
    this.sunHelper = new THREE.Mesh(sphereGeometry, sphereMaterial)
    this.scene.add(this.sunHelper)
  }

  createLightAreaVisualization() {
    const geometry = new THREE.PlaneGeometry(20, 20)
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff5e6,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    })
    
    this.lightAreaMesh = new THREE.Mesh(geometry, material)
    this.lightAreaMesh.rotation.x = -Math.PI / 2
    this.lightAreaMesh.position.y = 0.02
    this.scene.add(this.lightAreaMesh)
  }

  setLocation(latitude, longitude) {
    this.latitude = latitude
    this.longitude = longitude
    this.sunCalc.setLocation(latitude, longitude)
    this.update()
  }

  setTimezone(timezone) {
    this.timezone = timezone
    this.sunCalc.setTimezone(timezone)
    this.update()
  }

  setDate(date) {
    this.date = date
    this.update()
  }

  setDateTime(year, month, day, hour, minute) {
    this.date = new Date(year, month - 1, day, hour, minute)
    this.update()
  }

  update() {
    this.sunCalc.setLocation(this.latitude, this.longitude)
    this.sunCalc.setTimezone(this.timezone)
    
    const position = this.sunCalc.calculate(this.date)
    
    const direction = this.sunCalc.getDirectionVector(position.elevation, position.azimuth)
    
    this.sunLight.position.set(
      direction.x * this.sunDistance,
      Math.max(direction.y * this.sunDistance, 2),
      direction.z * this.sunDistance
    )
    
    this.sunHelper.position.copy(this.sunLight.position)
    
    if (this.enabled) {
      this.sunLight.target.position.set(0, 0, 0)
      
      if (position.elevation > 0) {
        const intensity = Math.min(1, position.elevation / 45)
        this.sunLight.intensity = intensity
        
        const color = this.getSunColor(position.elevation)
        this.sunLight.color.setHex(color)
        
        this.updateLightAreaVisualization(position.elevation, position.azimuth)
      } else {
        this.sunLight.intensity = 0
        this.lightAreaMesh.material.opacity = 0
      }
    }
    
    if (this.onSunPositionChange) {
      this.onSunPositionChange({
        elevation: position.elevation,
        azimuth: position.azimuth,
        isDaytime: position.elevation > 0
      })
    }
  }

  getSunColor(elevation) {
    if (elevation < 0) return 0x000000
    
    if (elevation < 10) {
      return 0xff6633
    } else if (elevation < 20) {
      return 0xffaa55
    } else if (elevation < 30) {
      return 0xffcc88
    } else {
      return 0xfff5e6
    }
  }

  updateLightAreaVisualization(elevation, azimuth) {
    if (elevation <= 0) {
      this.lightAreaMesh.material.opacity = 0
      return
    }

    const canvas = document.createElement('canvas')
    const size = 512
    canvas.width = size
    canvas.height = size
    
    const ctx = canvas.getContext('2d')
    
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    )
    
    const opacity = Math.min(0.3, elevation / 100)
    gradient.addColorStop(0, `rgba(255, 245, 230, ${opacity})`)
    gradient.addColorStop(0.5, `rgba(255, 240, 200, ${opacity * 0.5})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    
    const texture = new THREE.CanvasTexture(canvas)
    this.lightAreaMesh.material.map = texture
    this.lightAreaMesh.material.opacity = 1
    this.lightAreaMesh.material.needsUpdate = true
    
    const rotationAngle = (azimuth + 90) * Math.PI / 180
    this.lightAreaMesh.rotation.z = rotationAngle
  }

  enable() {
    this.enabled = true
    this.sunHelper.material.opacity = 0.8
    this.update()
  }

  disable() {
    this.enabled = false
    this.sunLight.intensity = 0
    this.sunHelper.material.opacity = 0
    this.lightAreaMesh.material.opacity = 0
  }

  toggle() {
    if (this.enabled) {
      this.disable()
    } else {
      this.enable()
    }
    return this.enabled
  }

  isEnabled() {
    return this.enabled
  }

  getSunInfo() {
    const position = this.sunCalc.calculate(this.date)
    return {
      elevation: position.elevation,
      azimuth: position.azimuth,
      isDaytime: position.elevation > 0,
      latitude: this.latitude,
      longitude: this.longitude,
      date: this.date
    }
  }

  dispose() {
    this.scene.remove(this.sunLight)
    this.scene.remove(this.sunHelper)
    this.scene.remove(this.lightAreaMesh)
    
    if (this.sunLight) {
      this.sunLight.dispose()
    }
    if (this.sunHelper) {
      this.sunHelper.geometry.dispose()
      this.sunHelper.material.dispose()
    }
    if (this.lightAreaMesh) {
      this.lightAreaMesh.geometry.dispose()
      this.lightAreaMesh.material.dispose()
    }
  }
}

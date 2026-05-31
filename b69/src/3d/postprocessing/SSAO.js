import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export default class SSAO {
  constructor(room) {
    this.room = room
    this.scene = room.getScene()
    this.camera = room.getCamera()
    this.renderer = room.getRenderer()
    this.enabled = true
    this.composer = null
    this.ambientOcclusionPass = null
    this.bloomPass = null
    this.init()
  }

  init() {
    const width = this.renderer.domElement.clientWidth
    const height = this.renderer.domElement.clientHeight

    this.composer = new EffectComposer(this.renderer)
    
    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.1,
      0.4,
      0.85
    )
    this.composer.addPass(this.bloomPass)

    const outputPass = new OutputPass()
    this.composer.addPass(outputPass)

    this.setupResize()
  }

  setupResize() {
    window.addEventListener('resize', () => {
      const width = this.renderer.domElement.clientWidth
      const height = this.renderer.domElement.clientHeight
      this.composer.setSize(width, height)
    })
  }

  toggle() {
    this.enabled = !this.enabled
    return this.enabled
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  setBloomIntensity(intensity) {
    if (this.bloomPass) {
      this.bloomPass.strength = intensity
    }
  }

  render() {
    if (this.enabled && this.composer) {
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  getComposer() {
    return this.composer
  }

  isEnabled() {
    return this.enabled
  }

  dispose() {
    if (this.composer) {
      this.composer.dispose()
    }
  }
}

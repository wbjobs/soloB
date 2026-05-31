import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export default class Room {
  constructor(container) {
    this.container = container
    this.scene = null
    this.camera = null
    this.renderer = null
    this.controls = null
    this.furniture = []
    this.onMaterialChange = null
    this.init()
  }

  init() {
    this.createScene()
    this.createCamera()
    this.createRenderer()
    this.createControls()
    this.createRoom()
    this.createLights()
    this.setupResize()
    this.animate()
  }

  createScene() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf0f0f0)
  }

  createCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000)
    this.camera.position.set(15, 12, 15)
    this.camera.lookAt(0, 0, 0)
  }

  createRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)
  }

  createControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 5
    this.controls.maxDistance = 50
    this.controls.maxPolarAngle = Math.PI / 2.1
  }

  createRoom() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.8,
      metalness: 0.1
    })
    this.wallMaterial = wallMaterial

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.1
    })
    this.floorMaterial = floorMaterial

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      floorMaterial
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    floor.name = 'floor'
    this.scene.add(floor)

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 8),
      wallMaterial
    )
    backWall.position.set(0, 4, -10)
    backWall.receiveShadow = true
    this.scene.add(backWall)

    const leftWall = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 8),
      wallMaterial
    )
    leftWall.rotation.y = Math.PI / 2
    leftWall.position.set(-10, 4, 0)
    leftWall.receiveShadow = true
    this.scene.add(leftWall)

    const gridHelper = new THREE.GridHelper(20, 40, 0x444444, 0x888888)
    gridHelper.position.y = 0.01
    this.scene.add(gridHelper)
  }

  createLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    this.scene.add(ambientLight)

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
    this.scene.add(hemisphereLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8)
    mainLight.position.set(10, 15, 10)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = 2048
    mainLight.shadow.mapSize.height = 2048
    mainLight.shadow.camera.near = 0.5
    mainLight.shadow.camera.far = 50
    mainLight.shadow.camera.left = -15
    mainLight.shadow.camera.right = 15
    mainLight.shadow.camera.top = 15
    mainLight.shadow.camera.bottom = -15
    mainLight.shadow.bias = -0.0005
    this.scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3)
    fillLight.position.set(-10, 10, -10)
    this.scene.add(fillLight)
  }

  loadGLBModel(url, position = { x: 0, y: 0, z: 0 }) {
    const loader = new GLTFLoader()
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene
          
          this.setupModelShadows(model)
          
          const calibratedModel = this.createCalibratedModel(model)
          
          calibratedModel.position.set(position.x, position.y, position.z)
          calibratedModel.userData = { isFurniture: true, name: 'Imported Model' }
          
          this.scene.add(calibratedModel)
          this.furniture.push(calibratedModel)
          resolve(calibratedModel)
        },
        undefined,
        (error) => reject(error)
      )
    })
  }

  createCalibratedModel(model) {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)
    
    const offset = new THREE.Vector3(
      -center.x,
      -box.min.y,
      -center.z
    )
    
    model.position.add(offset)
    
    const wrapper = new THREE.Group()
    wrapper.add(model)
    
    return wrapper
  }

  setupModelShadows(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => {
              mat.needsUpdate = true
              if (mat.map) mat.map.needsUpdate = true
            })
          } else {
            child.material.needsUpdate = true
            if (child.material.map) child.material.map.needsUpdate = true
          }
        }
        
        if (child.geometry) {
          child.geometry.computeBoundingBox()
          child.geometry.computeBoundingSphere()
        }
      }
    })
  }

  addPlaceholderFurniture(type, position) {
    let geometry
    let color
    let name

    switch (type) {
      case 'sofa':
        geometry = new THREE.BoxGeometry(3, 0.8, 1)
        color = 0x8b4513
        name = 'Sofa'
        break
      case 'table':
        geometry = new THREE.BoxGeometry(1.5, 0.8, 1.5)
        color = 0x654321
        name = 'Table'
        break
      case 'chair':
        geometry = new THREE.BoxGeometry(0.6, 1, 0.6)
        color = 0x8b4513
        name = 'Chair'
        break
      case 'cabinet':
        geometry = new THREE.BoxGeometry(2, 2, 0.6)
        color = 0x8b4513
        name = 'Cabinet'
        break
      case 'lamp':
        geometry = new THREE.CylinderGeometry(0.1, 0.3, 1.5)
        color = 0xffd700
        name = 'Lamp'
        break
      case 'bed':
        geometry = new THREE.BoxGeometry(2.5, 0.5, 2)
        color = 0x654321
        name = 'Bed'
        break
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1)
        color = 0x888888
        name = 'Item'
    }

    const material = new THREE.MeshStandardMaterial({ color })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(position.x, position.y + geometry.parameters.height / 2, position.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData = { type, name, isFurniture: true }
    this.scene.add(mesh)
    this.furniture.push(mesh)
    return mesh
  }

  removeFurniture(object) {
    const index = this.furniture.indexOf(object)
    if (index > -1) {
      this.furniture.splice(index, 1)
      this.scene.remove(object)
    }
  }

  updateWallMaterial(materialData) {
    if (this.wallMaterial) {
      this.wallMaterial.color.setHex(materialData.color)
      if (materialData.roughness !== undefined) {
        this.wallMaterial.roughness = materialData.roughness
      }
      if (materialData.metalness !== undefined) {
        this.wallMaterial.metalness = materialData.metalness
      }
      if (this.onMaterialChange) {
        this.onMaterialChange('wall', materialData)
      }
    }
  }

  updateFloorMaterial(materialData) {
    if (this.floorMaterial) {
      this.floorMaterial.color.setHex(materialData.color)
      if (materialData.roughness !== undefined) {
        this.floorMaterial.roughness = materialData.roughness
      }
      if (materialData.metalness !== undefined) {
        this.floorMaterial.metalness = materialData.metalness
      }
      if (this.onMaterialChange) {
        this.onMaterialChange('floor', materialData)
      }
    }
  }

  setupResize() {
    window.addEventListener('resize', () => {
      const width = this.container.clientWidth
      const height = this.container.clientHeight
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(width, height)
    })
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  getScene() {
    return this.scene
  }

  getCamera() {
    return this.camera
  }

  getRenderer() {
    return this.renderer
  }

  getControls() {
    return this.controls
  }

  getFurniture() {
    return this.furniture
  }

  dispose() {
    this.renderer.dispose()
    this.container.removeChild(this.renderer.domElement)
  }
}

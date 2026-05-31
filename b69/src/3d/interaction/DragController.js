import * as THREE from 'three'
import Room from '../scene/Room.js'

export default class DragController {
  constructor(room) {
    this.room = room
    this.scene = room.getScene()
    this.camera = room.getCamera()
    this.renderer = room.getRenderer()
    this.controls = room.getControls()
    this.domElement = this.renderer.domElement

    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
    this.plane = new THREE.Plane()
    this.offset = new THREE.Vector3()
    this.intersection = new THREE.Vector3()
    this.inverseMatrix = new THREE.Matrix4()

    this.selected = null
    this.hovered = null
    this.isDragging = false
    this.isRotating = false

    this.onSelect = null
    this.onDeselect = null

    this.init()
  }

  init() {
    this.attach()
  }

  attach() {
    this.domElement.addEventListener('pointermove', this.onPointerMove.bind(this))
    this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this))
    this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this))
    this.domElement.addEventListener('pointerleave', this.onPointerUp.bind(this))
    this.domElement.addEventListener('keydown', this.onKeyDown.bind(this))
    document.addEventListener('keydown', this.onKeyDown.bind(this))
  }

  detach() {
    this.domElement.removeEventListener('pointermove', this.onPointerMove.bind(this))
    this.domElement.removeEventListener('pointerdown', this.onPointerDown.bind(this))
    this.domElement.removeEventListener('pointerup', this.onPointerUp.bind(this))
    this.domElement.removeEventListener('pointerleave', this.onPointerUp.bind(this))
    this.domElement.removeEventListener('keydown', this.onKeyDown.bind(this))
    document.removeEventListener('keydown', this.onKeyDown.bind(this))
  }

  updateMouse(event) {
    const rect = this.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  onPointerMove(event) {
    if (this.isRotating) return

    this.updateMouse(event)

    if (this.isDragging && this.selected) {
      this.raycaster.setFromCamera(this.mouse, this.camera)

      const targetPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      
      if (this.raycaster.ray.intersectPlane(targetPlane, this.intersection)) {
        const newPosition = this.intersection.clone().add(this.offset)
        
        const roomBounds = 9
        newPosition.x = Math.max(-roomBounds, Math.min(roomBounds, newPosition.x))
        newPosition.z = Math.max(-roomBounds, Math.min(roomBounds, newPosition.z))
        
        if (this.selected.userData && this.selected.userData.isFurniture) {
          this.selected.position.copy(newPosition)
        }
      }
    } else {
      this.raycaster.setFromCamera(this.mouse, this.camera)

      const furniture = this.room.getFurniture()
      const intersects = this.raycaster.intersectObjects(furniture, true)

      if (intersects.length > 0) {
        let object = intersects[0].object
        while (object.parent && !object.userData?.isFurniture) {
          object = object.parent
        }
        
        if (object.userData?.isFurniture || furniture.includes(object)) {
          if (this.hovered !== object) {
            if (this.hovered) {
              this.restoreCursor()
            }
            this.hovered = object
            this.domElement.style.cursor = 'move'
          }
        } else {
          this.restoreCursor()
        }
      } else {
        this.restoreCursor()
      }
    }
  }

  onPointerDown(event) {
    if (event.button !== 0) return
    if (this.isRotating) return

    this.updateMouse(event)
    this.raycaster.setFromCamera(this.mouse, this.camera)

    const furniture = this.room.getFurniture()
    const intersects = this.raycaster.intersectObjects(furniture, true)

    if (intersects.length > 0) {
      let object = intersects[0].object
      while (object.parent && !object.userData?.isFurniture) {
        object = object.parent
      }
      
      if (object.userData?.isFurniture || furniture.includes(object)) {
        this.controls.enabled = false
        this.isDragging = true
        this.selected = object

        const targetPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        
        if (this.raycaster.ray.intersectPlane(targetPlane, this.intersection)) {
          this.offset.copy(this.selected.position).sub(this.intersection)
        }

        this.domElement.style.cursor = 'grabbing'

        if (this.onSelect) {
          this.onSelect(object)
        }
      }
    } else {
      if (this.selected) {
        if (this.onDeselect) {
          this.onDeselect(this.selected)
        }
        this.selected = null
      }
    }
  }

  onPointerUp() {
    if (this.isDragging) {
      this.controls.enabled = true
      this.isDragging = false
      this.domElement.style.cursor = this.hovered ? 'move' : 'default'
    }
  }

  onKeyDown(event) {
    if (!this.selected) return

    switch (event.key.toLowerCase()) {
      case 'r':
        this.rotateSelected(Math.PI / 8)
        break
      case 'delete':
      case 'backspace':
        this.deleteSelected()
        break
      case 'arrowup':
        this.moveSelected(0, 0, -0.5)
        break
      case 'arrowdown':
        this.moveSelected(0, 0, 0.5)
        break
      case 'arrowleft':
        this.moveSelected(-0.5, 0, 0)
        break
      case 'arrowright':
        this.moveSelected(0.5, 0, 0)
        break
    }
  }

  rotateSelected(angle) {
    if (this.selected) {
      this.selected.rotation.y += angle
    }
  }

  moveSelected(x, y, z) {
    if (this.selected) {
      this.selected.position.x += x
      this.selected.position.z += z
      
      const roomBounds = 9
      this.selected.position.x = Math.max(-roomBounds, Math.min(roomBounds, this.selected.position.x))
      this.selected.position.z = Math.max(-roomBounds, Math.min(roomBounds, this.selected.position.z))
    }
  }

  deleteSelected() {
    if (this.selected) {
      this.room.removeFurniture(this.selected)
      if (this.onDeselect) {
        this.onDeselect(this.selected)
      }
      this.selected = null
      this.hovered = null
      this.restoreCursor()
    }
  }

  restoreCursor() {
    this.hovered = null
    this.domElement.style.cursor = 'default'
  }

  getSelected() {
    return this.selected
  }

  dispose() {
    this.detach()
  }
}

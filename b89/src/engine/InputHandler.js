class InputHandler {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.keys = {};
    this.mouseLocked = false;
    this.listeners = {};
    this.leftClicked = false;
    this.rightClicked = false;

    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      
      if (e.code === 'KeyT') {
        this.emit('toggle-day-night');
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.canvas.addEventListener('click', (e) => {
      if (!this.mouseLocked) {
        this.canvas.requestPointerLock();
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.mouseLocked) {
        if (e.button === 0) {
          this.leftClicked = true;
        } else if (e.button === 2) {
          this.rightClicked = true;
        }
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      this.mouseLocked = document.pointerLockElement === this.canvas;
    });

    document.addEventListener('mousemove', (e) => {
      if (this.mouseLocked) {
        this.camera.processMouseMovement(e.movementX, -e.movementY);
      }
    });
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  update(deltaTime) {
    const speed = this.camera.movementSpeed * deltaTime;

    if (this.keys['KeyW']) {
      this.camera.moveForward(speed);
    }
    if (this.keys['KeyS']) {
      this.camera.moveBackward(speed);
    }
    if (this.keys['KeyA']) {
      this.camera.moveLeft(speed);
    }
    if (this.keys['KeyD']) {
      this.camera.moveRight(speed);
    }
    if (this.keys['Space']) {
      this.camera.moveUp(speed);
    }
    if (this.keys['ShiftLeft']) {
      this.camera.moveDown(speed);
    }
  }
}

export default InputHandler;

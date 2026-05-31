import { vec3, mat4 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/+esm';

class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.position = vec3.fromValues(0, 80, 0);
    this.front = vec3.fromValues(0, 0, -1);
    this.up = vec3.fromValues(0, 1, 0);
    this.right = vec3.fromValues(1, 0, 0);
    this.worldUp = vec3.fromValues(0, 1, 0);
    
    this.yaw = -90;
    this.pitch = 0;
    
    this.fov = 70;
    this.near = 0.1;
    this.far = 2000;
    
    this.movementSpeed = 50;
    this.mouseSensitivity = 0.15;
    
    this.viewMatrix = mat4.create();
    this.projMatrix = mat4.create();
    this.viewProjMatrix = mat4.create();
    
    this.updateAspect();
    this.updateCameraVectors();
  }

  updateAspect() {
    this.aspect = this.canvas.width / this.canvas.height;
    this.updateProjectionMatrix();
  }

  updateCameraVectors() {
    const yawRad = this.yaw * Math.PI / 180;
    const pitchRad = this.pitch * Math.PI / 180;

    const front = vec3.fromValues(
      Math.cos(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      Math.sin(yawRad) * Math.cos(pitchRad)
    );
    vec3.normalize(this.front, front);

    vec3.normalize(this.right, vec3.cross(this.right, this.front, this.worldUp));
    vec3.normalize(this.up, vec3.cross(this.up, this.right, this.front));
  }

  updateViewMatrix() {
    const center = vec3.add(vec3.create(), this.position, this.front);
    mat4.lookAt(this.viewMatrix, this.position, center, this.up);
    this.updateViewProjMatrix();
  }

  updateProjectionMatrix() {
    mat4.perspective(this.projMatrix, this.fov * Math.PI / 180, this.aspect, this.near, this.far);
    this.updateViewProjMatrix();
  }

  updateViewProjMatrix() {
    mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
  }

  moveForward(delta) {
    const forward = vec3.fromValues(this.front[0], 0, this.front[2]);
    vec3.normalize(forward, forward);
    vec3.scaleAndAdd(this.position, this.position, forward, delta);
    this.updateViewMatrix();
  }

  moveBackward(delta) {
    const forward = vec3.fromValues(this.front[0], 0, this.front[2]);
    vec3.normalize(forward, forward);
    vec3.scaleAndAdd(this.position, this.position, forward, -delta);
    this.updateViewMatrix();
  }

  moveLeft(delta) {
    const right = vec3.fromValues(this.right[0], 0, this.right[2]);
    vec3.normalize(right, right);
    vec3.scaleAndAdd(this.position, this.position, right, -delta);
    this.updateViewMatrix();
  }

  moveRight(delta) {
    const right = vec3.fromValues(this.right[0], 0, this.right[2]);
    vec3.normalize(right, right);
    vec3.scaleAndAdd(this.position, this.position, right, delta);
    this.updateViewMatrix();
  }

  moveUp(delta) {
    vec3.scaleAndAdd(this.position, this.position, this.worldUp, delta);
    this.updateViewMatrix();
  }

  moveDown(delta) {
    vec3.scaleAndAdd(this.position, this.position, this.worldUp, -delta);
    this.updateViewMatrix();
  }

  processMouseMovement(xoffset, yoffset) {
    xoffset *= this.mouseSensitivity;
    yoffset *= this.mouseSensitivity;

    this.yaw += xoffset;
    this.pitch += yoffset;

    if (this.pitch > 89) this.pitch = 89;
    if (this.pitch < -89) this.pitch = -89;

    this.updateCameraVectors();
    this.updateViewMatrix();
  }

  getViewProjMatrix() {
    return this.viewProjMatrix;
  }

  getPosition() {
    return this.position;
  }

  getFrustumPlanes() {
    const planes = [];
    const m = this.viewProjMatrix;

    planes.push([
      m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]
    ]);
    planes.push([
      m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]
    ]);
    planes.push([
      m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]
    ]);
    planes.push([
      m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]
    ]);
    planes.push([
      m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]
    ]);
    planes.push([
      m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]
    ]);

    for (let plane of planes) {
      const length = Math.sqrt(plane[0] ** 2 + plane[1] ** 2 + plane[2] ** 2);
      plane[0] /= length;
      plane[1] /= length;
      plane[2] /= length;
      plane[3] /= length;
    }

    return planes;
  }
}

export default Camera;

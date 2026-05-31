class FluidRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
        this.camera.position.set(40, 30, 50);
        this.camera.lookAt(0, 0, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x0a0a1a);
        this.container.appendChild(this.renderer.domElement);
        
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        
        this.particleSystem = null;
        this.particles = [];
        this.maxParticles = 3000;
        this.scale = 1.5;
        
        this.streamlines = null;
        this.streamlineLines = [];
        this.streamlineData = [];
        this.numStreamlines = 36;
        this.stepsPerStreamline = 200;
        this.stepSize = 0.5;
        
        this.ws = null;
        this.step = 0;
        
        this.nx = 32;
        this.ny = 32;
        this.nz = 32;
        this.dx = 1.0;
        this.simDt = 0.02;
        
        this.velocityField = null;
        this.prevVelocityField = null;
        this.fieldReceived = false;
        this.fieldTime = 0;
        this.lastFrameTime = performance.now();
        
        this.viewMode = 'particles';
        
        this.initLights();
        this.initPipeGeometry();
        this.initParticles();
        this.initStreamlines();
        this.initVelocitySlice();
        
        window.addEventListener('resize', () => this.onResize());
        
        this.animate();
        this.connectWebSocket();
    }
    
    initLights() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        this.scene.add(directionalLight);
    }
    
    initPipeGeometry() {
        const radius = 12;
        const length = 48;
        
        const pipeGeometry = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true);
        const pipeMaterial = new THREE.MeshPhongMaterial({
            color: 0x3366cc,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide
        });
        
        const pipe = new THREE.Mesh(pipeGeometry, pipeMaterial);
        pipe.rotation.z = Math.PI / 2;
        this.scene.add(pipe);
        
        const wireframeGeometry = new THREE.WireframeGeometry(pipeGeometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({
            color: 0x6699ff,
            transparent: true,
            opacity: 0.3
        });
        const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        wireframe.rotation.z = Math.PI / 2;
        this.scene.add(wireframe);
        
        const axesHelper = new THREE.AxesHelper(20);
        this.scene.add(axesHelper);
    }
    
    initParticles() {
        const positions = new Float32Array(this.maxParticles * 3);
        const colors = new Float32Array(this.maxParticles * 3);
        
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                position: new THREE.Vector3(0, 0, 0),
                velocity: new THREE.Vector3(0, 0, 0),
                gridPos: { x: 0, y: 0, z: 0 },
                color: new THREE.Color()
            });
            this.resetParticle(this.particles[i]);
            
            const p = this.particles[i].position;
            positions[i * 3] = p.x;
            positions[i * 3 + 1] = p.y;
            positions[i * 3 + 2] = p.z;
            
            colors[i * 3] = 0.3;
            colors[i * 3 + 1] = 0.7;
            colors[i * 3 + 2] = 1.0;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 0.4,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        this.particleSystem = new THREE.Points(geometry, material);
        this.scene.add(this.particleSystem);
    }
    
    initStreamlines() {
        const radius = 9;
        const nx = 6;
        const ny = 6;
        
        this.streamlineSeeds = [];
        
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
                const theta = (i / nx) * Math.PI * 2;
                const r = ((j + 0.5) / ny) * radius;
                
                const x = -23;
                const y = Math.cos(theta) * r;
                const z = Math.sin(theta) * r;
                
                this.streamlineSeeds.push({ x, y, z });
            }
        }
        
        this.numStreamlines = this.streamlineSeeds.length;
        
        this.createStreamlineGeometry();
    }
    
    createStreamlineGeometry() {
        const totalVertices = this.numStreamlines * this.stepsPerStreamline * 2;
        const positions = new Float32Array(totalVertices * 3);
        const colors = new Float32Array(totalVertices * 3);
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            linewidth: 1
        });
        
        this.streamlines = new THREE.LineSegments(geometry, material);
        this.streamlines.visible = false;
        this.scene.add(this.streamlines);
    }
    
    resetParticle(particle) {
        const radius = 10;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        
        particle.position.x = -23;
        particle.position.y = Math.cos(angle) * r;
        particle.position.z = Math.sin(angle) * r;
        
        particle.velocity.set(0, 0, 0);
        
        this.worldToGrid(particle.position, particle.gridPos);
    }
    
    initVelocitySlice() {
        const gridSize = 32;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const x = (i - gridSize / 2) * this.scale;
                const y = (j - gridSize / 2) * this.scale;
                
                positions.push(x, y, 0);
                positions.push(x, y, 0);
                
                colors.push(1, 1, 1);
                colors.push(1, 1, 1);
            }
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.5
        });
        
        this.velocitySlice = new THREE.LineSegments(geometry, material);
        this.scene.add(this.velocitySlice);
    }
    
    connectWebSocket() {
        try {
            this.ws = new WebSocket('ws://localhost:8765');
            
            this.ws.onopen = () => {
                console.log('Connected to simulation server');
                this.updateStatus('Connected', 'green');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSimulationData(data);
                } catch (e) {
                    console.error('Parse error:', e);
                }
            };
            
            this.ws.onclose = () => {
                console.log('Disconnected');
                this.updateStatus('Disconnected', 'red');
                setTimeout(() => this.connectWebSocket(), 2000);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateStatus('Error', 'orange');
            };
        } catch (e) {
            console.error('Failed to connect:', e);
            setTimeout(() => this.connectWebSocket(), 2000);
        }
    }
    
    handleSimulationData(data) {
        if (data.type === 'init') {
            this.nx = data.nx;
            this.ny = data.ny;
            this.nz = data.nz;
            this.dx = data.dx;
            this.simDt = data.dt || 0.02;
            return;
        }
        
        this.step = data.step;
        
        if (data.u_slice) {
            this.prevVelocityField = this.velocityField;
            this.velocityField = {
                u: data.u_slice,
                v: data.v_slice,
                w: data.w_slice,
                p: data.p_slice,
                u_3d: data.u_3d,
                v_3d: data.v_3d,
                w_3d: data.w_3d,
                z_slices: data.z_slices || [8, 16, 24],
                step: data.step,
                maxVelocity: data.max_velocity || 2.0
            };
            this.fieldReceived = true;
            this.fieldTime = 0;
            
            this.updateVelocitySlice(data.u_slice, data.v_slice, data.w_slice);
            
            if (this.viewMode === 'streamlines') {
                this.updateStreamlines();
            }
        }
        
        if (data.centerline_u) {
            this.updateStats(data);
        }
    }
    
    updateVelocitySlice(uSlice, vSlice, wSlice) {
        if (!this.velocitySlice) return;
        
        const positions = this.velocitySlice.geometry.attributes.position.array;
        const colors = this.velocitySlice.geometry.attributes.color.array;
        const gridSize = 32;
        
        let idx = 0;
        
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const x = (i - gridSize / 2) * this.scale;
                const y = (j - gridSize / 2) * this.scale;
                
                const u = (uSlice[i] && uSlice[i][j]) || 0;
                const v = (vSlice[i] && vSlice[i][j]) || 0;
                const w = (wSlice[i] && wSlice[i][j]) || 0;
                
                const mag = Math.sqrt(u * u + v * v + w * w);
                const scaleFactor = 4;
                
                positions[idx] = x;
                positions[idx + 1] = y;
                positions[idx + 2] = 0;
                positions[idx + 3] = x + u * scaleFactor;
                positions[idx + 4] = y + v * scaleFactor;
                positions[idx + 5] = w * scaleFactor;
                
                const color = this.velocityToColor(mag);
                colors[idx] = color.r;
                colors[idx + 1] = color.g;
                colors[idx + 2] = color.b;
                colors[idx + 3] = color.r;
                colors[idx + 4] = color.g;
                colors[idx + 5] = color.b;
                
                idx += 6;
            }
        }
        
        this.velocitySlice.geometry.attributes.position.needsUpdate = true;
        this.velocitySlice.geometry.attributes.color.needsUpdate = true;
    }
    
    worldToGrid(worldPos, out) {
        out.x = worldPos.x / this.scale + this.nx / 2;
        out.y = worldPos.y / this.scale + this.ny / 2;
        out.z = worldPos.z / this.scale + this.nz / 2;
        return out;
    }
    
    gridToWorld(gridX, gridY, gridZ, out) {
        out.x = (gridX - this.nx / 2) * this.scale;
        out.y = (gridY - this.ny / 2) * this.scale;
        out.z = (gridZ - this.nz / 2) * this.scale;
        return out;
    }
    
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    
    getFieldValue(field, x, y, z) {
        if (!field) return 0;
        const cx = this.clamp(Math.floor(x), 0, this.nx - 1);
        const cy = this.clamp(Math.floor(y), 0, this.ny - 1);
        const row = field[cx] || [];
        return row[cy] || 0;
    }
    
    get3DFieldValue(field3d, zSlices, x, y, z) {
        if (!field3d || !zSlices || field3d.length < 3) {
            return this.getFieldValue(field3d ? field3d[1] : null, x, y, z);
        }
        
        const z0 = zSlices[0];
        const z1 = zSlices[1];
        const z2 = zSlices[2];
        
        if (z <= z0) {
            return this.getFieldValue(field3d[0], x, y, z);
        } else if (z <= z1) {
            const t = (z - z0) / (z1 - z0);
            return this.getFieldValue(field3d[0], x, y, z) * (1 - t) +
                   this.getFieldValue(field3d[1], x, y, z) * t;
        } else if (z <= z2) {
            const t = (z - z1) / (z2 - z1);
            return this.getFieldValue(field3d[1], x, y, z) * (1 - t) +
                   this.getFieldValue(field3d[2], x, y, z) * t;
        } else {
            return this.getFieldValue(field3d[2], x, y, z);
        }
    }
    
    sampleVelocity3D(gridX, gridY, gridZ, field) {
        if (!field) return { u: 0, v: 0, w: 0 };
        
        const nx = this.nx;
        const ny = this.ny;
        const nz = this.nz;
        
        const x0 = Math.floor(gridX);
        const y0 = Math.floor(gridY);
        const z0 = Math.floor(gridZ);
        
        const x1 = Math.min(x0 + 1, nx - 1);
        const y1 = Math.min(y0 + 1, ny - 1);
        const z1 = Math.min(z0 + 1, nz - 1);
        
        const fx = gridX - x0;
        const fy = gridY - y0;
        const fz = gridZ - z0;
        
        const getU = (x, y, z) => this.get3DFieldValue(field.u_3d, field.z_slices, x, y, z);
        const getV = (x, y, z) => this.get3DFieldValue(field.v_3d, field.z_slices, x, y, z);
        const getW = (x, y, z) => this.get3DFieldValue(field.w_3d, field.z_slices, x, y, z);
        
        const u000 = getU(x0, y0, z0);
        const u100 = getU(x1, y0, z0);
        const u010 = getU(x0, y1, z0);
        const u110 = getU(x1, y1, z0);
        const u001 = getU(x0, y0, z1);
        const u101 = getU(x1, y0, z1);
        const u011 = getU(x0, y1, z1);
        const u111 = getU(x1, y1, z1);
        
        const v000 = getV(x0, y0, z0);
        const v100 = getV(x1, y0, z0);
        const v010 = getV(x0, y1, z0);
        const v110 = getV(x1, y1, z0);
        const v001 = getV(x0, y0, z1);
        const v101 = getV(x1, y0, z1);
        const v011 = getV(x0, y1, z1);
        const v111 = getV(x1, y1, z1);
        
        const w000 = getW(x0, y0, z0);
        const w100 = getW(x1, y0, z0);
        const w010 = getW(x0, y1, z0);
        const w110 = getW(x1, y1, z0);
        const w001 = getW(x0, y0, z1);
        const w101 = getW(x1, y0, z1);
        const w011 = getW(x0, y1, z1);
        const w111 = getW(x1, y1, z1);
        
        const trilerp = (v000, v100, v010, v110, v001, v101, v011, v111, fx, fy, fz) => {
            const v00 = v000 * (1 - fx) + v100 * fx;
            const v10 = v010 * (1 - fx) + v110 * fx;
            const v01 = v001 * (1 - fx) + v101 * fx;
            const v11 = v011 * (1 - fx) + v111 * fx;
            const v0 = v00 * (1 - fy) + v10 * fy;
            const v1 = v01 * (1 - fy) + v11 * fy;
            return v0 * (1 - fz) + v1 * fz;
        };
        
        return {
            u: trilerp(u000, u100, u010, u110, u001, u101, u011, u111, fx, fy, fz),
            v: trilerp(v000, v100, v010, v110, v001, v101, v011, v111, fx, fy, fz),
            w: trilerp(w000, w100, w010, w110, w001, w101, w011, w111, fx, fy, fz)
        };
    }
    
    rk4Step(worldPos, dt, field) {
        const gridPos = { x: 0, y: 0, z: 0 };
        
        this.worldToGrid(worldPos, gridPos);
        const k1 = this.sampleVelocity3D(gridPos.x, gridPos.y, gridPos.z, field);
        
        this.worldToGrid({
            x: worldPos.x + k1.u * dt * 0.5 * this.scale,
            y: worldPos.y + k1.v * dt * 0.5 * this.scale,
            z: worldPos.z + k1.w * dt * 0.5 * this.scale
        }, gridPos);
        const k2 = this.sampleVelocity3D(gridPos.x, gridPos.y, gridPos.z, field);
        
        this.worldToGrid({
            x: worldPos.x + k2.u * dt * 0.5 * this.scale,
            y: worldPos.y + k2.v * dt * 0.5 * this.scale,
            z: worldPos.z + k2.w * dt * 0.5 * this.scale
        }, gridPos);
        const k3 = this.sampleVelocity3D(gridPos.x, gridPos.y, gridPos.z, field);
        
        this.worldToGrid({
            x: worldPos.x + k3.u * dt * this.scale,
            y: worldPos.y + k3.v * dt * this.scale,
            z: worldPos.z + k3.w * dt * this.scale
        }, gridPos);
        const k4 = this.sampleVelocity3D(gridPos.x, gridPos.y, gridPos.z, field);
        
        return {
            x: worldPos.x + (k1.u + 2 * k2.u + 2 * k3.u + k4.u) * dt * this.scale / 6,
            y: worldPos.y + (k1.v + 2 * k2.v + 2 * k3.v + k4.v) * dt * this.scale / 6,
            z: worldPos.z + (k1.w + 2 * k2.w + 2 * k3.w + k4.w) * dt * this.scale / 6,
            avgU: (k1.u + 2 * k2.u + 2 * k3.u + k4.u) / 6,
            avgV: (k1.v + 2 * k2.v + 2 * k3.v + k4.v) / 6,
            avgW: (k1.w + 2 * k2.w + 2 * k3.w + k4.w) / 6
        };
    }
    
    isInsidePipe(worldPos) {
        const maxX = (this.nx / 2 - 1) * this.scale;
        const minX = -maxX;
        const maxRadius = 10;
        
        const distFromCenter = Math.sqrt(worldPos.y ** 2 + worldPos.z ** 2);
        return worldPos.x >= minX && worldPos.x <= maxX && distFromCenter <= maxRadius;
    }
    
    updateStreamlines() {
        if (!this.streamlines || !this.velocityField) return;
        
        const positions = this.streamlines.geometry.attributes.position.array;
        const colors = this.streamlines.geometry.attributes.color.array;
        
        const maxSpeed = this.velocityField.maxVelocity || 2.0;
        let posIdx = 0;
        
        for (let sIdx = 0; sIdx < this.numStreamlines; sIdx++) {
            const seed = this.streamlineSeeds[sIdx];
            let pos = { x: seed.x, y: seed.y, z: seed.z };
            
            let prevPos = pos;
            let firstStep = true;
            
            for (let step = 0; step < this.stepsPerStreamline; step++) {
                const nextPos = this.rk4Step(pos, this.stepSize, this.velocityField);
                
                const speed = Math.sqrt(nextPos.avgU ** 2 + nextPos.avgV ** 2 + nextPos.avgW ** 2);
                
                if (!firstStep) {
                    positions[posIdx] = prevPos.x;
                    positions[posIdx + 1] = prevPos.y;
                    positions[posIdx + 2] = prevPos.z;
                    positions[posIdx + 3] = nextPos.x;
                    positions[posIdx + 4] = nextPos.y;
                    positions[posIdx + 5] = nextPos.z;
                    
                    const color = this.velocityToColor(speed);
                    colors[posIdx] = color.r;
                    colors[posIdx + 1] = color.g;
                    colors[posIdx + 2] = color.b;
                    colors[posIdx + 3] = color.r;
                    colors[posIdx + 4] = color.g;
                    colors[posIdx + 5] = color.b;
                    
                    posIdx += 6;
                }
                
                firstStep = false;
                prevPos = { x: nextPos.x, y: nextPos.y, z: nextPos.z };
                pos = prevPos;
                
                if (!this.isInsidePipe(pos)) break;
            }
            
            while (posIdx < this.numStreamlines * this.stepsPerStreamline * 2 * 3) {
                positions[posIdx] = 0;
                positions[posIdx + 1] = 0;
                positions[posIdx + 2] = 0;
                colors[posIdx] = 0;
                colors[posIdx + 1] = 0;
                colors[posIdx + 2] = 0;
                posIdx += 3;
            }
        }
        
        this.streamlines.geometry.attributes.position.needsUpdate = true;
        this.streamlines.geometry.attributes.color.needsUpdate = true;
    }
    
    interpolateVelocity(gridX, gridY, gridZ) {
        if (!this.velocityField) {
            return { u: 0, v: 0, w: 0 };
        }
        
        if (!this.prevVelocityField) {
            return this.sampleVelocity3D(gridX, gridY, gridZ, this.velocityField);
        }
        
        const t = this.fieldTime;
        const v1 = this.sampleVelocity3D(gridX, gridY, gridZ, this.prevVelocityField);
        const v2 = this.sampleVelocity3D(gridX, gridY, gridZ, this.velocityField);
        
        return {
            u: v1.u * (1 - t) + v2.u * t,
            v: v1.v * (1 - t) + v2.v * t,
            w: v1.w * (1 - t) + v2.w * t
        };
    }
    
    updateParticles(dt) {
        if (!this.fieldReceived || !this.particleSystem) return;
        
        const positions = this.particleSystem.geometry.attributes.position.array;
        const colors = this.particleSystem.geometry.attributes.color.array;
        
        const maxX = (this.nx / 2 - 1) * this.scale;
        const minX = -maxX;
        const maxRadius = 10;
        
        const maxSpeed = this.velocityField ? this.velocityField.maxVelocity : 2.0;
        const substeps = 4;
        const subDt = dt / substeps;
        
        for (let i = 0; i < this.maxParticles; i++) {
            const particle = this.particles[i];
            
            for (let s = 0; s < substeps; s++) {
                this.worldToGrid(particle.position, particle.gridPos);
                const vel = this.interpolateVelocity(
                    particle.gridPos.x,
                    particle.gridPos.y,
                    particle.gridPos.z
                );
                
                particle.velocity.x = vel.u;
                particle.velocity.y = vel.v;
                particle.velocity.z = vel.w;
                
                particle.position.x += particle.velocity.x * subDt * this.scale;
                particle.position.y += particle.velocity.y * subDt * this.scale;
                particle.position.z += particle.velocity.z * subDt * this.scale;
            }
            
            const distFromCenter = Math.sqrt(
                particle.position.y ** 2 + particle.position.z ** 2
            );
            
            if (particle.position.x > maxX || distFromCenter > maxRadius) {
                this.resetParticle(particle);
            } else if (particle.position.x < minX) {
                particle.position.x = maxX - 2;
            }
            
            const idx = i * 3;
            positions[idx] = particle.position.x;
            positions[idx + 1] = particle.position.y;
            positions[idx + 2] = particle.position.z;
            
            const speed = Math.sqrt(
                particle.velocity.x ** 2 +
                particle.velocity.y ** 2 +
                particle.velocity.z ** 2
            );
            
            const color = this.velocityToColor(Math.min(speed / maxSpeed, 1.0) * 2.0);
            colors[idx] = color.r;
            colors[idx + 1] = color.g;
            colors[idx + 2] = color.b;
        }
        
        this.particleSystem.geometry.attributes.position.needsUpdate = true;
        this.particleSystem.geometry.attributes.color.needsUpdate = true;
    }
    
    velocityToColor(t) {
        const tt = Math.min(t / 2.0, 1.0);
        
        if (tt < 0.5) {
            const ttt = tt * 2;
            return {
                r: 0.2,
                g: 0.3 + ttt * 0.4,
                b: 1.0
            };
        } else {
            const ttt = (tt - 0.5) * 2;
            return {
                r: 0.2 + ttt * 0.8,
                g: 0.7 - ttt * 0.3,
                b: 1.0 - ttt * 0.6
            };
        }
    }
    
    updateStats(data) {
        const stepEl = document.getElementById('step-count');
        if (stepEl) stepEl.textContent = data.step;
        
        if (data.max_velocity !== undefined) {
            const velEl = document.getElementById('max-velocity');
            if (velEl) velEl.textContent = data.max_velocity.toFixed(3);
        }
    }
    
    updateStatus(text, color) {
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            statusEl.textContent = text;
            statusEl.style.color = color;
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const now = performance.now();
        const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = now;
        
        const interpSpeed = 1.0 / (this.simDt || 0.02);
        this.fieldTime = Math.min(this.fieldTime + dt * interpSpeed, 1.0);
        
        if (this.controls) this.controls.update();
        
        if (this.viewMode === 'particles') {
            this.updateParticles(dt * 3);
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    onResize() {
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }
    
    setViewMode(mode) {
        this.viewMode = mode;
        
        if (this.particleSystem) {
            this.particleSystem.visible = (mode === 'particles');
        }
        if (this.streamlines) {
            this.streamlines.visible = (mode === 'streamlines');
        }
        
        if (mode === 'streamlines' && this.velocityField) {
            this.updateStreamlines();
        }
    }
    
    resetSimulation() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'reset' }));
        }
        
        for (let i = 0; i < this.maxParticles; i++) {
            this.resetParticle(this.particles[i]);
        }
        
        this.prevVelocityField = null;
        this.velocityField = null;
        this.fieldReceived = false;
        this.fieldTime = 0;
    }
}

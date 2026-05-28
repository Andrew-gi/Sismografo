// ================================================================
// SDOF — "Oscilador Masa-Resorte" convertido a Sábana FDM Geológica
// ================================================================
(function () {
    'use strict';

    let b3d = {
        scene: null, camera: null, renderer: null, controls: null,
        animId: null, running: false, container: null,
        
        // FDM Wave parameters
        gridSize: 100, dx: 1.0, dt: 0.03, c: 12.0, damping: 0.995,
        u: null, u_prev: null, colors: null,
        mesh: null, geometry: null, cube: null, geologyGroup: null, hypocenter: null, hypoRayLine: null,
        
        // Mouse interaction
        raycaster: new THREE.Raycaster(),
        mouse: new THREE.Vector2(),
        isMouseDown: false,
        isDragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
        camAngle: 0.6,
        camRadius: 60,
        camY: 45
    };

    function initArrays() {
        const N = b3d.gridSize;
        b3d.u = new Float32Array(N * N);
        b3d.u_prev = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) {
            b3d.u[i] = 0;
            b3d.u_prev[i] = 0;
        }
    }

    function addImpulse(cx, cy, radius, height) {
        const N = b3d.gridSize;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const dx = x - cx;
                const dy = y - cy;
                const distSq = dx*dx + dy*dy;
                if (distSq < radius*radius) {
                    const pulse = Math.exp(-distSq / (radius*0.5)) * height;
                    b3d.u[y * N + x] += pulse;
                    b3d.u_prev[y * N + x] += pulse;
                }
            }
        }
    }

    function stepSimulation() {
        const N = b3d.gridSize;
        const { u, u_prev, dx, dt, c, damping } = b3d;
        const C2 = (c * dt / dx) * (c * dt / dx);
        const u_next = new Float32Array(N * N);

        for (let y = 1; y < N - 1; y++) {
            for (let x = 1; x < N - 1; x++) {
                const idx = y * N + x;
                const val = u[idx];
                const laplacian = (
                    u[y * N + (x - 1)] + u[y * N + (x + 1)] + 
                    u[(y - 1) * N + x] + u[(y + 1) * N + x] - 4 * val
                );
                u_next[idx] = (2 * val - u_prev[idx] + C2 * laplacian) * damping;
            }
        }
        for (let i = 0; i < N; i++) {
            u_next[0 * N + i] = 0; u_next[(N - 1) * N + i] = 0;
            u_next[i * N + 0] = 0; u_next[i * N + (N - 1)] = 0;
        }
        b3d.u_prev.set(u);
        b3d.u.set(u_next);
    }

    function getColor(value) {
        const c = new THREE.Color();
        const mag = Math.abs(value);
        let v = Math.min(1, mag / 1.5); // Tune scale for bright colors

        if (v < 0.2) {
            // Reposo o casi reposo -> Azul fuerte
            const t = v / 0.2;
            c.lerpColors(new THREE.Color(0x020815), new THREE.Color(0x0044ff), t);
        } else if (v < 0.6) {
            // Movimiento medio -> Amarillo / Naranja
            const t = (v - 0.2) / 0.4;
            c.lerpColors(new THREE.Color(0x0044ff), new THREE.Color(0xff8800), t);
        } else {
            // Mucho movimiento -> Rojo Intenso
            const t = (v - 0.6) / 0.4;
            c.lerpColors(new THREE.Color(0xff8800), new THREE.Color(0xff0000), t);
        }
        return c;
    }

    function updateMesh() {
        if (!b3d.geometry) return;
        const pos = b3d.geometry.attributes.position;
        const colors = b3d.geometry.attributes.color;
        const N = b3d.gridSize;
        let centerU = 0;

        for (let i = 0; i < pos.count; i++) {
            const x = i % N;
            const y = Math.floor(i / N);
            if (x < N && y < N) {
                const h = b3d.u[y * N + x];
                pos.setZ(i, h);
                const col = getColor(h);
                colors.setXYZ(i, col.r, col.g, col.b);
                if (x === Math.floor(N / 2) && y === Math.floor(N / 2)) {
                    centerU = h;
                }
            }
        }

        if (b3d.cube) {
            b3d.cube.position.y = centerU + 1.5;
            // Cubo brilla más cuando rebota alto
            const pulse = Math.min(1, Math.abs(centerU)/4);
            b3d.cube.material.emissiveIntensity = 0.5 + pulse;
        }

        pos.needsUpdate = true;
        colors.needsUpdate = true;
        b3d.geometry.computeVertexNormals();
    }

    window.initSDOFBuilding3D = function () {
        b3d.container = document.getElementById('sdof-building-container');
        if (!b3d.container || b3d.running) return;

        const w = b3d.container.clientWidth || 600;
        const h = b3d.container.clientHeight || 500;

        b3d.scene = new THREE.Scene();
        b3d.scene.background = new THREE.Color(0x191412); // Warm base
        b3d.scene.fog = new THREE.FogExp2(0x191412, 0.015);

        b3d.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
        b3d.camera.position.set(0, 45, 60);

        b3d.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        b3d.renderer.setSize(w, h);
        b3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        b3d.renderer.shadowMap.enabled = true;
        
        b3d.container.appendChild(b3d.renderer.domElement);

        b3d.scene.add(new THREE.AmbientLight(0x404040, 1.5));
        const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        b3d.scene.add(dirLight);

        const N = b3d.gridSize;
        initArrays();
        b3d.geometry = new THREE.PlaneGeometry(60, 60, N - 1, N - 1);
        const count = b3d.geometry.attributes.position.count;
        b3d.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide
        });
        b3d.mesh = new THREE.Mesh(b3d.geometry, material);
        b3d.mesh.rotation.x = -Math.PI / 2;
        b3d.mesh.receiveShadow = true;
        b3d.scene.add(b3d.mesh);

        // THE CUBE
        const cubeGeo = new THREE.BoxGeometry(4, 4, 4);
        const cubeMat = new THREE.MeshStandardMaterial({ 
            color: 0xff9900, roughness: 0.2, emissive: 0xe85d04, emissiveIntensity: 0.5 
        });
        b3d.cube = new THREE.Mesh(cubeGeo, cubeMat);
        b3d.cube.position.set(0, 2, 0);
        b3d.cube.castShadow = true;
        
        const edges = new THREE.EdgesGeometry(cubeGeo);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
        b3d.cube.add(line);
        b3d.scene.add(b3d.cube);

        // ==========================================
        // GEOLOGICAL CROSS SECTION (Corte 3D Opcional)
        // ==========================================
        b3d.geologyGroup = new THREE.Group();
        b3d.geologyGroup.visible = false; // Apagado por defecto

        // Textura dinámica para las capas geológicas de las paredes
        const canvasT = document.createElement('canvas');
        canvasT.width = 128; canvasT.height = 256;
        const ctx = canvasT.getContext('2d');
        const grad = ctx.createLinearGradient(0,0, 0,256);
        grad.addColorStop(0.0, "#4a3b32"); // Suelo superior (café oscuro)
        grad.addColorStop(0.2, "#8a5a44"); // Arcilla/Roca 1
        grad.addColorStop(0.6, "#a24936"); // Roca rojiza profunda
        grad.addColorStop(1.0, "#f4a261"); // Magma/Manto inferior
        ctx.fillStyle = grad;
        ctx.fillRect(0,0, 128,256);
        const layerTex = new THREE.CanvasTexture(canvasT);
        
        const wallMat = new THREE.MeshStandardMaterial({
            map: layerTex, roughness: 0.95, side: THREE.FrontSide
        });

        // 4 paredes para simular el cubo de tierra bajo la malla
        const L = 60, H = 20;
        const w1 = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
        w1.position.set(0, -H/2, L/2);
        const w2 = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
        w2.rotation.y = Math.PI;
        w2.position.set(0, -H/2, -L/2);
        const w3 = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
        w3.rotation.y = Math.PI/2;
        w3.position.set(L/2, -H/2, 0);
        const w4 = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
        w4.rotation.y = -Math.PI/2;
        w4.position.set(-L/2, -H/2, 0);
        
        // Base oscura inferior
        const baseGeo = new THREE.PlaneGeometry(L, L);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x110805, emissive: 0x221100 });
        const floor = new THREE.Mesh(baseGeo, baseMat);
        floor.rotation.x = Math.PI/2;
        floor.position.y = -H;

        b3d.geologyGroup.add(w1, w2, w3, w4, floor);

        // Hipocentro Visual
        b3d.hypocenter = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff3300, emissiveIntensity: 2 })
        );
        b3d.hypocenter.position.set(0, -12, 0);
        b3d.geologyGroup.add(b3d.hypocenter);

        // Rayo desde hipocentro a epicentro
        const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-12,0), new THREE.Vector3(0,0,0)]);
        b3d.hypoRayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xff0000 }));
        b3d.geologyGroup.add(b3d.hypoRayLine);

        b3d.scene.add(b3d.geologyGroup);
        // ==========================================

        // MANUAL CONTROLS
        const canvas = b3d.renderer.domElement;
        canvas.addEventListener('mousedown', (e) => {
            b3d.isMouseDown = true;
            b3d.lastMouseX = e.clientX; b3d.lastMouseY = e.clientY;
            handleClick(e);
        });
        canvas.addEventListener('mousemove', (e) => {
            if (b3d.isMouseDown) {
                b3d.isDragging = true;
                const dx = e.clientX - b3d.lastMouseX;
                const dy = e.clientY - b3d.lastMouseY;
                b3d.camAngle -= dx * 0.01;
                b3d.camY = Math.max(5, Math.min(80, b3d.camY + dy * 0.2));
                b3d.lastMouseX = e.clientX; b3d.lastMouseY = e.clientY;
            }
        });
        canvas.addEventListener('mouseup', () => { 
            b3d.isMouseDown = false;
            setTimeout(() => b3d.isDragging = false, 50);
        });

        function handleClick(e) {
            if (b3d.isDragging) return;
            const rect = canvas.getBoundingClientRect();
            b3d.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            b3d.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            b3d.raycaster.setFromCamera(b3d.mouse, b3d.camera);
            const intersects = b3d.raycaster.intersectObject(b3d.mesh);
            if (intersects.length > 0) {
                const intersectObj = intersects[0];
                const uv = intersectObj.uv;
                addImpulse(Math.floor(uv.x * N), Math.floor((1 - uv.y) * N), 6, 30.0);
                
                // Actualizar posicion visual del hipocentro
                if (b3d.geologyGroup && b3d.hypocenter) {
                    const worldX = intersectObj.point.x;
                    const worldZ = intersectObj.point.z;
                    b3d.hypocenter.position.set(worldX, -12, worldZ);
                    // Actualizar el rayo
                    if (b3d.hypoRayLine) {
                        const pts = [new THREE.Vector3(worldX, -12, worldZ), new THREE.Vector3(worldX, 0, worldZ)];
                        b3d.hypoRayLine.geometry.setFromPoints(pts);
                    }
                }
            }
        }

        const resizeObs = new ResizeObserver(() => {
            if (!b3d.running || !b3d.container) return;
            const w2 = b3d.container.clientWidth;
            const h2 = b3d.container.clientHeight;
            if (w2 > 0 && h2 > 0) {
                b3d.camera.aspect = w2 / h2;
                b3d.camera.updateProjectionMatrix();
                b3d.renderer.setSize(w2, h2);
            }
        });
        resizeObs.observe(b3d.container);

        b3d.running = true;
        animate();
    };

    window.stopSDOFBuilding3D = function () {
        b3d.running = false;
        if (b3d.animId) cancelAnimationFrame(b3d.animId);
        if (b3d.renderer) {
            b3d.renderer.dispose();
            if (b3d.container) b3d.container.innerHTML = '';
        }
    };

    window.toggleGeologyMode = function() {
        if (b3d.geologyGroup) {
            b3d.geologyGroup.visible = !b3d.geologyGroup.visible;
        }
    };

    const origTrigger = window.triggerSDOFSimulation;
    window.triggerSDOFSimulation = function () {
        if (origTrigger) origTrigger();
        if (typeof window.shakeSDOFBuilding === 'function') {
            window.shakeSDOFBuilding();
        }
    };

    window.shakeSDOFBuilding = function () {
        const N = b3d.gridSize;
        // Quake at middle
        addImpulse(Math.floor(N/2), Math.floor(N/2), 10, 45.0);
        
        if (b3d.geologyGroup && b3d.hypocenter) {
            b3d.hypocenter.position.set(0, -12, 0);
            if (b3d.hypoRayLine) {
                const pts = [new THREE.Vector3(0, -12, 0), new THREE.Vector3(0, 0, 0)];
                b3d.hypoRayLine.geometry.setFromPoints(pts);
            }
        }
    };

    window.__applySDOF3DPlayback = function (ugDisp, relY) {
        if (Math.abs(ugDisp) > 0.01) {
            const N = b3d.gridSize;
            b3d.u[Math.floor(N/2)*N + Math.floor(N/2)] += ugDisp * 2.0;
        }
    };

    window.__sdof3dPlaybackEnd = function () {
    };

    function animate() {
        if (!b3d.running) return;
        b3d.animId = requestAnimationFrame(animate);

        for (let i = 0; i < 2; i++) {
            stepSimulation();
        }
        updateMesh();

        // Orbit manually
        const cx = Math.sin(b3d.camAngle) * b3d.camRadius;
        const cz = Math.cos(b3d.camAngle) * b3d.camRadius;
        b3d.camera.position.set(cx, b3d.camY, cz);
        b3d.camera.lookAt(0, 0, 0);

        b3d.renderer.render(b3d.scene, b3d.camera);
    }
})();

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

let eq3d = {
    scene: null, camera: null, renderer: null, controls: null,
    animId: null, running: false,
    container: null,
    
    // Wave parameters
    gridSize: 100,      // Grid cells N x N
    dx: 1.0,            // Spatial step
    dt: 0.03,           // Time step
    c: 12.0,            // Wave propagation speed
    damping: 0.995,     // Energy loss per frame

    // Simulation arrays
    u: null,            // Current amplitude
    u_prev: null,       // Previous amplitude
    colors: null,       // Vertex colors
    
    // Meshes
    mesh: null,
    geometry: null,
    cube: null,         // The reference structure

    // Mouse interaction
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
    isMouseDown: false
};

// Initialize arrays
function initArrays() {
    const N = eq3d.gridSize;
    eq3d.u = new Float32Array(N * N);
    eq3d.u_prev = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
        eq3d.u[i] = 0;
        eq3d.u_prev[i] = 0;
    }
}

// Add a drop/impulse at (cx, cy)
function addImpulse(cx, cy, radius, height) {
    const N = eq3d.gridSize;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const dx = x - cx;
            const dy = y - cy;
            const distSq = dx*dx + dy*dy;
            if (distSq < radius*radius) {
                // Gaussian pulse
                const pulse = Math.exp(-distSq / (radius*0.5)) * height;
                eq3d.u[y * N + x] += pulse;
                eq3d.u_prev[y * N + x] += pulse; // Start with zero velocity
            }
        }
    }
}

// FDTD Step
function stepSimulation() {
    const N = eq3d.gridSize;
    const { u, u_prev, dx, dt, c, damping } = eq3d;
    
    // stability constant: C = (c * dt / dx)^2
    const C2 = (c * dt / dx) * (c * dt / dx);

    // We need a temporary array for the new values, 
    // or we can compute in place and swap buffers.
    const u_next = new Float32Array(N * N);

    for (let y = 1; y < N - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
            const idx = y * N + x;
            
            // FDM Laplacian
            const val = u[idx];
            const laplacian = (
                u[y * N + (x - 1)] + 
                u[y * N + (x + 1)] + 
                u[(y - 1) * N + x] + 
                u[(y + 1) * N + x] - 
                4 * val
            );

            // FDTD equation: u(t+1) = 2u(t) - u(t-1) + C^2 * Laplacian
            u_next[idx] = (2 * val - u_prev[idx] + C2 * laplacian) * damping;
        }
    }

    // Apply absorbing boundary conditions (simple dampening at edges)
    for (let i = 0; i < N; i++) {
        u_next[0 * N + i] = 0;
        u_next[(N - 1) * N + i] = 0;
        u_next[i * N + 0] = 0;
        u_next[i * N + (N - 1)] = 0;
    }

    // Swap buffers
    eq3d.u_prev.set(u);
    eq3d.u.set(u_next);
}

// Map value to warm colors (cyan/deep blue -> orange/red)
function getColor(value) {
    const c = new THREE.Color();
    
    // Normalize value roughly between -5 and 5
    let v = Math.max(-1, Math.min(1, value / 5));
    
    if (v < 0) {
        // Trough: Dark blue / cyan
        c.setHSL(0.55, 0.8, 0.1 + Math.abs(v) * 0.3); // Deep blue to cyan
    } else {
        // Crest: Warm amber / red
        c.setHSL(0.08 - v * 0.08, 0.9, 0.1 + v * 0.5); // Brown to bright orange
    }
    
    return c;
}

function updateMesh() {
    const pos = eq3d.geometry.attributes.position;
    const colors = eq3d.geometry.attributes.color;
    const N = eq3d.gridSize;

    // We map the NxN grid to the plane geometry
    // The PlaneGeometry has (N) vertices per row, making (N)x(N) points.
    let centerU = 0;

    for (let i = 0; i < pos.count; i++) {
        const x = i % N;
        const y = Math.floor(i / N);
        
        // Ensure bounds
        if (x < N && y < N) {
            const h = eq3d.u[y * N + x];
            pos.setZ(i, h); // Z is up in Three.js PlaneGeometry if rotated, but visually it's Y because we rotated the mesh
            
            const col = getColor(h);
            colors.setXYZ(i, col.r, col.g, col.b);

            // Record height for the cube near center
            if (x === Math.floor(N / 2) && y === Math.floor(N / 2)) {
                centerU = h;
            }
        }
    }

    // Update cube position
    if (eq3d.cube) {
        eq3d.cube.position.y = centerU + 1.5; // sit on top
    }

    pos.needsUpdate = true;
    colors.needsUpdate = true;
    eq3d.geometry.computeVertexNormals();
}

export function initEarthquake3D() {
    eq3d.container = document.getElementById('eq3d-container');
    if (!eq3d.container || eq3d.running) return;

    const W = eq3d.container.clientWidth || 900;
    const H = eq3d.container.clientHeight || 550;

    // Scene
    eq3d.scene = new THREE.Scene();
    eq3d.scene.background = new THREE.Color(0x191412); // Warm dark background

    // Camera
    eq3d.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    eq3d.camera.position.set(0, 45, 60);

    // Renderer
    eq3d.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    eq3d.renderer.setSize(W, H);
    eq3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    eq3d.container.innerHTML = '';
    eq3d.container.appendChild(eq3d.renderer.domElement);

    // Controls
    eq3d.controls = new OrbitControls(eq3d.camera, eq3d.renderer.domElement);
    eq3d.controls.enableDamping = true;
    eq3d.controls.dampingFactor = 0.05;
    eq3d.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground

    // Lighting
    const ambient = new THREE.AmbientLight(0x404040, 1.5);
    eq3d.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    dirLight.position.set(10, 20, 10);
    eq3d.scene.add(dirLight);

    // Grid Mesh
    const N = eq3d.gridSize;
    initArrays();
    
    // Create PlaneGeometry with N-1 segments (so N vertices)
    eq3d.geometry = new THREE.PlaneGeometry(60, 60, N - 1, N - 1);
    
    // Add color attribute
    const count = eq3d.geometry.attributes.position.count;
    eq3d.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.3,
        metalness: 0.1,
        side: THREE.DoubleSide,
        wireframe: false
    });

    eq3d.mesh = new THREE.Mesh(eq3d.geometry, material);
    eq3d.mesh.rotation.x = -Math.PI / 2; // Flat on ground
    eq3d.scene.add(eq3d.mesh);

    // Add The Cube (Structure)
    const cubeGeo = new THREE.BoxGeometry(3, 3, 3);
    const cubeMat = new THREE.MeshStandardMaterial({ color: 0xff9900, roughness: 0.2 });
    eq3d.cube = new THREE.Mesh(cubeGeo, cubeMat);
    // Align horizontally with the center of the grid
    eq3d.cube.position.set(0, 1.5, 0); 
    
    // Attach some wireframe to make it look technical
    const edges = new THREE.EdgesGeometry(cubeGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
    eq3d.cube.add(line);
    
    eq3d.scene.add(eq3d.cube);

    // Event Listeners for Raycasting
    eq3d.container.addEventListener('pointerdown', onPointerDown);

    // Resize
    window.addEventListener('resize', onResize);

    eq3d.running = true;
    animate();
    
    // Trigger initial earthquake
    setTimeout(() => {
        addImpulse(Math.floor(N/2), Math.floor(N/2) + 15, 6, 25.0);
    }, 500);
}

function onPointerDown(event) {
    // Only register clicks, not drags
    const rect = eq3d.container.getBoundingClientRect();
    eq3d.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    eq3d.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    eq3d.raycaster.setFromCamera(eq3d.mouse, eq3d.camera);
    const intersects = eq3d.raycaster.intersectObject(eq3d.mesh);

    if (intersects.length > 0) {
        // Convert to grid coords
        const N = eq3d.gridSize;
        const uv = intersects[0].uv;
        const cx = Math.floor(uv.x * N);
        const cy = Math.floor((1 - uv.y) * N); // PlaneGeometry UV maps top-left to Y inverted
        addImpulse(cx, cy, 6, 30.0); // Create epicenter
    }
}

export function stopEarthquake3D() {
    eq3d.running = false;
    if (eq3d.animId) cancelAnimationFrame(eq3d.animId);
    window.removeEventListener('resize', onResize);
    if (eq3d.container) {
        eq3d.container.removeEventListener('pointerdown', onPointerDown);
    }
    // Clean up Three.js
    if (eq3d.renderer) {
        eq3d.renderer.dispose();
        eq3d.container.innerHTML = '';
    }
}

export function triggerEarthquake3D() {
    // Optional global handler
    const N = eq3d.gridSize;
    // Central random pulse
    addImpulse(Math.floor(N/2) + (Math.random()*10 - 5), Math.floor(N/2) + (Math.random()*10 - 5), 8, 40.0);
}

function onResize() {
    if (!eq3d.container || !eq3d.camera || !eq3d.renderer) return;
    const W = eq3d.container.clientWidth;
    const H = eq3d.container.clientHeight;
    if (W < 10 || H < 10) return;
    eq3d.camera.aspect = W / H;
    eq3d.camera.updateProjectionMatrix();
    eq3d.renderer.setSize(W, H);
}

function animate() {
    if (!eq3d.running) return;
    eq3d.animId = requestAnimationFrame(animate);

    // Run physics steps multiple times per frame for stability
    for (let i = 0; i < 2; i++) {
        stepSimulation();
    }
    updateMesh();

    if (eq3d.controls) eq3d.controls.update();
    eq3d.renderer.render(eq3d.scene, eq3d.camera);
}

// Map globals so UI buttons still work if they are inline attributes
window.initEarthquake3D = initEarthquake3D;
window.stopEarthquake3D = stopEarthquake3D;
window.triggerEarthquake3D = triggerEarthquake3D;

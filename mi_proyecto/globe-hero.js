/**
 * Three.js Globe Hero Visualization
 * Seismic Monitoring System
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('globe-canvas');
    if (!canvas) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000'); // Deep dark
    scene.fog = new THREE.FogExp2('#000000', 0.002);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    // Position camera slightly to the left so the globe is on the right side of the screen
    camera.position.set(40, 20, 100);
    camera.lookAt(new THREE.Vector3(20, 0, 0));

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // --- Globe Object ---
    const globeGroup = new THREE.Group();
    // Move the globe to the right side of the hero section
    globeGroup.position.set(50, 0, 0);
    scene.add(globeGroup);

    // 1. Globe Base Sphere (Dark opaque)
    const sphereGeo = new THREE.SphereGeometry(35, 64, 64);
    const sphereMat = new THREE.MeshPhongMaterial({
        color: 0x050810,
        emissive: 0x020408,
        specular: 0x111111,
        shininess: 10,
        transparent: true,
        opacity: 0.95
    });
    const globeMesh = new THREE.Mesh(sphereGeo, sphereMat);
    globeGroup.add(globeMesh);

    // 2. Wireframe / Grid Layer
    const wireframeMat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        wireframe: true,
        transparent: true,
        opacity: 0.08
    });
    const wireframeMesh = new THREE.Mesh(sphereGeo, wireframeMat);
    // Scale slightly up to prevent z-fighting
    wireframeMesh.scale.set(1.01, 1.01, 1.01);
    globeGroup.add(wireframeMesh);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00d4ff, 1.5);
    dirLight1.position.set(50, 20, 50);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xff6b35, 0.8);
    dirLight2.position.set(-50, -20, -50);
    scene.add(dirLight2);

    // --- Seismic Nodes ---
    const nodeCoords = [
        { lat: 19.4326, lng: -99.1332, name: 'CDMX' },
        { lat: 16.8531, lng: -99.8236, name: 'Acapulco' },
        { lat: 16.7569, lng: -93.1292, name: 'Tuxtla' },
        { lat: 19.0414, lng: -98.2063, name: 'Puebla' },
        { lat: 16.2317, lng: -95.1978, name: 'Salina Cruz' },
        { lat: 17.0527, lng: -96.7216, name: 'Oaxaca' },
        { lat: 18.1405, lng: -102.3082, name: 'Michoacán' }
    ];

    const nodes = [];
    const R = 35.5; // Radius for nodes (slightly above surface)

    nodeCoords.forEach(coord => {
        // Convert lat/lng to Cartesian
        const phi = (90 - coord.lat) * (Math.PI / 180);
        const theta = (coord.lng + 180) * (Math.PI / 180);

        const x = -(R * Math.sin(phi) * Math.cos(theta));
        const z = (R * Math.sin(phi) * Math.sin(theta));
        const y = (R * Math.cos(phi));

        // Node Geometry
        const g = new THREE.SphereGeometry(0.8, 16, 16);
        const m = new THREE.MeshBasicMaterial({ color: 0x00d4ff });
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(x, y, z);

        globeGroup.add(mesh);
        nodes.push({ mesh, x, y, z });
    });

    // --- Wave Propagation Rings ---
    const waves = [];

    function createWave(originNode) {
        const geometry = new THREE.RingGeometry(0.1, 0.6, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const wave = new THREE.Mesh(geometry, material);
        wave.position.copy(originNode.mesh.position);
        wave.lookAt(new THREE.Vector3(0, 0, 0)); // Face outward from center

        globeGroup.add(wave);
        waves.push({ mesh: wave, age: 0, maxAge: 100 });
    }

    // Trigger random waves from nodes
    setInterval(() => {
        const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
        createWave(randomNode);
    }, 2500);

    // --- Animation Loop ---
    let isHovering = false;

    // Stop rotation when hovering over the canvas area
    canvas.addEventListener('mouseenter', () => isHovering = true);
    canvas.addEventListener('mouseleave', () => isHovering = false);

    function animate() {
        requestAnimationFrame(animate);

        // Rotate globe
        if (!isHovering) {
            globeGroup.rotation.y += 0.0015;
            globeGroup.rotation.x += 0.0002;
        }

        // Pulse nodes
        const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.2;
        nodes.forEach(n => {
            n.mesh.scale.set(pulse, pulse, pulse);
        });

        // Update waves
        for (let i = waves.length - 1; i >= 0; i--) {
            const w = waves[i];
            w.age++;

            // Expand ring
            const scale = 1 + w.age * 0.2;
            w.mesh.scale.set(scale, scale, 1);

            // Fade out
            w.mesh.material.opacity = 0.8 * (1 - w.age / w.maxAge);

            if (w.age >= w.maxAge) {
                globeGroup.remove(w.mesh);
                w.mesh.geometry.dispose();
                w.mesh.material.dispose();
                waves.splice(i, 1);
            }
        }

        renderer.render(scene, camera);
    }

    // --- Resize Handler ---
    window.addEventListener('resize', () => {
        if (!canvas) return;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    });

    // Start animation
    animate();
});

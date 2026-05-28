// ================================================================
// scene3d.js — Visualización 3D minimalista para SDOF
//
//   Solo renderizado: base (suelo) + cubo (masa).
//   Sin cálculos físicos; recibe posición externa vía update().
//
//   Uso:
//     const scene = init3DScene(document.getElementById('mi-canvas'));
//     // En cada frame o paso de simulación:
//     scene.update(posicionX);
//     // Para limpiar:
//     scene.dispose();
// ================================================================

/**
 * Inicializa una escena Three.js sobre el canvas dado.
 *
 * @param {HTMLCanvasElement} canvasElement — <canvas> donde se renderiza
 * @param {object} [opciones]
 * @param {number} [opciones.anchoBase=8]        — Ancho de la base (X)
 * @param {number} [opciones.profBase=4]         — Profundidad de la base (Z)
 * @param {number} [opciones.altoBase=0.25]      — Altura de la base (Y)
 * @param {number} [opciones.ladoCubo=1.2]       — Lado del cubo-masa
 * @param {number} [opciones.separacionY=0.15]   — Espacio entre base y cubo
 * @param {number} [opciones.colorFondo=0x0a0e1a] — Color de fondo
 * @returns {{ update, resize, dispose, scene, camera, renderer, cubo, base }}
 */
function init3DScene(canvasElement, opciones = {}) {
    if (!canvasElement || canvasElement.tagName !== 'CANVAS') {
        throw new Error('init3DScene requiere un elemento <canvas> válido');
    }

    // ── Opciones con defaults ──
    const cfg = {
        anchoBase:    opciones.anchoBase    ?? 8,
        profBase:     opciones.profBase     ?? 4,
        altoBase:     opciones.altoBase     ?? 0.25,
        ladoCubo:     opciones.ladoCubo     ?? 1.2,
        separacionY:  opciones.separacionY  ?? 0.15,
        colorFondo:   opciones.colorFondo   ?? 0x0a0e1a,
    };

    // ── Constantes de color ──
    const CYAN      = 0x00f0ff;
    const MAGENTA   = 0xff0099;
    const AMBER     = 0xffaa00;
    const MASS_CLR  = 0x22ccff;
    const MASS_EMIT = 0x0088cc;
    const BASE_CLR  = 0x181e2a;
    const BASE_EMIT = 0x0a1828;

    // ── Dimensiones ──
    const cuboY = cfg.altoBase + cfg.separacionY + cfg.ladoCubo / 2;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({
        canvas: canvasElement,
        antialias: true,
        alpha: false,
    });
    renderer.setClearColor(cfg.colorFondo, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.SRGBColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // ── Escena ──
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(cfg.colorFondo, 0.025);

    // ── Cámara ──
    const parentW = canvasElement.parentElement
        ? canvasElement.parentElement.clientWidth
        : canvasElement.clientWidth || 600;
    const parentH = canvasElement.parentElement
        ? canvasElement.parentElement.clientHeight
        : canvasElement.clientHeight || 400;
    renderer.setSize(parentW, parentH);

    const camera = new THREE.PerspectiveCamera(40, parentW / parentH, 0.1, 120);
    camera.position.set(0, 4.5, 10);
    camera.lookAt(0, cuboY * 0.5, 0);

    // ── Iluminación ──
    scene.add(new THREE.AmbientLight(0x334466, 0.4));

    const dirLight = new THREE.DirectionalLight(0xeef4ff, 1.2);
    dirLight.position.set(6, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near  = 1;
    dirLight.shadow.camera.far   = 30;
    dirLight.shadow.camera.left  = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top   = 10;
    dirLight.shadow.camera.bottom = -6;
    scene.add(dirLight);

    const cyanLight = new THREE.PointLight(CYAN, 1.8, 20);
    cyanLight.position.set(-4, 5, 3);
    scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(MAGENTA, 0.7, 18);
    magentaLight.position.set(5, 2, -3);
    scene.add(magentaLight);

    // ── Suelo infinito (plano receptor de sombras) ──
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x060a10,
        roughness: 0.95,
        metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Base (plataforma) ──
    const baseGeo = new THREE.BoxGeometry(cfg.anchoBase, cfg.altoBase, cfg.profBase);
    const baseMat = new THREE.MeshStandardMaterial({
        color: BASE_CLR,
        roughness: 0.4,
        metalness: 0.85,
        emissive: BASE_EMIT,
        emissiveIntensity: 0.5,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = cfg.altoBase / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);

    // Grid neón sobre la base
    const gridSize = Math.min(cfg.anchoBase, cfg.profBase) * 0.92;
    const gridDiv  = 16;
    const gridY    = cfg.altoBase + 0.02;
    const gridGeo  = _buildGridGeometry(gridSize, gridDiv);
    const gridMat  = new THREE.LineBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.3,
    });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.y = gridY;
    scene.add(grid);

    // Borde neón de la base
    const edgeGeo = _buildEdgeLoop(cfg.anchoBase + 0.04, cfg.profBase + 0.04, cfg.altoBase + 0.02);
    const edgeMat = new THREE.LineBasicMaterial({ color: MAGENTA });
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    scene.add(edge);

    // ── Cubo (masa) ──
    const cuboGeo = new THREE.BoxGeometry(cfg.ladoCubo, cfg.ladoCubo, cfg.ladoCubo);
    const cuboMat = new THREE.MeshStandardMaterial({
        color: MASS_CLR,
        roughness: 0.2,
        metalness: 0.9,
        emissive: MASS_EMIT,
        emissiveIntensity: 0.75,
    });
    const cubo = new THREE.Mesh(cuboGeo, cuboMat);
    cubo.position.set(0, cuboY, 0);
    cubo.castShadow = true;
    scene.add(cubo);

    // Wireframe decorativo sobre el cubo
    const wireGeo = new THREE.EdgesGeometry(cuboGeo);
    const wireMat = new THREE.LineBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.35,
    });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    cubo.add(wire);

    // ── Estado interno ──
    let _disposed  = false;
    let _animId    = null;
    let _neonPhase = 0;

    // ── Render loop ──
    function _loop() {
        if (_disposed) return;
        _animId = requestAnimationFrame(_loop);

        // Pulso neón sutil
        _neonPhase += 0.03;
        const pulse = 0.25 + Math.sin(_neonPhase) * 0.1;
        gridMat.opacity = pulse;
        cuboMat.emissiveIntensity = 0.65 + Math.sin(_neonPhase * 1.3) * 0.15;

        renderer.render(scene, camera);
    }
    _loop();

    // ── API pública ──

    /**
     * Mueve el cubo a la posición X indicada.
     * @param {number} positionX — posición horizontal del cubo
     */
    function update(positionX) {
        if (_disposed) return;
        cubo.position.x = positionX;
    }

    /**
     * Ajusta el renderer al tamaño actual del contenedor.
     */
    function resize() {
        if (_disposed) return;
        const w = canvasElement.parentElement
            ? canvasElement.parentElement.clientWidth
            : canvasElement.clientWidth;
        const h = canvasElement.parentElement
            ? canvasElement.parentElement.clientHeight
            : canvasElement.clientHeight;
        if (w < 1 || h < 1) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    /**
     * Libera todos los recursos (geometrías, materiales, renderer).
     */
    function dispose() {
        _disposed = true;
        if (_animId) cancelAnimationFrame(_animId);

        renderer.dispose();

        scene.traverse(obj => {
            if (obj.geometry)  obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
    }

    // Escuchar resize automáticamente
    const _resizeObs = new ResizeObserver(resize);
    const observeTarget = canvasElement.parentElement || canvasElement;
    _resizeObs.observe(observeTarget);

    // ── Retornar API ──
    return {
        update,
        resize,
        dispose,
        // Acceso directo a objetos Three.js por si se necesita
        scene,
        camera,
        renderer,
        cubo,
        base,
    };
}

// ────────────────────────────────────────────────────────────────
// HELPERS (privados)
// ────────────────────────────────────────────────────────────────

function _buildGridGeometry(size, divisions) {
    const half = size / 2;
    const step = size / divisions;
    const pos = [];
    for (let i = 0; i <= divisions; i++) {
        const t = -half + i * step;
        pos.push(t, 0, -half, t, 0, half);
        pos.push(-half, 0, t, half, 0, t);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return geo;
}

function _buildEdgeLoop(w, d, y) {
    const hw = w / 2, hd = d / 2;
    const pos = new Float32Array([
        -hw, y, -hd,  hw, y, -hd,
         hw, y, -hd,  hw, y,  hd,
         hw, y,  hd, -hw, y,  hd,
        -hw, y,  hd, -hw, y, -hd,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
}

// ── Exportar ──
if (typeof module !== 'undefined' && module.exports) {
    module.exports = init3DScene;
} else if (typeof window !== 'undefined') {
    window.init3DScene = init3DScene;
}

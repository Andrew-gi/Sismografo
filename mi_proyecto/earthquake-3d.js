// ================================================================
// EARTHQUAKE 3D — 4-Engine Seismic Simulation Architecture
// ================================================================
// Motor 1: Matemático (FDTD Wave Equation Solver)
// Motor 2: Gráfico   (Three.js Geological Diorama + Surface Mesh)
// Motor 3: Instrumentación (Accel/Vel/Disp signal extraction, PGA, RMS)
// Motor 4: Análisis   (FFT, Frecuencia Dominante, Resonancia)
// ================================================================
(function () {
    'use strict';

    // ═══════════════════════════════════════════
    // MOTOR 1: MATHEMATICAL ENGINE (FDTD Solver)
    // ═══════════════════════════════════════════
    const GRID = 80;               // 80×80 mesh (balance speed/detail)
    const DX = 1.0;
    const DT = 0.025;
    const DAMPING = 0.996;
    let waveSpeed = 12.0;          // c — editable via UI input

    let u      = new Float32Array(GRID * GRID);
    let u_prev = new Float32Array(GRID * GRID);

    function resetField() {
        u.fill(0);
        u_prev.fill(0);
    }

    function addImpulse(cx, cy, radius, amplitude) {
        for (let y = 0; y < GRID; y++) {
            for (let x = 0; x < GRID; x++) {
                const dx = x - cx, dy = y - cy;
                const d2 = dx * dx + dy * dy;
                if (d2 < radius * radius) {
                    const pulse = Math.exp(-d2 / (radius * 0.5)) * amplitude;
                    u[y * GRID + x] += pulse;
                    u_prev[y * GRID + x] += pulse;
                }
            }
        }
    }

    function stepWave() {
        const C2 = (waveSpeed * DT / DX) ** 2;
        const next = new Float32Array(GRID * GRID);

        for (let y = 1; y < GRID - 1; y++) {
            for (let x = 1; x < GRID - 1; x++) {
                const i = y * GRID + x;
                const lap = u[i - 1] + u[i + 1] + u[i - GRID] + u[i + GRID] - 4 * u[i];
                next[i] = (2 * u[i] - u_prev[i] + C2 * lap) * DAMPING;
            }
        }
        // Absorbing boundaries
        for (let i = 0; i < GRID; i++) {
            next[i] = 0; next[(GRID - 1) * GRID + i] = 0;
            next[i * GRID] = 0; next[i * GRID + GRID - 1] = 0;
        }
        u_prev.set(u);
        u.set(next);
    }

    // ═══════════════════════════════════════════
    // MOTOR 3: INSTRUMENTATION ENGINE
    // ═══════════════════════════════════════════
    const SAMPLE_RATE = 40;         // Hz (samples per simulation second)
    const MAX_SIGNAL_LEN = 512;     // ~12.8 seconds of signal at 40 Hz
    const signalDisp  = [];         // u(t) — displacement at epicenter
    const signalVel   = [];         // du/dt — velocity
    const signalAccel = [];         // d²u/dt² — acceleration

    let prevDisp = 0, prevVel = 0;
    let sampleAccum = 0;
    let peakPGA = 0;
    let simActive = false;
    let simElapsed = 0;

    function resetSignals() {
        signalDisp.length = 0;
        signalVel.length = 0;
        signalAccel.length = 0;
        prevDisp = 0; prevVel = 0;
        sampleAccum = 0;
        peakPGA = 0;
        simElapsed = 0;
    }

    function sampleSignal(dt) {
        if (!simActive) return;
        simElapsed += dt;
        sampleAccum += dt;
        const sampleInterval = 1.0 / SAMPLE_RATE;
        if (sampleAccum < sampleInterval) return;
        sampleAccum -= sampleInterval;

        // Extract displacement at epicenter (center of grid)
        const cx = Math.floor(GRID / 2), cy = Math.floor(GRID / 2);
        const disp = u[cy * GRID + cx];

        // Numerical derivatives
        const vel = (disp - prevDisp) * SAMPLE_RATE;
        const accel = (vel - prevVel) * SAMPLE_RATE;

        prevDisp = disp;
        prevVel = vel;

        // Push into circular buffers
        signalDisp.push(disp);
        signalVel.push(vel);
        signalAccel.push(accel);
        if (signalDisp.length > MAX_SIGNAL_LEN) {
            signalDisp.shift(); signalVel.shift(); signalAccel.shift();
        }

        // PGA is max |accel| ever recorded in this run
        const absA = Math.abs(accel);
        if (absA > peakPGA) peakPGA = absA;
    }

    function computeRMS() {
        if (signalAccel.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < signalAccel.length; i++) sum += signalAccel[i] ** 2;
        return Math.sqrt(sum / signalAccel.length);
    }

    // ═══════════════════════════════════════════
    // MOTOR 4: ANALYSIS ENGINE (FFT)
    // ═══════════════════════════════════════════
    // Simple radix-2 DFT (good enough for 512 samples in real-time)
    function computeFFT(signal) {
        const N = 256; // Use last 256 samples
        const re = new Float32Array(N);
        const im = new Float32Array(N);
        const mag = new Float32Array(N / 2);

        // Copy last N samples, zero-pad if needed
        const offset = Math.max(0, signal.length - N);
        for (let i = 0; i < N; i++) {
            const idx = offset + i;
            // Apply Hann window
            const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
            re[i] = (idx < signal.length ? signal[idx] : 0) * w;
            im[i] = 0;
        }

        // Cooley-Tukey FFT in-place
        fftInPlace(re, im, N);

        // Compute magnitudes for positive frequencies
        for (let k = 0; k < N / 2; k++) {
            mag[k] = Math.sqrt(re[k] ** 2 + im[k] ** 2);
        }
        return mag;
    }

    function fftInPlace(re, im, N) {
        // Bit-reversal permutation
        for (let i = 1, j = 0; i < N; i++) {
            let bit = N >> 1;
            while (j & bit) { j ^= bit; bit >>= 1; }
            j ^= bit;
            if (i < j) {
                [re[i], re[j]] = [re[j], re[i]];
                [im[i], im[j]] = [im[j], im[i]];
            }
        }
        // FFT butterflies
        for (let len = 2; len <= N; len <<= 1) {
            const ang = -2 * Math.PI / len;
            const wRe = Math.cos(ang), wIm = Math.sin(ang);
            for (let i = 0; i < N; i += len) {
                let curRe = 1, curIm = 0;
                for (let j = 0; j < len / 2; j++) {
                    const tRe = curRe * re[i + j + len / 2] - curIm * im[i + j + len / 2];
                    const tIm = curRe * im[i + j + len / 2] + curIm * re[i + j + len / 2];
                    re[i + j + len / 2] = re[i + j] - tRe;
                    im[i + j + len / 2] = im[i + j] - tIm;
                    re[i + j] += tRe;
                    im[i + j] += tIm;
                    const nRe = curRe * wRe - curIm * wIm;
                    curIm = curRe * wIm + curIm * wRe;
                    curRe = nRe;
                }
            }
        }
    }

    function getDominantFrequency(fftMag) {
        if (!fftMag || fftMag.length < 2) return 0;
        let maxVal = 0, maxIdx = 1; // Skip DC component (idx 0)
        for (let k = 1; k < fftMag.length; k++) {
            if (fftMag[k] > maxVal) { maxVal = fftMag[k]; maxIdx = k; }
        }
        // freqResolution = sampleRate / N
        return maxIdx * SAMPLE_RATE / (fftMag.length * 2);
    }

    function getResonanceRisk(domFreq) {
        // Buildings typically resonate 0.5-3 Hz range
        // 0.5-1 Hz: tall buildings (>20 floors)
        // 1-3 Hz: medium buildings
        // >5 Hz: mostly harmless to structures
        if (domFreq < 0.3 || domFreq > 10) return { level: 'Bajo', color: '#22c55e' };
        if (domFreq >= 0.5 && domFreq <= 3.0) return { level: 'ALTO', color: '#dc2f02' };
        if (domFreq > 3.0 && domFreq <= 5.0) return { level: 'Medio', color: '#ffaa00' };
        return { level: 'Bajo', color: '#22c55e' };
    }

    // ═══════════════════════════════════════════
    // CHART RENDERING (Canvas 2D)
    // ═══════════════════════════════════════════
    function drawSignalChart(canvasId, data, color, yLabel) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const parent = canvas.parentElement;
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        // Margins
        const ml = 55, mr = 10, mt = 10, mb = 30;
        const pw = W - ml - mr, ph = H - mt - mb;

        // Find data range
        let yMax = 0.001;
        for (let i = 0; i < data.length; i++) {
            const a = Math.abs(data[i]);
            if (a > yMax) yMax = a;
        }
        yMax *= 1.2; // headroom

        // Grid lines
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = mt + (i / 4) * ph;
            ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
        }
        // Zero line
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1;
        const zeroY = mt + ph / 2;
        ctx.beginPath(); ctx.moveTo(ml, zeroY); ctx.lineTo(ml + pw, zeroY); ctx.stroke();

        // Y-axis labels
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText((+yMax).toFixed(2), ml - 4, mt + 10);
        ctx.fillText('0', ml - 4, zeroY + 3);
        ctx.fillText((-yMax).toFixed(2), ml - 4, mt + ph);

        // X-axis label
        ctx.textAlign = 'center';
        ctx.fillText('Tiempo (s)', ml + pw / 2, H - 4);

        // Tick marks on X
        const totalTime = data.length / SAMPLE_RATE;
        for (let t = 0; t <= totalTime; t += 2) {
            const x = ml + (t / totalTime) * pw;
            if (x >= ml && x <= ml + pw) {
                ctx.fillText(t.toFixed(0), x, mt + ph + 16);
            }
        }

        // Draw signal
        if (data.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const x = ml + (i / (data.length - 1)) * pw;
            const y = zeroY - (data[i] / yMax) * (ph / 2);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawFFTChart(fftMag) {
        const canvas = document.getElementById('eq3d-fft-canvas');
        if (!canvas || !fftMag) return;
        const parent = canvas.parentElement;
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;

        ctx.clearRect(0, 0, W, H);
        const ml = 55, mr = 10, mt = 10, mb = 30;
        const pw = W - ml - mr, ph = H - mt - mb;

        // Find max magnitude
        let yMax = 0.001;
        for (let k = 1; k < fftMag.length; k++) {
            if (fftMag[k] > yMax) yMax = fftMag[k];
        }
        yMax *= 1.15;

        // Grid
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = mt + (i / 4) * ph;
            ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
        }

        // X-axis (frequency)
        const maxFreq = SAMPLE_RATE / 2;
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Frecuencia (Hz)', ml + pw / 2, H - 4);
        for (let f = 0; f <= maxFreq; f += 5) {
            const x = ml + (f / maxFreq) * pw;
            ctx.fillText(f.toFixed(0), x, mt + ph + 16);
        }

        // Y label
        ctx.textAlign = 'right';
        ctx.fillText(yMax.toFixed(1), ml - 4, mt + 10);
        ctx.fillText('0', ml - 4, mt + ph);

        // Draw spectrum as filled area
        ctx.fillStyle = 'rgba(124, 58, 237, 0.15)';
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ml, mt + ph);
        for (let k = 1; k < fftMag.length; k++) {
            const x = ml + (k / (fftMag.length - 1)) * pw;
            const y = mt + ph - (fftMag[k] / yMax) * ph;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(ml + pw, mt + ph);
        ctx.closePath();
        ctx.fill();
        // Stroke on top
        ctx.beginPath();
        for (let k = 1; k < fftMag.length; k++) {
            const x = ml + (k / (fftMag.length - 1)) * pw;
            const y = mt + ph - (fftMag[k] / yMax) * ph;
            if (k === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Mark dominant frequency
        const domFreq = getDominantFrequency(fftMag);
        if (domFreq > 0) {
            const domX = ml + (domFreq / maxFreq) * pw;
            ctx.strokeStyle = '#dc2f02';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(domX, mt); ctx.lineTo(domX, mt + ph); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#dc2f02';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${domFreq.toFixed(1)} Hz`, domX + 4, mt + 14);
        }
    }

    // ═══════════════════════════════════════════
    // UPDATE HUD GAUGES
    // ═══════════════════════════════════════════
    let chartThrottle = 0;

    function updateHUD(fftMag) {
        const pga = peakPGA;
        const rms = computeRMS();
        const domFreq = getDominantFrequency(fftMag);
        const res = getResonanceRisk(domFreq);

        // Convert acceleration to g (rough: cm/s² → g: /981)
        const pgaG = pga / 981;

        const pgaEl = document.getElementById('eq3d-pga-val');
        const rmsEl = document.getElementById('eq3d-rms-val');
        const fdomEl = document.getElementById('eq3d-fdom-val');
        const resEl = document.getElementById('eq3d-res-val');

        if (pgaEl) pgaEl.textContent = pgaG.toFixed(3) + ' g';
        if (rmsEl) rmsEl.textContent = rms.toFixed(3);
        if (fdomEl) fdomEl.textContent = domFreq > 0 ? domFreq.toFixed(1) + ' Hz' : '— Hz';
        if (resEl) { resEl.textContent = res.level; resEl.style.color = res.color; }

        // Update info bar
        const infoEl = document.getElementById('eq3d-info');
        if (infoEl) {
            const mag = eq3d.params.magnitude;
            const depth = eq3d.params.depth;
            const energy = (10 ** (1.5 * mag + 4.8)).toExponential(2);
            const soilNames = { mixed: 'Mixto (×1.5)', rock: 'Roca (×1.0)', sediment: 'Sedimento (×2.0)' };
            infoEl.innerHTML = `<span><b>M</b> ${mag.toFixed(1)}</span>` +
                `<span><b>Prof.</b> ${depth} km</span>` +
                `<span><b>E</b> ${energy} J</span>` +
                `<span><b>Suelo</b> ${soilNames[eq3d.params.soil] || 'Mixto'}</span>` +
                `<span><b>PGA</b> ${pgaG.toFixed(3)}g</span>`;
        }
    }

    // ═══════════════════════════════════════════
    // MOTOR 2: GRAPHICS ENGINE (Three.js)
    // ═══════════════════════════════════════════
    let eq3d = {
        scene: null, camera: null, renderer: null,
        animId: null, running: false, container: null,
        canvas: null, resizeObserver: null, eventController: null,
        surfaceMesh: null, surfaceGeo: null,
        objects: {
            terrainGroup: null,
            focus: null, epicenter: null, faultLine: null,
            shockWaves: [], sprites: []
        },
        params: { magnitude: 5.0, depth: 30, soil: 'mixed' },
        isMouseDown: false, isDragging: false,
        lastMouseX: 0, lastMouseY: 0,
        camAngle: 0.6, camRadius: 40, camY: 15,
        targetCamAngle: 0.6, targetCamY: 15,
        lastTime: 0,
        surfaceDirty: true,
        normalFrameSkip: 0
    };

    const MAX_RENDER_DPR = 1.25;

    function disposeMaterial(material) {
        if (!material) return;
        [
            'map', 'lightMap', 'aoMap', 'emissiveMap', 'bumpMap', 'normalMap',
            'roughnessMap', 'metalnessMap', 'alphaMap', 'envMap'
        ].forEach((key) => {
            const texture = material[key];
            if (texture && typeof texture.dispose === 'function') texture.dispose();
        });
        if (typeof material.dispose === 'function') material.dispose();
    }

    function disposeSceneObject(root) {
        if (!root) return;
        root.traverse((obj) => {
            if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
            if (obj.material) {
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach(disposeMaterial);
            }
        });
    }

    function resetEq3dObjectRefs() {
        eq3d.surfaceMesh = null;
        eq3d.surfaceGeo = null;
        eq3d.objects = {
            terrainGroup: null,
            focus: null,
            epicenter: null,
            faultLine: null,
            shockWaves: [],
            sprites: []
        };
    }

    function getGeologyTexture() {
        const c = document.createElement('canvas');
        c.width = 128; c.height = 512;
        const ctx = c.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0.00, "#3e5c20");
        grad.addColorStop(0.02, "#4a3b32");
        grad.addColorStop(0.15, "#8a5a44");
        grad.addColorStop(0.40, "#5a3a2a");
        grad.addColorStop(0.70, "#a24936");
        grad.addColorStop(1.00, "#e85d04");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 512);
        return new THREE.CanvasTexture(c);
    }

    function createLabel(text, colorHex) {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        c.width = 256; c.height = 64;
        ctx.fillStyle = 'rgba(10,15,25,0.85)';
        ctx.roundRect(0, 0, 256, 64, 12); ctx.fill();
        ctx.strokeStyle = colorHex; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 32);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(6, 1.5, 1);
        return sprite;
    }

    function getHeatColor(value) {
        const c = new THREE.Color();
        const v = Math.min(1, Math.abs(value) / 1.5);
        if (v < 0.2) {
            c.lerpColors(new THREE.Color(0x020815), new THREE.Color(0x0044ff), v / 0.2);
        } else if (v < 0.6) {
            c.lerpColors(new THREE.Color(0x0044ff), new THREE.Color(0xff8800), (v - 0.2) / 0.4);
        } else {
            c.lerpColors(new THREE.Color(0xff8800), new THREE.Color(0xff0000), (v - 0.6) / 0.4);
        }
        return c;
    }

    function buildDiorama() {
        eq3d.objects.terrainGroup = new THREE.Group();
        eq3d.scene.add(eq3d.objects.terrainGroup);

        const W = 30, D = 30, H = 20;

        // Geological block (6-material box)
        const geoTex = getGeologyTexture();
        const topMat = new THREE.MeshStandardMaterial({ color: 0x3e5c20, roughness: 0.9 });
        const sideMat = new THREE.MeshStandardMaterial({ map: geoTex, roughness: 1.0 });
        const botMat = new THREE.MeshStandardMaterial({ color: 0xe85d04, emissive: 0x551100 });
        const block = new THREE.Mesh(
            new THREE.BoxGeometry(W, H, D),
            [sideMat, sideMat, topMat, botMat, sideMat, sideMat]
        );
        block.position.y = -H / 2;
        block.castShadow = true; block.receiveShadow = true;
        eq3d.objects.terrainGroup.add(block);

        // Surface mesh (FDTD visualization on top of block)
        eq3d.surfaceGeo = new THREE.PlaneGeometry(W, D, GRID - 1, GRID - 1);
        const count = eq3d.surfaceGeo.attributes.position.count;
        eq3d.surfaceGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        // Initialize colors to dark
        const cols = eq3d.surfaceGeo.attributes.color;
        const darkC = new THREE.Color(0x020815);
        for (let i = 0; i < count; i++) cols.setXYZ(i, darkC.r, darkC.g, darkC.b);

        eq3d.surfaceMesh = new THREE.Mesh(eq3d.surfaceGeo, new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide
        }));
        eq3d.surfaceMesh.rotation.x = -Math.PI / 2;
        eq3d.surfaceMesh.position.y = 0.05;
        eq3d.objects.terrainGroup.add(eq3d.surfaceMesh);

        // Grid
        const grid = new THREE.GridHelper(30, 15, 0x000000, 0x000000);
        grid.position.y = 0.04; grid.material.opacity = 0.1; grid.material.transparent = true;
        eq3d.objects.terrainGroup.add(grid);

        // Hypocenter
        eq3d.objects.focus = new THREE.Mesh(
            new THREE.SphereGeometry(0.6, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff2200, emissiveIntensity: 2 })
        );
        updateFocusPosition();
        eq3d.objects.terrainGroup.add(eq3d.objects.focus);

        // Epicenter
        eq3d.objects.epicenter = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff5500, emissiveIntensity: 1 })
        );
        eq3d.objects.epicenter.position.set(0, 0.2, 0);
        eq3d.objects.terrainGroup.add(eq3d.objects.epicenter);

        // Fault line
        const lineMat = new THREE.LineDashedMaterial({ color: 0xff0000, dashSize: 0.5, gapSize: 0.3 });
        eq3d.objects.faultLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            lineMat
        );
        eq3d.objects.faultLine.computeLineDistances();
        eq3d.objects.terrainGroup.add(eq3d.objects.faultLine);

        // Labels
        const lblF = createLabel("Hipocentro (Foco)", "#ff0000");
        const lblE = createLabel("Epicentro", "#ffaa00");
        eq3d.objects.terrainGroup.add(lblF); eq3d.objects.terrainGroup.add(lblE);
        eq3d.objects.sprites.push({ sprite: lblF, type: 'focus' });
        eq3d.objects.sprites.push({ sprite: lblE, type: 'epi' });

        updateLayout();
    }

    function updateSurfaceMesh() {
        if (!eq3d.surfaceGeo) return;
        const pos = eq3d.surfaceGeo.attributes.position;
        const cols = eq3d.surfaceGeo.attributes.color;
        for (let i = 0; i < pos.count; i++) {
            const x = i % GRID, y = Math.floor(i / GRID);
            if (x < GRID && y < GRID) {
                const h = u[y * GRID + x];
                pos.setZ(i, h * 0.5); // Scale height for visual
                const c = getHeatColor(h);
                cols.setXYZ(i, c.r, c.g, c.b);
            }
        }
        pos.needsUpdate = true;
        cols.needsUpdate = true;
        eq3d.normalFrameSkip = (eq3d.normalFrameSkip + 1) % 2;
        if (eq3d.normalFrameSkip === 0) eq3d.surfaceGeo.computeVertexNormals();
        eq3d.surfaceDirty = false;
    }

    function updateFocusPosition() {
        const norm = (eq3d.params.depth - 5) / 295;
        if (eq3d.objects.focus) eq3d.objects.focus.position.set(0, -0.5 - norm * 19, 0);
    }

    function updateLayout() {
        if (!eq3d.objects.focus || !eq3d.objects.faultLine) return;
        const fY = eq3d.objects.focus.position.y;
        eq3d.objects.faultLine.geometry.setFromPoints([new THREE.Vector3(0, fY, 0), new THREE.Vector3(0, 0, 0)]);
        eq3d.objects.faultLine.computeLineDistances();
        eq3d.objects.sprites.forEach(s => {
            if (s.type === 'focus') s.sprite.position.set(4, fY, 0);
            else s.sprite.position.set(4, 2, 0);
        });
    }

    // ═══════════════════════════════════════════
    // PUBLIC API (called from HTML)
    // ═══════════════════════════════════════════
    window.updateEq3dMagnitude = function (val) {
        eq3d.params.magnitude = parseFloat(val);
        const el = document.getElementById('eq3d-mag-val');
        if (el) el.textContent = eq3d.params.magnitude.toFixed(1);
    };

    window.updateEq3dDepth = function (val) {
        eq3d.params.depth = parseFloat(val);
        const el = document.getElementById('eq3d-depth-val');
        if (el) el.textContent = eq3d.params.depth.toFixed(0);
        updateFocusPosition(); updateLayout();
    };

    window.updateEq3dSoil = function (val) {
        eq3d.params.soil = val;
        // Soil changes wave speed
        const speeds = { rock: 18, mixed: 12, sediment: 7 };
        waveSpeed = speeds[val] || 12;
        const wsInput = document.getElementById('eq3d-wave-speed');
        if (wsInput) wsInput.value = waveSpeed;
    };

    window.updateEq3dWaveSpeed = function (val) {
        waveSpeed = Math.max(1, Math.min(50, parseFloat(val) || 12));
    };

    window.triggerEarthquake3D = function () {
        if (!eq3d.running) return;

        // Reset simulation state
        resetField();
        resetSignals();

        // Clean old shock waves
        eq3d.objects.shockWaves.forEach(w => {
            eq3d.objects.terrainGroup.remove(w.mesh);
            w.mesh.geometry.dispose(); w.material.dispose();
        });
        eq3d.objects.shockWaves = [];

        // Calculate physical parameters from user inputs
        const mag = eq3d.params.magnitude;
        const depth = eq3d.params.depth;
        const soilAmp = eq3d.params.soil === 'sediment' ? 2.0 : (eq3d.params.soil === 'rock' ? 0.6 : 1.0);

        // Amplitude scales with magnitude (log scale)
        const amplitude = (10 ** ((mag - 3) / 2)) * 5 * soilAmp;
        const radius = 4 + mag * 0.8;

        // Inject impulse at center (epicenter)
        addImpulse(GRID / 2, GRID / 2, radius, amplitude);

        // Create visual shock waves from hypocenter
        const fY = eq3d.objects.focus.position.y;
        const waveCount = Math.floor(mag);
        const speed = eq3d.params.soil === 'rock' ? 25 : (eq3d.params.soil === 'sediment' ? 10 : 18);
        for (let i = 0; i < waveCount; i++) {
            const wg = new THREE.SphereGeometry(1, 32, 16);
            const wm = new THREE.MeshBasicMaterial({ color: 0xff3300, wireframe: true, transparent: true, opacity: 0 });
            const mesh = new THREE.Mesh(wg, wm);
            mesh.position.set(0, fY, 0);
            eq3d.objects.terrainGroup.add(mesh);
            eq3d.objects.shockWaves.push({
                mesh, material: wm, life: 0,
                startDelay: i * (1.2 / waveCount),
                maxRadius: 15 + mag * 2, speed
            });
        }

        eq3d.objects.focus.material.emissiveIntensity = 5;
        simActive = true;
        eq3d.surfaceDirty = true;
    };

    // ═══════════════════════════════════════════
    // INIT & MAIN LOOP
    // ═══════════════════════════════════════════
    window.initEarthquake3D = function () {
        eq3d.container = document.getElementById('eq3d-container');
        if (!eq3d.container || eq3d.running) return;

        const w = eq3d.container.clientWidth || 900;
        const h = eq3d.container.clientHeight || 550;

        eq3d.scene = new THREE.Scene();
        eq3d.scene.background = new THREE.Color(0x0c1015);

        eq3d.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
        eq3d.camera.position.set(30, 15, 30);
        eq3d.camera.lookAt(0, -5, 0);

        eq3d.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        eq3d.renderer.setSize(w, h);
        eq3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR));
        eq3d.renderer.shadowMap.enabled = true;
        eq3d.container.innerHTML = '';
        eq3d.container.appendChild(eq3d.renderer.domElement);

        eq3d.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const d1 = new THREE.DirectionalLight(0xffeedd, 1.4);
        d1.position.set(20, 30, 10); eq3d.scene.add(d1);
        const d2 = new THREE.DirectionalLight(0xddddff, 0.6);
        d2.position.set(-20, 10, -20); eq3d.scene.add(d2);

        buildDiorama();

        // Raycaster for click-to-epicenter on surface mesh
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const canvas = eq3d.renderer.domElement;
        eq3d.canvas = canvas;
        eq3d.eventController = new AbortController();
        const eventOptions = { signal: eq3d.eventController.signal };

        canvas.addEventListener('mousedown', (e) => {
            eq3d.isMouseDown = true;
            eq3d.isDragging = false;
            eq3d.lastMouseX = e.clientX; eq3d.lastMouseY = e.clientY;
        }, eventOptions);
        canvas.addEventListener('mousemove', (e) => {
            if (eq3d.isMouseDown) {
                eq3d.isDragging = true;
                eq3d.targetCamAngle -= (e.clientX - eq3d.lastMouseX) * 0.005;
                eq3d.targetCamY = Math.max(-5, Math.min(40, eq3d.targetCamY + (e.clientY - eq3d.lastMouseY) * 0.1));
                eq3d.lastMouseX = e.clientX; eq3d.lastMouseY = e.clientY;
            }
        }, eventOptions);
        canvas.addEventListener('mouseup', (e) => {
            if (!eq3d.isDragging && eq3d.surfaceMesh) {
                // Click to create epicenter
                const rect = canvas.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, eq3d.camera);
                const hits = raycaster.intersectObject(eq3d.surfaceMesh);
                if (hits.length > 0 && hits[0].uv) {
                    const uv = hits[0].uv;
                    const gx = Math.floor(uv.x * GRID), gy = Math.floor((1 - uv.y) * GRID);
                    const mag = eq3d.params.magnitude;
                    const soilAmp = eq3d.params.soil === 'sediment' ? 2.0 : (eq3d.params.soil === 'rock' ? 0.6 : 1.0);
                    addImpulse(gx, gy, 4 + mag * 0.5, (10 ** ((mag - 3) / 2)) * 3 * soilAmp);
                    simActive = true;
                    eq3d.surfaceDirty = true;
                    resetSignals();
                    // Move hypocenter
                    const wp = hits[0].point;
                    if (eq3d.objects.focus) eq3d.objects.focus.position.set(wp.x, eq3d.objects.focus.position.y, wp.z);
                    if (eq3d.objects.epicenter) eq3d.objects.epicenter.position.set(wp.x, 0.2, wp.z);
                    updateLayout();
                }
            }
            eq3d.isMouseDown = false;
            setTimeout(() => eq3d.isDragging = false, 50);
        }, eventOptions);
        canvas.addEventListener('mouseleave', () => { eq3d.isMouseDown = false; }, eventOptions);
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            eq3d.camRadius = Math.max(15, Math.min(80, eq3d.camRadius + e.deltaY * 0.05));
        }, { passive: false, signal: eq3d.eventController.signal });

        eq3d.resizeObserver = new ResizeObserver(() => {
            if (!eq3d.running || !eq3d.container) return;
            const w2 = eq3d.container.clientWidth, h2 = eq3d.container.clientHeight;
            if (w2 > 0 && h2 > 0) {
                eq3d.camera.aspect = w2 / h2;
                eq3d.camera.updateProjectionMatrix();
                eq3d.renderer.setSize(w2, h2);
            }
        });
        eq3d.resizeObserver.observe(eq3d.container);

        eq3d.lastTime = performance.now();
        eq3d.running = true;
        chartThrottle = 0;
        resetField();
        eq3d.surfaceDirty = true;
        eq3d.normalFrameSkip = 0;
        resetSignals();
        updateSurfaceMesh();
        animate();
    };

    window.stopEarthquake3D = function () {
        eq3d.running = false;
        simActive = false;
        chartThrottle = 0;
        if (eq3d.animId) cancelAnimationFrame(eq3d.animId);
        eq3d.animId = null;
        if (eq3d.resizeObserver) {
            eq3d.resizeObserver.disconnect();
            eq3d.resizeObserver = null;
        }
        if (eq3d.eventController) {
            eq3d.eventController.abort();
            eq3d.eventController = null;
        }
        if (eq3d.scene) {
            disposeSceneObject(eq3d.scene);
        }
        if (eq3d.renderer) {
            eq3d.renderer.dispose();
            if (typeof eq3d.renderer.forceContextLoss === 'function') eq3d.renderer.forceContextLoss();
            if (eq3d.container) eq3d.container.innerHTML = '';
        }
        eq3d.renderer = null;
        eq3d.scene = null;
        eq3d.camera = null;
        eq3d.canvas = null;
        eq3d.container = null;
        eq3d.surfaceDirty = true;
        eq3d.normalFrameSkip = 0;
        resetEq3dObjectRefs();
    };

    // ═══════════════════════════════════════════
    // MASTER ANIMATION LOOP (orchestrates all 4 engines)
    // ═══════════════════════════════════════════
    function animate() {
        if (!eq3d.running) return;
        eq3d.animId = requestAnimationFrame(animate);

        const now = performance.now();
        const dt = Math.min(0.05, (now - eq3d.lastTime) / 1000);
        eq3d.lastTime = now;

        // ── MOTOR 1: Step wave equation ──
        if (simActive) {
            for (let i = 0; i < 3; i++) stepWave();
            eq3d.surfaceDirty = true;
        }

        // ── MOTOR 3: Sample instrumentation ──
        sampleSignal(dt);

        // ── MOTOR 2: Update 3D graphics ──
        if (eq3d.surfaceDirty) updateSurfaceMesh();

        // Shock wave animation
        if (eq3d.objects.focus && eq3d.objects.focus.material.emissiveIntensity > 2) {
            eq3d.objects.focus.material.emissiveIntensity -= dt * 3;
        }
        for (let i = eq3d.objects.shockWaves.length - 1; i >= 0; i--) {
            const w = eq3d.objects.shockWaves[i];
            w.startDelay -= dt;
            if (w.startDelay > 0) continue;
            w.life += dt;
            const r = w.life * w.speed;
            if (r >= w.maxRadius) {
                eq3d.objects.terrainGroup.remove(w.mesh);
                w.mesh.geometry.dispose(); w.material.dispose();
                eq3d.objects.shockWaves.splice(i, 1);
                continue;
            }
            w.mesh.scale.set(r, r, r);
            w.material.opacity = Math.max(0, (1 - r / w.maxRadius) * 0.8);
        }

        // Camera
        eq3d.camAngle += (eq3d.targetCamAngle - eq3d.camAngle) * 0.1;
        eq3d.camY += (eq3d.targetCamY - eq3d.camY) * 0.1;
        if (!eq3d.isMouseDown) eq3d.targetCamAngle += 0.001;
        eq3d.camera.position.set(
            Math.sin(eq3d.camAngle) * eq3d.camRadius,
            eq3d.camY,
            Math.cos(eq3d.camAngle) * eq3d.camRadius
        );
        eq3d.camera.lookAt(0, -5, 0);

        if (eq3d.renderer && eq3d.scene && eq3d.camera) {
            eq3d.renderer.render(eq3d.scene, eq3d.camera);
        }

        // ── MOTOR 4: Analysis + Chart rendering (throttled to ~8 fps) ──
        chartThrottle += dt;
        if (chartThrottle >= 0.125) {
            chartThrottle = 0;
            const fftMag = signalAccel.length >= 32 ? computeFFT(signalAccel) : null;

            drawSignalChart('eq3d-accel-canvas', signalAccel, '#dc2f02', 'cm/s²');
            drawSignalChart('eq3d-vel-canvas', signalVel, '#2563eb', 'cm/s');
            drawSignalChart('eq3d-disp-canvas', signalDisp, '#16a34a', 'cm');
            drawFFTChart(fftMag);
            updateHUD(fftMag);
        }
    }
})();

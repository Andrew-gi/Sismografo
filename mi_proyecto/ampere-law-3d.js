(function () {
    const MU0 = 4 * Math.PI * 1e-7;

    const state = {
        initialized: false,
        running: false,
        rafId: 0,
        needsUpdate: true,
        graphDirty: true,
        simulationActive: false,
        phase: 0,
        lastTs: 0,
        lastGraphDraw: 0,
        controls: {
            current: 18,
            direction: 1,
            wireRadius: 0.55,
            loopRadius: 1.6,
            samples: 20,
            configuration: 'outer-loop'
        },
        metrics: {
            fieldOnLoop: 0,
            enclosedCurrent: 0,
            circulation: 0,
            mu0I: 0,
            region: 'Fuera del conductor'
        },
        dom: {
            host: null,
            graphCanvas: null,
            inputConfig: null,
            configLabel: null,
            simulateBtn: null,
            simStatus: null,
            inputCurrent: null,
            inputWireRadius: null,
            inputLoopRadius: null,
            inputSamples: null,
            directionBtn: null,
            directionLabel: null,
            valCurrent: null,
            valWireRadius: null,
            valLoopRadius: null,
            valSamples: null,
            metricField: null,
            metricIenc: null,
            metricCirculation: null,
            metricMu0I: null,
            metricProgress: null,
            metricRegion: null,
            equation: null,
            liveEquation: null
        },
        three: {
            renderer: null,
            scene: null,
            camera: null,
            wireCore: null,
            wireShell: null,
            currentPulseGroup: null,
            fieldArrowGroup: null,
            referenceRingGroup: null,
            ampereLoop: null,
            ampereLoopTrace: null,
            tracer: null,
            controls: {
                radius: 7.6,
                azimuth: -0.62,
                polar: 1.02,
                dragging: false,
                lastX: 0,
                lastY: 0,
                target: null
            }
        }
    };

    const MAX_RENDER_DPR = 1.35;
    const GRAPH_FRAME_MS = 90;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function formatFixed(value, digits) {
        return Number.isFinite(value) ? value.toFixed(digits) : '0';
    }

    function formatScientific(value, digits) {
        if (!Number.isFinite(value) || Math.abs(value) < 1e-15) return '0.00e+0';
        return value.toExponential(digits);
    }

    function formatMicroTesla(valueTesla) {
        return `${formatScientific(valueTesla * 1e6, 2)} uT`;
    }

    function formatTeslaMeter(value) {
        return `${formatScientific(value, 2)} T*m`;
    }

    function signedCurrent() {
        return state.controls.current * state.controls.direction;
    }

    function getConfigMeta(configKey) {
        switch (configKey) {
            case 'inside-wire':
                return {
                    label: 'Lazo interno',
                    button: state.simulationActive ? 'Pausar' : 'Simular',
                    status: state.simulationActive ? 'Integral interna' : 'Detenida'
                };
            case 'reverse-current':
                return {
                    label: 'Corriente invertida',
                    button: state.simulationActive ? 'Pausar' : 'Simular',
                    status: state.simulationActive ? 'Sentido invertido' : 'Detenida'
                };
            default:
                return {
                    label: 'Lazo exterior',
                    button: state.simulationActive ? 'Pausar' : 'Simular',
                    status: state.simulationActive ? 'Recorrido activo' : 'Detenida'
                };
        }
    }

    function syncInputsFromControls() {
        if (state.dom.inputCurrent) state.dom.inputCurrent.value = String(state.controls.current);
        if (state.dom.inputWireRadius) state.dom.inputWireRadius.value = String(state.controls.wireRadius);
        if (state.dom.inputLoopRadius) state.dom.inputLoopRadius.value = String(state.controls.loopRadius);
        if (state.dom.inputSamples) state.dom.inputSamples.value = String(state.controls.samples);
        if (state.dom.inputConfig) state.dom.inputConfig.value = state.controls.configuration;
    }

    function updateScenarioUi() {
        const meta = getConfigMeta(state.controls.configuration);
        if (state.dom.configLabel) state.dom.configLabel.textContent = meta.label;
        if (state.dom.simStatus) state.dom.simStatus.textContent = meta.status;
        if (state.dom.simulateBtn) state.dom.simulateBtn.textContent = meta.button;
        syncInputsFromControls();
    }

    function make2DContext(canvas, fallbackHeight) {
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height || fallbackHeight));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.max(1, Math.round(width * dpr));
        const pixelHeight = Math.max(1, Math.round(height * dpr));

        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, width, height };
    }

    function computeEnclosedCurrent(loopRadius, wireRadius, current) {
        if (loopRadius >= wireRadius) return current;
        return current * (loopRadius * loopRadius) / (wireRadius * wireRadius);
    }

    function computeFieldOnLoop(loopRadius, wireRadius, currentMagnitude) {
        if (loopRadius >= wireRadius) {
            return (MU0 * currentMagnitude) / (2 * Math.PI * loopRadius);
        }
        return (MU0 * currentMagnitude * loopRadius) / (2 * Math.PI * wireRadius * wireRadius);
    }

    function applyConfigurationPreset(configKey) {
        state.controls.configuration = configKey;
        if (configKey === 'inside-wire') {
            state.controls.current = 18;
            state.controls.direction = 1;
            state.controls.wireRadius = 0.9;
            state.controls.loopRadius = 0.42;
            state.controls.samples = 24;
        } else if (configKey === 'reverse-current') {
            state.controls.current = 18;
            state.controls.direction = -1;
            state.controls.wireRadius = 0.55;
            state.controls.loopRadius = 1.6;
            state.controls.samples = 20;
        } else {
            state.controls.current = 18;
            state.controls.direction = 1;
            state.controls.wireRadius = 0.55;
            state.controls.loopRadius = 1.6;
            state.controls.samples = 20;
        }
        state.phase = 0;
        syncInputsFromControls();
        updateControlLabels();
        updateScenarioUi();
    }

    function updateControlLabels() {
        if (state.dom.valCurrent) state.dom.valCurrent.textContent = `${formatFixed(state.controls.current, 1)} A`;
        if (state.dom.valWireRadius) state.dom.valWireRadius.textContent = `${formatFixed(state.controls.wireRadius, 2)} m`;
        if (state.dom.valLoopRadius) state.dom.valLoopRadius.textContent = `${formatFixed(state.controls.loopRadius, 2)} m`;
        if (state.dom.valSamples) state.dom.valSamples.textContent = `${Math.round(state.controls.samples)}`;
        if (state.dom.directionLabel) {
            state.dom.directionLabel.textContent = state.controls.direction > 0 ? 'Hacia arriba' : 'Hacia abajo';
        }
    }

    function renderEquation() {
        const eqEl = state.dom.equation;
        if (!eqEl) return;
        const tex = '\\oint_C \\vec{B}\\cdot d\\vec{l} = \\mu_0 I_{enc}';
        if (window.katex && typeof window.katex.render === 'function') {
            window.katex.render(tex, eqEl, { throwOnError: false, displayMode: true });
        } else {
            eqEl.textContent = 'oint_C B.dl = mu_0 I_enc';
        }
    }

    function updateMetricsDisplay() {
        const m = state.metrics;
        const progressPercent = Math.round(state.phase * 100);

        if (state.dom.metricField) state.dom.metricField.textContent = formatMicroTesla(m.fieldOnLoop);
        if (state.dom.metricIenc) state.dom.metricIenc.textContent = `${formatFixed(m.enclosedCurrent, 2)} A`;
        if (state.dom.metricCirculation) state.dom.metricCirculation.textContent = formatTeslaMeter(m.circulation);
        if (state.dom.metricMu0I) state.dom.metricMu0I.textContent = formatTeslaMeter(m.mu0I);
        if (state.dom.metricProgress) state.dom.metricProgress.textContent = `${progressPercent}%`;
        if (state.dom.metricRegion) state.dom.metricRegion.textContent = m.region;

        if (state.dom.liveEquation) {
            const r = state.controls.loopRadius;
            const a = state.controls.wireRadius;
            const current = signedCurrent();
            if (r >= a) {
                state.dom.liveEquation.textContent =
                    `Fuera del conductor: B = mu_0 I / (2 pi r), entonces ∮B·dl = B(2 pi r) = mu_0 I = ${formatScientific(m.mu0I, 2)} T*m`;
            } else {
                state.dom.liveEquation.textContent =
                    `Dentro del conductor: I_enc = I (r^2 / a^2) = ${formatFixed(current, 2)} * (${formatFixed(r, 2)}^2/${formatFixed(a, 2)}^2), y ∮B·dl = mu_0 I_enc`;
            }
        }
    }

    function updateCamera() {
        const camera = state.three.camera;
        const controls = state.three.controls;
        if (!camera || !controls.target) return;

        camera.position.set(
            controls.target.x + controls.radius * Math.sin(controls.polar) * Math.cos(controls.azimuth),
            controls.target.y + controls.radius * Math.cos(controls.polar),
            controls.target.z + controls.radius * Math.sin(controls.polar) * Math.sin(controls.azimuth)
        );
        camera.lookAt(controls.target);
    }

    function resizeThree() {
        const renderer = state.three.renderer;
        const camera = state.three.camera;
        const host = state.dom.host;
        if (!renderer || !camera || !host) return;

        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight || 360);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        updateCamera();
    }

    function isHostVisible() {
        const host = state.dom.host;
        return !!(host && host.isConnected && host.offsetParent !== null);
    }

    function attachPointerControls() {
        const host = state.dom.host;
        if (!host || host.dataset.ampereBound === 'true') return;
        host.dataset.ampereBound = 'true';

        host.addEventListener('pointerdown', (event) => {
            state.three.controls.dragging = true;
            state.three.controls.lastX = event.clientX;
            state.three.controls.lastY = event.clientY;
            if (host.setPointerCapture) host.setPointerCapture(event.pointerId);
        });

        host.addEventListener('pointermove', (event) => {
            if (!state.three.controls.dragging) return;
            const dx = event.clientX - state.three.controls.lastX;
            const dy = event.clientY - state.three.controls.lastY;
            state.three.controls.lastX = event.clientX;
            state.three.controls.lastY = event.clientY;
            state.three.controls.azimuth -= dx * 0.01;
            state.three.controls.polar = clamp(state.three.controls.polar + dy * 0.008, 0.45, 1.55);
            updateCamera();
        });

        const release = () => {
            state.three.controls.dragging = false;
        };

        host.addEventListener('pointerup', release);
        host.addEventListener('pointerleave', release);
        host.addEventListener('pointercancel', release);
        host.addEventListener('wheel', (event) => {
            event.preventDefault();
            state.three.controls.radius = clamp(state.three.controls.radius + event.deltaY * 0.004, 5.6, 12.5);
            updateCamera();
        }, { passive: false });
    }

    function createCircleLine(radius, color, opacity) {
        const THREE = window.THREE;
        const points = [];
        for (let i = 0; i <= 120; i++) {
            const angle = (i / 120) * Math.PI * 2;
            points.push(new THREE.Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle)));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({ color, transparent: true, opacity })
        );
    }

    function rebuildFieldArrows() {
        const THREE = window.THREE;
        if (!THREE || !state.three.fieldArrowGroup) return;
        state.three.fieldArrowGroup.clear();

        for (let i = 0; i < state.controls.samples; i++) {
            const arrow = new THREE.ArrowHelper(
                new THREE.Vector3(1, 0, 0),
                new THREE.Vector3(0, 0, 0),
                0.8,
                0xf59e0b,
                0.16,
                0.08
            );
            arrow.line.material.transparent = true;
            arrow.cone.material.transparent = true;
            state.three.fieldArrowGroup.add(arrow);
        }
    }

    function buildSceneObjects() {
        const THREE = window.THREE;
        const scene = state.three.scene;

        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(5.2, 64),
            new THREE.MeshBasicMaterial({ color: 0x06131f, transparent: true, opacity: 0.75 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -2.05;
        scene.add(floor);

        const grid = new THREE.GridHelper(8, 16, 0x154360, 0x0b2235);
        grid.position.y = -2.03;
        grid.material.transparent = true;
        grid.material.opacity = 0.35;
        scene.add(grid);

        const axes = new THREE.AxesHelper(2.2);
        axes.material.transparent = true;
        axes.material.opacity = 0.55;
        scene.add(axes);

        const wireShell = new THREE.Mesh(
            new THREE.CylinderGeometry(0.55, 0.55, 4.2, 40, 1, true),
            new THREE.MeshPhysicalMaterial({
                color: 0x60a5fa,
                transparent: true,
                opacity: 0.12,
                roughness: 0.16,
                metalness: 0.08,
                transmission: 0.1
            })
        );
        scene.add(wireShell);
        state.three.wireShell = wireShell;

        const wireCore = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 4.6, 28),
            new THREE.MeshStandardMaterial({
                color: 0xe5e7eb,
                metalness: 0.72,
                roughness: 0.2,
                emissive: 0x0f172a,
                emissiveIntensity: 0.18
            })
        );
        scene.add(wireCore);
        state.three.wireCore = wireCore;

        const currentPulseGroup = new THREE.Group();
        scene.add(currentPulseGroup);
        state.three.currentPulseGroup = currentPulseGroup;
        for (let i = 0; i < 4; i++) {
            const pulse = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.75 })
            );
            currentPulseGroup.add(pulse);
        }

        const referenceRingGroup = new THREE.Group();
        scene.add(referenceRingGroup);
        state.three.referenceRingGroup = referenceRingGroup;
        referenceRingGroup.add(createCircleLine(0.9, 0x1d4ed8, 0.18));
        referenceRingGroup.add(createCircleLine(1.45, 0x38bdf8, 0.18));
        referenceRingGroup.add(createCircleLine(2.1, 0x0ea5e9, 0.14));

        const ampereLoop = createCircleLine(1, 0xf59e0b, 0.95);
        scene.add(ampereLoop);
        state.three.ampereLoop = ampereLoop;

        const traceGeometry = new THREE.BufferGeometry();
        traceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(123 * 3), 3));
        const ampereLoopTrace = new THREE.Line(
            traceGeometry,
            new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.95 })
        );
        scene.add(ampereLoopTrace);
        state.three.ampereLoopTrace = ampereLoopTrace;

        const tracer = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 18, 18),
            new THREE.MeshBasicMaterial({ color: 0x34d399 })
        );
        scene.add(tracer);
        state.three.tracer = tracer;

        const fieldArrowGroup = new THREE.Group();
        scene.add(fieldArrowGroup);
        state.three.fieldArrowGroup = fieldArrowGroup;
        rebuildFieldArrows();
    }

    function ensureThree() {
        if (!window.THREE) return false;
        const host = state.dom.host;
        if (!host) return false;
        const THREE = window.THREE;

        if (!state.three.renderer) {
            state.three.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            if (state.three.renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
                state.three.renderer.outputColorSpace = THREE.SRGBColorSpace;
            }

            state.three.scene = new THREE.Scene();
            state.three.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
            state.three.controls.target = new THREE.Vector3(0, 0, 0);

            const ambient = new THREE.HemisphereLight(0xa7e6ff, 0x020916, 1.3);
            state.three.scene.add(ambient);

            const key = new THREE.DirectionalLight(0xffffff, 1.15);
            key.position.set(4.2, 5.8, 4.5);
            state.three.scene.add(key);

            const fill = new THREE.PointLight(0x38bdf8, 1.1, 18, 2);
            fill.position.set(-3, 0.5, -2.4);
            state.three.scene.add(fill);

            buildSceneObjects();
            attachPointerControls();
        }

        if (state.three.renderer.domElement.parentElement !== host) {
            host.innerHTML = '';
            host.appendChild(state.three.renderer.domElement);
        }

        resizeThree();
        updateCamera();
        return true;
    }

    function recomputeMetrics() {
        const currentSigned = signedCurrent();
        const currentMagnitude = Math.abs(currentSigned);
        const loopRadius = state.controls.loopRadius;
        const wireRadius = state.controls.wireRadius;
        const enclosedCurrentMag = computeEnclosedCurrent(loopRadius, wireRadius, currentMagnitude);
        const enclosedCurrent = enclosedCurrentMag * Math.sign(currentSigned || 1);
        const fieldOnLoop = computeFieldOnLoop(loopRadius, wireRadius, currentMagnitude);
        const circulation = MU0 * enclosedCurrent;
        const mu0I = MU0 * enclosedCurrent;

        state.metrics.fieldOnLoop = fieldOnLoop;
        state.metrics.enclosedCurrent = enclosedCurrent;
        state.metrics.circulation = circulation;
        state.metrics.mu0I = mu0I;
        state.metrics.region = loopRadius >= wireRadius ? 'Fuera del conductor' : 'Dentro del conductor';
    }

    function updateLoopTrace() {
        const THREE = window.THREE;
        const line = state.three.ampereLoopTrace;
        const tracer = state.three.tracer;
        if (!line || !tracer || !THREE) return;

        const radius = state.controls.loopRadius;
        const segments = 120;
        const count = Math.max(2, Math.floor(state.phase * segments) + 1);
        const positions = line.geometry.attributes.position.array;

        for (let i = 0; i <= segments; i++) {
            const angle = (Math.min(i, count - 1) / segments) * Math.PI * 2;
            const x = radius * Math.cos(angle);
            const z = radius * Math.sin(angle);
            positions[i * 3] = x;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = z;
        }
        line.geometry.setDrawRange(0, count);
        line.geometry.attributes.position.needsUpdate = true;

        const tracerAngle = state.phase * Math.PI * 2;
        tracer.position.set(radius * Math.cos(tracerAngle), 0, radius * Math.sin(tracerAngle));
    }

    function updateSceneFromState() {
        if (!ensureThree()) return;
        const THREE = window.THREE;
        const currentSign = Math.sign(signedCurrent() || 1);
        const loopRadius = state.controls.loopRadius;
        const wireRadius = state.controls.wireRadius;
        const fieldMagnitude = state.metrics.fieldOnLoop;

        if (state.three.wireShell) {
            state.three.wireShell.scale.set(wireRadius / 0.55, 1, wireRadius / 0.55);
        }
        if (state.three.wireCore) {
            state.three.wireCore.material.color.setHex(currentSign > 0 ? 0xf8fafc : 0xfca5a5);
        }
        if (state.three.ampereLoop) {
            state.three.ampereLoop.scale.setScalar(loopRadius);
        }

        state.three.referenceRingGroup.children.forEach((ring, index) => {
            const base = 0.9 + index * 0.55;
            ring.visible = Math.abs(base - loopRadius) > 0.12;
        });

        if (state.three.fieldArrowGroup.children.length !== state.controls.samples) {
            rebuildFieldArrows();
        }

        const arrowLength = 0.35 + clamp(fieldMagnitude / 6e-6, 0, 1) * 0.9;
        for (let i = 0; i < state.controls.samples; i++) {
            const angle = (i / state.controls.samples) * Math.PI * 2;
            const x = loopRadius * Math.cos(angle);
            const z = loopRadius * Math.sin(angle);
            const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(currentSign);
            const arrow = state.three.fieldArrowGroup.children[i];
            arrow.position.set(x, 0, z);
            arrow.setDirection(tangent);
            arrow.setLength(arrowLength, 0.16, 0.08);
            const intensity = clamp(fieldMagnitude / 8e-6, 0.15, 1);
            const color = currentSign > 0 ? 0xf59e0b : 0x38bdf8;
            arrow.line.material.color.setHex(color);
            arrow.cone.material.color.setHex(color);
            arrow.line.material.opacity = 0.35 + 0.45 * intensity;
            arrow.cone.material.opacity = 0.35 + 0.45 * intensity;
        }

        updateLoopTrace();
        state.graphDirty = true;
        state.needsUpdate = false;
        updateMetricsDisplay();
    }

    function animateCurrentPulses(timestamp) {
        const group = state.three.currentPulseGroup;
        if (!group) return;
        const time = timestamp * 0.001;
        const direction = state.controls.direction;
        group.children.forEach((pulse, index) => {
            const phase = (time * 0.7 + index / group.children.length) % 1;
            const offset = direction > 0 ? phase : 1 - phase;
            pulse.position.set(0, -1.7 + offset * 3.4, 0);
            pulse.material.opacity = 0.28 + 0.5 * Math.sin((phase + index * 0.08) * Math.PI);
        });
    }

    function setCurrentPulsesIdle() {
        const group = state.three.currentPulseGroup;
        if (!group) return;
        group.children.forEach((pulse, index) => {
            pulse.position.set(0, -1.35 + index * 0.9, 0);
            pulse.material.opacity = 0.34;
        });
    }

    function drawGraph() {
        const setup = make2DContext(state.dom.graphCanvas, 280);
        if (!setup) return;
        const { ctx, width, height } = setup;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#01050d';
        ctx.fillRect(0, 0, width, height);

        const left = 58;
        const right = 18;
        const top = 18;
        const bottom = 28;
        const gap = 18;
        const graphWidth = width - left - right;
        const blockHeight = (height - top - bottom - gap) / 2;
        const topBox = { x: left, y: top, w: graphWidth, h: blockHeight };
        const bottomBox = { x: left, y: top + blockHeight + gap, w: graphWidth, h: blockHeight };

        const radiusMax = 2.6;
        const steps = 64;
        const currentMagnitude = state.controls.current;
        const wireRadius = state.controls.wireRadius;
        const currentLoopRadius = state.controls.loopRadius;
        const fullCirculation = state.metrics.circulation;

        const bSeries = [];
        for (let i = 0; i < steps; i++) {
            const r = 0.05 + (radiusMax - 0.05) * (i / (steps - 1));
            bSeries.push(computeFieldOnLoop(r, wireRadius, currentMagnitude));
        }
        const maxField = Math.max(1e-8, ...bSeries);

        function drawGrid(box, centered) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = box.y + (box.h * i) / 4;
                ctx.beginPath();
                ctx.moveTo(box.x, y);
                ctx.lineTo(box.x + box.w, y);
                ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.strokeRect(box.x, box.y, box.w, box.h);
            if (centered) {
                const midY = box.y + box.h / 2;
                ctx.setLineDash([5, 4]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
                ctx.beginPath();
                ctx.moveTo(box.x, midY);
                ctx.lineTo(box.x + box.w, midY);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        drawGrid(topBox, false);
        drawGrid(bottomBox, true);

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        bSeries.forEach((value, index) => {
            const x = topBox.x + (index / (steps - 1)) * topBox.w;
            const y = topBox.y + topBox.h - (value / maxField) * topBox.h;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        const markerX = topBox.x + ((currentLoopRadius - 0.05) / (radiusMax - 0.05)) * topBox.w;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.moveTo(markerX, topBox.y);
        ctx.lineTo(markerX, bottomBox.y + bottomBox.h);
        ctx.stroke();

        const thetaSteps = 60;
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= thetaSteps; i++) {
            const t = i / thetaSteps;
            const x = bottomBox.x + t * bottomBox.w;
            const y = bottomBox.y + bottomBox.h / 2 - ((fullCirculation * t) / Math.max(Math.abs(fullCirculation), 1e-12)) * (bottomBox.h / 2 - 6);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#f59e0b';
        ctx.beginPath();
        const targetY = bottomBox.y + bottomBox.h / 2 - (fullCirculation / Math.max(Math.abs(fullCirculation), 1e-12)) * (bottomBox.h / 2 - 6);
        ctx.moveTo(bottomBox.x, targetY);
        ctx.lineTo(bottomBox.x + bottomBox.w, targetY);
        ctx.stroke();
        ctx.setLineDash([]);

        const progressX = bottomBox.x + state.phase * bottomBox.w;
        const partialCirculation = fullCirculation * state.phase;
        const progressY = bottomBox.y + bottomBox.h / 2 - (partialCirculation / Math.max(Math.abs(fullCirculation), 1e-12)) * (bottomBox.h / 2 - 6);
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(progressX, progressY, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(229, 237, 246, 0.9)';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText('B(r): crece dentro y decrece fuera del conductor', topBox.x, topBox.y - 6);
        ctx.fillText('Acumulacion parcial de ∮B·dl', bottomBox.x, bottomBox.y - 6);
        ctx.fillText(formatScientific(maxField * 1e6, 1) + ' uT', 4, topBox.y + 8);
        ctx.fillText('0', 34, topBox.y + topBox.h);
        ctx.fillText('0', 34, bottomBox.y + bottomBox.h / 2 + 4);
        ctx.fillText('r (m)', width - 46, height - 8);
        ctx.fillText(currentLoopRadius.toFixed(2), markerX - 12, height - 8);

        ctx.strokeStyle = 'rgba(239, 68, 68, 0.38)';
        ctx.beginPath();
        ctx.moveTo(topBox.x + ((wireRadius - 0.05) / (radiusMax - 0.05)) * topBox.w, topBox.y);
        ctx.lineTo(topBox.x + ((wireRadius - 0.05) / (radiusMax - 0.05)) * topBox.w, topBox.y + topBox.h);
        ctx.stroke();

        ctx.fillText('a', topBox.x + ((wireRadius - 0.05) / (radiusMax - 0.05)) * topBox.w - 4, topBox.y + 12);

        state.graphDirty = false;
    }

    function tick(timestamp) {
        if (!state.running) return;
        if (!state.lastTs) state.lastTs = timestamp;
        const dt = Math.min((timestamp - state.lastTs) / 1000, 0.05);
        state.lastTs = timestamp;

        if (state.simulationActive) {
            state.phase = (state.phase + dt * 0.2) % 1;
            state.graphDirty = true;
        }
        if (state.needsUpdate) {
            recomputeMetrics();
            updateSceneFromState();
            state.graphDirty = true;
        } else if (state.simulationActive) {
            updateLoopTrace();
            updateMetricsDisplay();
            state.graphDirty = true;
        }

        if (state.simulationActive) animateCurrentPulses(timestamp);
        else setCurrentPulsesIdle();
        if (state.graphDirty && (!state.lastGraphDraw || (timestamp - state.lastGraphDraw) >= GRAPH_FRAME_MS)) {
            drawGraph();
            state.lastGraphDraw = timestamp;
        }
        if (isHostVisible() && state.three.renderer && state.three.scene && state.three.camera) {
            state.three.renderer.render(state.three.scene, state.three.camera);
        }

        state.rafId = requestAnimationFrame(tick);
    }

    function bindControl(input, handler) {
        if (!input) return;
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    }

    function bindUI() {
        state.dom.host = document.getElementById('ampere-law-canvas');
        state.dom.graphCanvas = document.getElementById('ampere-graph-canvas');
        state.dom.inputConfig = document.getElementById('ampere-config');
        state.dom.configLabel = document.getElementById('ampere-config-label');
        state.dom.simulateBtn = document.getElementById('ampere-simulate-btn');
        state.dom.simStatus = document.getElementById('ampere-sim-status');
        state.dom.inputCurrent = document.getElementById('ampere-current');
        state.dom.inputWireRadius = document.getElementById('ampere-wire-radius');
        state.dom.inputLoopRadius = document.getElementById('ampere-loop-radius');
        state.dom.inputSamples = document.getElementById('ampere-samples');
        state.dom.directionBtn = document.getElementById('ampere-direction-btn');
        state.dom.directionLabel = document.getElementById('ampere-direction-label');
        state.dom.valCurrent = document.getElementById('ampere-current-val');
        state.dom.valWireRadius = document.getElementById('ampere-wire-radius-val');
        state.dom.valLoopRadius = document.getElementById('ampere-loop-radius-val');
        state.dom.valSamples = document.getElementById('ampere-samples-val');
        state.dom.metricField = document.getElementById('ampere-metric-field');
        state.dom.metricIenc = document.getElementById('ampere-metric-ienc');
        state.dom.metricCirculation = document.getElementById('ampere-metric-circulation');
        state.dom.metricMu0I = document.getElementById('ampere-metric-mu0i');
        state.dom.metricProgress = document.getElementById('ampere-metric-progress');
        state.dom.metricRegion = document.getElementById('ampere-metric-region');
        state.dom.equation = document.getElementById('ampere-equation');
        state.dom.liveEquation = document.getElementById('ampere-live-equation');

        bindControl(state.dom.inputCurrent, () => {
            state.controls.current = parseFloat(state.dom.inputCurrent.value) || 18;
            state.needsUpdate = true;
            state.graphDirty = true;
            updateControlLabels();
        });
        bindControl(state.dom.inputWireRadius, () => {
            state.controls.wireRadius = parseFloat(state.dom.inputWireRadius.value) || 0.55;
            state.controls.loopRadius = Math.max(state.controls.loopRadius, 0.15);
            state.needsUpdate = true;
            state.graphDirty = true;
            updateControlLabels();
        });
        bindControl(state.dom.inputLoopRadius, () => {
            state.controls.loopRadius = parseFloat(state.dom.inputLoopRadius.value) || 1.6;
            state.needsUpdate = true;
            state.graphDirty = true;
            updateControlLabels();
        });
        bindControl(state.dom.inputSamples, () => {
            state.controls.samples = Math.round(parseFloat(state.dom.inputSamples.value) || 20);
            rebuildFieldArrows();
            state.needsUpdate = true;
            state.graphDirty = true;
            updateControlLabels();
            updateScenarioUi();
        });

        if (state.dom.inputConfig && !state.dom.inputConfig.dataset.bound) {
            state.dom.inputConfig.dataset.bound = 'true';
            state.dom.inputConfig.addEventListener('change', () => {
                applyConfigurationPreset(state.dom.inputConfig.value || 'outer-loop');
                state.needsUpdate = true;
                state.graphDirty = true;
            });
        }

        if (state.dom.directionBtn && !state.dom.directionBtn.dataset.bound) {
            state.dom.directionBtn.dataset.bound = 'true';
            state.dom.directionBtn.addEventListener('click', () => {
                state.controls.direction *= -1;
                state.controls.configuration = 'reverse-current';
                state.needsUpdate = true;
                updateControlLabels();
                updateScenarioUi();
            });
        }

        if (state.dom.simulateBtn && !state.dom.simulateBtn.dataset.bound) {
            state.dom.simulateBtn.dataset.bound = 'true';
            state.dom.simulateBtn.addEventListener('click', () => {
                state.simulationActive = !state.simulationActive;
                updateScenarioUi();
            });
        }

        if (!window.__ampereLawResizeBound) {
            window.addEventListener('resize', () => {
                resizeThree();
                state.graphDirty = true;
                state.needsUpdate = true;
            });
            window.__ampereLawResizeBound = true;
        }

        updateControlLabels();
        updateScenarioUi();
        renderEquation();
    }

    function init() {
        if (!state.initialized) {
            bindUI();
            state.initialized = true;
        } else {
            state.dom.host = document.getElementById('ampere-law-canvas');
            state.dom.graphCanvas = document.getElementById('ampere-graph-canvas');
        }

        updateControlLabels();
        updateScenarioUi();
        renderEquation();
        state.needsUpdate = true;
        state.graphDirty = true;
        state.phase = 0;
        recomputeMetrics();
        updateSceneFromState();
        setCurrentPulsesIdle();
        drawGraph();

        if (state.running) return;
        state.running = true;
        state.lastTs = 0;
        state.lastGraphDraw = 0;
        state.rafId = requestAnimationFrame(tick);
    }

    function stop() {
        state.running = false;
        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        state.lastTs = 0;
        state.lastGraphDraw = 0;
    }

    window.initAmpereLaw3D = init;
    window.stopAmpereLaw3D = stop;
})();

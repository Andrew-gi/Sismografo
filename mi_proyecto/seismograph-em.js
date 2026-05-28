(function () {
    const state = {
        initialized: false,
        running: false,
        rafId: 0,
        lastTs: 0,
        lastGraphPaint: 0,
        lastMetricPaint: 0,
        graphDirty: true,
        t: 0,
        frameX: 0,
        frameV: 0,
        massX: 0,
        massV: 0,
        fluxPrev: 0,
        emf: 0,
        electricField: 0,
        relativeVelocity: 0,
        flux: 0,
        history: [],
        controls: {
            bField: 0.65,
            speed: 1.2,
            turns: 800,
            coilLength: 0.06
        },
        constants: {
            mass: 1.4,
            stiffness: 18,
            zeta: 0.16,
            worldToMeter: 0.018,
            baseGap: 0.045,
            coilArea: 0.0085,
            baseFrequency: 1.08,
            groundAmplitude: 0.72
        },
        dom: {
            modelHost: null,
            graphCanvas: null,
            inputB: null,
            inputSpeed: null,
            inputTurns: null,
            inputLength: null,
            valB: null,
            valSpeed: null,
            valTurns: null,
            valLength: null,
            metricVoltage: null,
            metricElectric: null,
            metricFlux: null,
            metricVelocity: null,
            equation: null,
            liveEquation: null
        },
        three: {
            renderer: null,
            scene: null,
            camera: null,
            frameGroup: null,
            massGroup: null,
            springLine: null,
            coilMesh: null,
            coilCore: null,
            fieldLines: [],
            electricArrows: [],
            pointerLight: null,
            controls: {
                radius: 8.8,
                azimuth: -0.75,
                polar: 1.05,
                dragging: false,
                lastX: 0,
                lastY: 0,
                target: null
            }
        }
    };

    const MAX_RENDER_DPR = 1.35;
    const GRAPH_FRAME_MS = 90;
    const METRIC_FRAME_MS = 70;

    function make2DContext(canvas, fallbackHeight) {
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height || fallbackHeight));
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
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

    function updateControlLabels() {
        const { controls, dom } = state;
        if (dom.valB) dom.valB.textContent = `${controls.bField.toFixed(2)} T`;
        if (dom.valSpeed) dom.valSpeed.textContent = `${controls.speed.toFixed(2)}x`;
        if (dom.valTurns) dom.valTurns.textContent = `${Math.round(controls.turns)}`;
        if (dom.valLength) dom.valLength.textContent = `${controls.coilLength.toFixed(3)} m`;
    }

    function renderEquation() {
        const eqEl = state.dom.equation;
        if (!eqEl) return;
        const tex = '\\varepsilon(t) = -N\\frac{d\\Phi_B}{dt} \\approx N\\,B\\,L\\,v_{rel}(t)';

        if (window.katex && typeof window.katex.render === 'function') {
            window.katex.render(tex, eqEl, { throwOnError: false, displayMode: true });
        } else {
            eqEl.textContent = 'e(t) = -N dPhiB/dt ~= N B L v_rel(t)';
        }
    }

    function updateMetrics() {
        const { dom, controls, emf, electricField, flux, relativeVelocity } = state;
        if (dom.metricVoltage) dom.metricVoltage.textContent = `${emf.toFixed(3)} V`;
        if (dom.metricElectric) dom.metricElectric.textContent = `${Math.abs(electricField).toFixed(1)} V/m`;
        if (dom.metricFlux) dom.metricFlux.textContent = `${(flux * 1000).toFixed(3)} mWb`;
        if (dom.metricVelocity) dom.metricVelocity.textContent = `${relativeVelocity.toFixed(3)} m/s`;

        if (dom.liveEquation) {
            const estimate = controls.turns * controls.bField * controls.coilLength * relativeVelocity;
            dom.liveEquation.textContent =
                `e(t) = N*B*L*v_rel = ${Math.round(controls.turns)} * ${controls.bField.toFixed(2)} * ` +
                `${controls.coilLength.toFixed(3)} * ${relativeVelocity.toFixed(3)} = ${estimate.toFixed(3)} V`;
        }
    }

    function resetState() {
        state.t = 0;
        state.frameX = 0;
        state.frameV = 0;
        state.massX = 0;
        state.massV = 0;
        state.emf = 0;
        state.electricField = 0;
        state.relativeVelocity = 0;
        state.flux = state.controls.bField * state.constants.coilArea;
        state.fluxPrev = state.flux;
        state.history = [];
    }

    function stepModel(dt) {
        const c = state.constants;
        const omega = 2 * Math.PI * c.baseFrequency * state.controls.speed;

        state.t += dt;
        state.frameX = c.groundAmplitude * Math.sin(omega * state.t);
        state.frameV = c.groundAmplitude * omega * Math.cos(omega * state.t);

        const damping = 2 * c.zeta * Math.sqrt(c.stiffness * c.mass);
        const relX = state.massX - state.frameX;
        const relV = state.massV - state.frameV;
        const massAcc = (-c.stiffness * relX - damping * relV) / c.mass;

        state.massV += massAcc * dt;
        state.massX += state.massV * dt;

        const relVelocityWorld = state.frameV - state.massV;
        const relVelocityMS = relVelocityWorld * c.worldToMeter;
        const gap = Math.max(0.008, c.baseGap + Math.abs(state.frameX - state.massX) * c.worldToMeter);
        const effectiveField = state.controls.bField / (1 + Math.pow(gap / c.baseGap, 2));
        const flux = effectiveField * c.coilArea;
        const emf = -state.controls.turns * ((flux - state.fluxPrev) / Math.max(dt, 1e-4));

        state.fluxPrev = flux;
        state.flux = flux;
        state.emf = Math.max(-24, Math.min(24, emf));
        state.electricField = state.emf / Math.max(state.controls.coilLength, 0.01);
        state.relativeVelocity = relVelocityMS;

        state.history.push(state.emf);
        if (state.history.length > 560) state.history.shift();
    }

    function updateCamera() {
        const three = state.three;
        if (!three.camera || !three.controls.target) return;

        const radius = three.controls.radius;
        const azimuth = three.controls.azimuth;
        const polar = three.controls.polar;
        const target = three.controls.target;

        three.camera.position.set(
            target.x + radius * Math.sin(polar) * Math.cos(azimuth),
            target.y + radius * Math.cos(polar),
            target.z + radius * Math.sin(polar) * Math.sin(azimuth)
        );
        three.camera.lookAt(target);
    }

    function resizeThree() {
        const { renderer, camera } = state.three;
        const host = state.dom.modelHost;
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
        const host = state.dom.modelHost;
        return !!(host && host.isConnected && host.offsetParent !== null);
    }

    function attachPointerControls() {
        const host = state.dom.modelHost;
        if (!host || host.dataset.em3dBound === 'true') return;
        host.dataset.em3dBound = 'true';

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
            state.three.controls.polar = Math.max(0.45, Math.min(1.6, state.three.controls.polar + dy * 0.008));
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
            state.three.controls.radius = Math.max(6.4, Math.min(12, state.three.controls.radius + event.deltaY * 0.004));
            updateCamera();
        }, { passive: false });
    }

    function createHelixCurve(THREE) {
        class HelixCurve extends THREE.Curve {
            getPoint(t, target = new THREE.Vector3()) {
                const angle = 12 * Math.PI * 2 * t;
                return target.set(
                    -0.95 + 1.9 * t,
                    -0.12 + 0.35 * Math.cos(angle),
                    0.35 * Math.sin(angle)
                );
            }
        }

        return new HelixCurve();
    }

    function createFieldLoop(THREE, radiusY, radiusZ, color) {
        const points = [];
        for (let i = 0; i <= 120; i++) {
            const angle = (i / 120) * Math.PI * 2;
            points.push(new THREE.Vector3(0, radiusY * Math.cos(angle), radiusZ * Math.sin(angle)));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.LineLoop(
            geometry,
            new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.22
            })
        );
    }

    function createArrowSet(THREE, parent) {
        const offsets = [
            new THREE.Vector3(-0.6, 0.52, 0),
            new THREE.Vector3(0, 0.7, 0),
            new THREE.Vector3(0.6, 0.52, 0),
            new THREE.Vector3(-0.6, -0.78, 0),
            new THREE.Vector3(0, -0.95, 0),
            new THREE.Vector3(0.6, -0.78, 0)
        ];

        state.three.electricArrows = offsets.map((offset) => {
            const arrow = new THREE.ArrowHelper(
                new THREE.Vector3(1, 0, 0),
                offset,
                0.65,
                0x34d399,
                0.18,
                0.1
            );
            parent.add(arrow);
            return arrow;
        });
    }

    function buildSceneObjects() {
        const THREE = window.THREE;
        const scene = state.three.scene;

        const frameGroup = new THREE.Group();
        const massGroup = new THREE.Group();
        scene.add(frameGroup);
        scene.add(massGroup);
        state.three.frameGroup = frameGroup;
        state.three.massGroup = massGroup;

        const metal = new THREE.MeshStandardMaterial({
            color: 0xb5c8da,
            metalness: 0.78,
            roughness: 0.26
        });

        const cyanGlass = new THREE.MeshPhysicalMaterial({
            color: 0x74d8ff,
            transparent: true,
            opacity: 0.11,
            roughness: 0.08,
            metalness: 0.1,
            transmission: 0.18
        });

        const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.24, 2.9), metal);
        base.position.y = -1.35;
        base.castShadow = true;
        base.receiveShadow = true;
        frameGroup.add(base);

        const housing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3.1, 2.4), cyanGlass);
        housing.position.y = 0.02;
        housing.receiveShadow = true;
        frameGroup.add(housing);

        const housingEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(4.5, 3.1, 2.4)),
            new THREE.LineBasicMaterial({ color: 0x89e8ff, transparent: true, opacity: 0.48 })
        );
        housingEdges.position.copy(housing.position);
        frameGroup.add(housingEdges);

        const postGeometry = new THREE.BoxGeometry(0.14, 2.75, 0.14);
        [-1.9, 1.9].forEach((x) => {
            [-0.95, 0.95].forEach((z) => {
                const post = new THREE.Mesh(postGeometry, metal);
                post.position.set(x, 0.12, z);
                post.castShadow = true;
                frameGroup.add(post);
            });
        });

        const topBeam = new THREE.Mesh(new THREE.BoxGeometry(4.15, 0.16, 2.0), metal);
        topBeam.position.y = 1.48;
        topBeam.castShadow = true;
        frameGroup.add(topBeam);

        const coilCore = new THREE.Mesh(
            new THREE.CylinderGeometry(0.48, 0.48, 2.1, 28, 1, true),
            new THREE.MeshPhysicalMaterial({
                color: 0xffc76d,
                transparent: true,
                opacity: 0.18,
                roughness: 0.15,
                metalness: 0.1,
                transmission: 0.08
            })
        );
        coilCore.rotation.z = Math.PI / 2;
        coilCore.position.y = -0.15;
        frameGroup.add(coilCore);
        state.three.coilCore = coilCore;

        const coilMesh = new THREE.Mesh(
            new THREE.TubeGeometry(createHelixCurve(THREE), 220, 0.05, 10, false),
            new THREE.MeshStandardMaterial({
                color: 0xf59e0b,
                emissive: 0xff7a00,
                emissiveIntensity: 0.9,
                metalness: 0.52,
                roughness: 0.28
            })
        );
        coilMesh.position.y = -0.15;
        coilMesh.castShadow = true;
        frameGroup.add(coilMesh);
        state.three.coilMesh = coilMesh;

        const wireMaterial = new THREE.MeshStandardMaterial({ color: 0xd6f1ff, metalness: 0.65, roughness: 0.22 });
        const wireA = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 12), wireMaterial);
        wireA.rotation.z = Math.PI / 2;
        wireA.position.set(1.9, 0.3, 0.55);
        frameGroup.add(wireA);
        const wireB = wireA.clone();
        wireB.position.z = -0.55;
        frameGroup.add(wireB);

        const massBlock = new THREE.Mesh(
            new THREE.BoxGeometry(1.08, 0.34, 0.96),
            new THREE.MeshStandardMaterial({
                color: 0x5de3ff,
                transparent: true,
                opacity: 0.78,
                metalness: 0.42,
                roughness: 0.22,
                emissive: 0x08374a,
                emissiveIntensity: 0.45
            })
        );
        massBlock.position.y = 1.15;
        massBlock.castShadow = true;
        massGroup.add(massBlock);

        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.12, 16), metal);
        rod.position.y = 0.42;
        rod.castShadow = true;
        massGroup.add(rod);

        const magnetGroup = new THREE.Group();
        magnetGroup.position.y = -0.15;
        massGroup.add(magnetGroup);

        const magnetNorth = new THREE.Mesh(
            new THREE.BoxGeometry(0.46, 0.66, 0.46),
            new THREE.MeshStandardMaterial({ color: 0xff5a5a, metalness: 0.35, roughness: 0.25, emissive: 0x4a0909, emissiveIntensity: 0.38 })
        );
        magnetNorth.position.y = 0.34;
        magnetNorth.castShadow = true;
        magnetGroup.add(magnetNorth);

        const magnetSouth = new THREE.Mesh(
            new THREE.BoxGeometry(0.46, 0.66, 0.46),
            new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.35, roughness: 0.25, emissive: 0x081a4d, emissiveIntensity: 0.38 })
        );
        magnetSouth.position.y = -0.34;
        magnetSouth.castShadow = true;
        magnetGroup.add(magnetSouth);

        const magnetCap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.78, 12), metal);
        magnetCap.rotation.x = Math.PI / 2;
        magnetCap.castShadow = true;
        magnetGroup.add(magnetCap);

        const fieldLines = [
            createFieldLoop(THREE, 0.52, 0.4, 0x49dfff),
            createFieldLoop(THREE, 0.82, 0.62, 0x49dfff),
            createFieldLoop(THREE, 1.12, 0.86, 0x49dfff)
        ];
        fieldLines.forEach((line) => {
            line.rotation.z = Math.PI / 2;
            magnetGroup.add(line);
        });
        state.three.fieldLines = fieldLines;

        const springGeometry = new THREE.BufferGeometry();
        springGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
        const springLine = new THREE.Line(
            springGeometry,
            new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.95 })
        );
        scene.add(springLine);
        state.three.springLine = springLine;

        createArrowSet(THREE, frameGroup);
    }

    function ensureThree() {
        if (!window.THREE) return false;
        const host = state.dom.modelHost;
        if (!host) return false;
        const THREE = window.THREE;

        if (!state.three.renderer) {
            state.three.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            state.three.renderer.shadowMap.enabled = true;
            if (state.three.renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
                state.three.renderer.outputColorSpace = THREE.SRGBColorSpace;
            }
            if (THREE.ACESFilmicToneMapping !== undefined) {
                state.three.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            }
            state.three.scene = new THREE.Scene();
            state.three.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
            state.three.controls.target = new THREE.Vector3(0, 0.35, 0);

            const ambient = new THREE.HemisphereLight(0xa7e6ff, 0x031018, 1.15);
            state.three.scene.add(ambient);

            const key = new THREE.DirectionalLight(0xffffff, 1.35);
            key.position.set(4.5, 5.5, 4.5);
            key.castShadow = true;
            state.three.scene.add(key);

            const fill = new THREE.PointLight(0x00d8ff, 1.55, 16, 2);
            fill.position.set(-2.8, 1.8, 2.4);
            state.three.scene.add(fill);
            state.three.pointerLight = fill;

            const warm = new THREE.PointLight(0xff9d4d, 0.95, 12, 2);
            warm.position.set(2.6, -0.8, -2.1);
            state.three.scene.add(warm);

            const floor = new THREE.Mesh(
                new THREE.PlaneGeometry(14, 14),
                new THREE.MeshStandardMaterial({ color: 0x051723, roughness: 0.97, metalness: 0 })
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = -1.66;
            floor.receiveShadow = true;
            state.three.scene.add(floor);

            const grid = new THREE.GridHelper(12, 24, 0x2dd4ff, 0x123448);
            grid.position.y = -1.65;
            grid.material.transparent = true;
            grid.material.opacity = 0.14;
            state.three.scene.add(grid);

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

    function updateSpringAndScene() {
        const THREE = window.THREE;
        if (!THREE || !state.three.frameGroup || !state.three.massGroup) return;

        const frameX = state.frameX;
        const massX = state.massX;
        state.three.frameGroup.position.x = frameX;
        state.three.frameGroup.rotation.z = frameX * 0.04;
        state.three.massGroup.position.x = massX;
        state.three.massGroup.rotation.z = (massX - frameX) * 0.025;

        if (state.three.pointerLight) {
            state.three.pointerLight.position.x = massX - 1.6;
        }

        if (state.three.coilMesh) {
            state.three.coilMesh.material.emissiveIntensity = 0.85 + Math.min(1.1, Math.abs(state.emf) * 0.03);
        }
        if (state.three.coilCore) {
            state.three.coilCore.material.opacity = 0.12 + Math.min(0.14, Math.abs(state.emf) * 0.008);
        }

        state.three.fieldLines.forEach((line, index) => {
            line.material.opacity = 0.12 + state.controls.bField * 0.14 - index * 0.025;
            line.scale.setScalar(1 + state.controls.bField * 0.12);
        });

        const direction = state.emf >= 0 ? 1 : -1;
        const arrowLength = 0.42 + Math.min(0.95, Math.abs(state.emf) * 0.035);
        state.three.electricArrows.forEach((arrow) => {
            arrow.setDirection(new THREE.Vector3(direction, 0, 0));
            arrow.setLength(arrowLength, 0.18, 0.1);
        });

        if (state.three.springLine) {
            const attr = state.three.springLine.geometry.attributes.position;
            const positions = attr.array;
            const start = new THREE.Vector3(frameX - 1.55, 1.48, 0);
            const end = new THREE.Vector3(massX, 1.15, 0);
            const segments = (positions.length / 3) - 1;

            for (let i = 0; i <= segments; i++) {
                const p = i / segments;
                const x = start.x + (end.x - start.x) * p;
                const y = start.y + (end.y - start.y) * p;
                const z = (i === 0 || i === segments) ? 0 : (i % 2 === 0 ? -0.16 : 0.16);
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
            }

            attr.needsUpdate = true;
            state.three.springLine.geometry.computeBoundingSphere();
        }
    }

    function drawVoltageGraph() {
        const setup = make2DContext(state.dom.graphCanvas, 280);
        if (!setup) return;
        const { ctx, width, height } = setup;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#01050d';
        ctx.fillRect(0, 0, width, height);

        const left = 52;
        const right = 20;
        const top = 20;
        const bottom = 28;
        const gw = width - left - right;
        const gh = height - top - bottom;
        const zeroY = top + gh * 0.5;
        const history = state.history;
        const maxAbs = Math.max(0.3, ...history.map((value) => Math.abs(value)));
        const scale = gh / (maxAbs * 2.3);

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.strokeRect(left, top, gw, gh);

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.08)';
        for (let i = 1; i < 6; i++) {
            const y = top + (gh * i) / 6;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + gw, y);
            ctx.stroke();
        }

        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.beginPath();
        ctx.moveTo(left, zeroY);
        ctx.lineTo(left + gw, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (history.length > 1) {
            const areaGradient = ctx.createLinearGradient(0, top, 0, top + gh);
            areaGradient.addColorStop(0, 'rgba(34, 197, 94, 0.25)');
            areaGradient.addColorStop(1, 'rgba(0, 212, 255, 0.05)');

            ctx.beginPath();
            history.forEach((value, index) => {
                const x = left + (index / (history.length - 1)) * gw;
                const y = zeroY - value * scale;
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.lineTo(left + gw, zeroY);
            ctx.lineTo(left, zeroY);
            ctx.closePath();
            ctx.fillStyle = areaGradient;
            ctx.fill();

            const lineGradient = ctx.createLinearGradient(left, 0, left + gw, 0);
            lineGradient.addColorStop(0, '#22c55e');
            lineGradient.addColorStop(0.5, '#00d4ff');
            lineGradient.addColorStop(1, '#f59e0b');

            ctx.beginPath();
            history.forEach((value, index) => {
                const x = left + (index / (history.length - 1)) * gw;
                const y = zeroY - value * scale;
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = lineGradient;
            ctx.lineWidth = 2.2;
            ctx.stroke();

            const lastValue = history[history.length - 1];
            const lastY = zeroY - lastValue * scale;
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(left + gw, lastY, 3.4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText('Voltaje inducido e(t)', left, 13);
        ctx.fillText(`${maxAbs.toFixed(2)} V`, 8, top + 8);
        ctx.fillText(`-${maxAbs.toFixed(2)} V`, 4, top + gh);
        ctx.fillText('Tiempo', left + gw - 42, height - 8);
    }

    function renderFrame() {
        const now = performance.now();
        if (!ensureThree() || !isHostVisible()) return;
        updateSpringAndScene();
        if (state.graphDirty && (!state.lastGraphPaint || (now - state.lastGraphPaint) >= GRAPH_FRAME_MS)) {
            drawVoltageGraph();
            state.graphDirty = false;
            state.lastGraphPaint = now;
        }
        if (!state.lastMetricPaint || (now - state.lastMetricPaint) >= METRIC_FRAME_MS) {
            updateMetrics();
            state.lastMetricPaint = now;
        }
        state.three.renderer.render(state.three.scene, state.three.camera);
    }

    function tick(timestamp) {
        if (!state.running) return;
        if (!state.lastTs) state.lastTs = timestamp;

        let dt = (timestamp - state.lastTs) / 1000;
        state.lastTs = timestamp;
        if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
        dt = Math.min(dt, 0.05);

        stepModel(dt);
        state.graphDirty = true;
        renderFrame();
        state.rafId = requestAnimationFrame(tick);
    }

    function bindControl(input, handler) {
        if (!input) return;
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    }

    function bindUI() {
        const dom = state.dom;
        dom.modelHost = document.getElementById('em-seismo-canvas');
        dom.graphCanvas = document.getElementById('em-voltage-canvas');
        dom.inputB = document.getElementById('em-field-intensity');
        dom.inputSpeed = document.getElementById('em-motion-speed');
        dom.inputTurns = document.getElementById('em-turns');
        dom.inputLength = document.getElementById('em-coil-length');
        dom.valB = document.getElementById('em-field-intensity-val');
        dom.valSpeed = document.getElementById('em-motion-speed-val');
        dom.valTurns = document.getElementById('em-turns-val');
        dom.valLength = document.getElementById('em-coil-length-val');
        dom.metricVoltage = document.getElementById('em-metric-voltage');
        dom.metricElectric = document.getElementById('em-metric-electric');
        dom.metricFlux = document.getElementById('em-metric-flux');
        dom.metricVelocity = document.getElementById('em-metric-rel-vel');
        dom.equation = document.getElementById('em-induction-equation');
        dom.liveEquation = document.getElementById('em-induction-live');

        bindControl(dom.inputB, () => {
            state.controls.bField = parseFloat(dom.inputB.value) || 0.65;
            updateControlLabels();
        });
        bindControl(dom.inputSpeed, () => {
            state.controls.speed = parseFloat(dom.inputSpeed.value) || 1.2;
            updateControlLabels();
        });
        bindControl(dom.inputTurns, () => {
            state.controls.turns = parseFloat(dom.inputTurns.value) || 800;
            updateControlLabels();
        });
        bindControl(dom.inputLength, () => {
            state.controls.coilLength = parseFloat(dom.inputLength.value) || 0.06;
            updateControlLabels();
        });

        window.addEventListener('resize', () => {
            resizeThree();
            if (!state.running) renderFrame();
        });

        updateControlLabels();
        renderEquation();
    }

    function init() {
        if (!state.initialized) {
            bindUI();
            state.initialized = true;
        }

        resetState();
        updateControlLabels();
        renderEquation();
        updateMetrics();
        state.graphDirty = true;
        renderFrame();

        if (state.running) return;
        state.running = true;
        state.lastTs = 0;
        state.lastGraphPaint = 0;
        state.lastMetricPaint = 0;
        state.rafId = requestAnimationFrame(tick);
    }

    function stop() {
        state.running = false;
        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        state.lastTs = 0;
        state.lastGraphPaint = 0;
        state.lastMetricPaint = 0;
    }

    window.initSeismographEM = init;
    window.stopSeismographEM = stop;
})();

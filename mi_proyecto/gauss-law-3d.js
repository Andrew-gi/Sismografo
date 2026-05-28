(function () {
    const MU0_OVER_4PI = 1e-7;

    const state = {
        initialized: false,
        running: false,
        rafId: 0,
        needsUpdate: true,
        graphDirty: true,
        simulationActive: false,
        simulationPhase: 0,
        lastTs: 0,
        lastGraphDraw: 0,
        controls: {
            moment: 120,
            radius: 1.4,
            offsetRatio: 0.25,
            samples: 24,
            configuration: 'offset-sphere'
        },
        metrics: {
            theoreticalFlux: 0,
            numericFlux: 0,
            outgoingFlux: 0,
            incomingFlux: 0,
            meanField: 0,
            area: 0
        },
        dom: {
            host: null,
            graphCanvas: null,
            inputConfig: null,
            configLabel: null,
            simulateBtn: null,
            simStatus: null,
            selectionStatus: null,
            inspectorNote: null,
            inputMoment: null,
            inputRadius: null,
            inputOffset: null,
            inputSamples: null,
            valMoment: null,
            valRadius: null,
            valOffset: null,
            valSamples: null,
            metricFluxTheory: null,
            metricFluxNumeric: null,
            metricOutflux: null,
            metricInflux: null,
            metricField: null,
            metricArea: null,
            equation: null,
            liveEquation: null
        },
        cache: {
            directionSets: new Map()
        },
        interaction: {
            raycaster: null,
            pointer: null,
            selectedMagnetKey: 'primary',
            focusMode: 'origin',
            selectionChanged: true
        },
        three: {
            renderer: null,
            scene: null,
            camera: null,
            gaussianSurface: null,
            gaussianWire: null,
            gaussianCubeSurface: null,
            gaussianCubeWire: null,
            arrowGroup: null,
            fieldLineGroup: null,
            referenceGroup: null,
            magnetGroup: null,
            magnetGroupSecondary: null,
            magnetHalo: null,
            magnetHaloSecondary: null,
            focusRing: null,
            offsetLine: null,
            controls: {
                radius: 7.8,
                baseRadius: 7.8,
                inspectRadius: 3.25,
                azimuth: -0.55,
                polar: 1.08,
                dragging: false,
                moved: false,
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

    function formatFlux(value) {
        return `${formatScientific(value, 2)} Wb`;
    }

    function formatMicroTesla(valueTesla) {
        return `${formatScientific(valueTesla * 1e6, 2)} uT`;
    }

    function getConfigMeta(configKey) {
        switch (configKey) {
            case 'offset-cube':
                return {
                    label: 'Cubo gaussiano',
                    button: state.simulationActive ? 'Pausar' : 'Simular',
                    status: state.simulationActive ? 'Cubo animado' : 'Detenida'
                };
            case 'split-magnets':
                return {
                    label: 'Iman dividido',
                    button: state.simulationActive ? 'Pausar' : 'Simular',
                    status: state.simulationActive ? 'Division activa' : 'Detenida'
                };
            default:
                return {
                    label: 'Esfera gaussiana',
                    button: state.simulationActive ? 'Pausar' : 'Simular',
                    status: state.simulationActive ? 'Flujo animado' : 'Detenida'
                };
        }
    }

    function updateScenarioUi() {
        const meta = getConfigMeta(state.controls.configuration);
        if (state.dom.configLabel) state.dom.configLabel.textContent = meta.label;
        if (state.dom.simStatus) state.dom.simStatus.textContent = meta.status;
        if (state.dom.simulateBtn) state.dom.simulateBtn.textContent = meta.button;
        if (state.dom.inputConfig && state.dom.inputConfig.value !== state.controls.configuration) {
            state.dom.inputConfig.value = state.controls.configuration;
        }
    }

    function getMagnetByKey(key) {
        return key === 'secondary' ? state.three.magnetGroupSecondary : state.three.magnetGroup;
    }

    function getMagnetLabel(key) {
        if (state.controls.configuration === 'split-magnets') {
            return key === 'secondary' ? 'Iman secundario enfocado' : 'Iman principal enfocado';
        }
        return 'Iman enfocado';
    }

    function updateSelectionUi() {
        if (!state.dom.selectionStatus) return;
        if (state.interaction.focusMode === 'origin') {
            state.dom.selectionStatus.textContent = 'Vista global activa';
            if (state.dom.inspectorNote) {
                state.dom.inspectorNote.textContent = 'Haz clic en el iman para entrar en una inspeccion cercana 360 grados. La camara se acercara automaticamente para estudiar polos, nucleo y lineas cerradas del campo.';
            }
            return;
        }
        state.dom.selectionStatus.textContent = getMagnetLabel(state.interaction.selectedMagnetKey);
        if (state.dom.inspectorNote) {
            state.dom.inspectorNote.textContent =
                state.controls.configuration === 'split-magnets'
                    ? 'Inspeccion cercana: al dividir el iman siguen apareciendo polos norte y sur en cada fragmento. Las lineas del campo permanecen cerradas y el flujo neto de la superficie gaussiana sigue siendo cero.'
                    : 'Inspeccion cercana: el polo norte y el polo sur forman un dipolo magnetico. Las lineas salen localmente de un polo y regresan por el otro, por eso no aparecen monopolos y el flujo neto total se cancela.';
        }
    }

    function setFocusMode(mode) {
        state.interaction.focusMode = mode;
        state.interaction.selectionChanged = true;
        updateSelectionUi();
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

    function getDirections(sampleCount) {
        const count = Math.max(12, Math.round(sampleCount));
        if (state.cache.directionSets.has(count)) return state.cache.directionSets.get(count);

        const THREE = window.THREE;
        const directions = [];
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        for (let i = 0; i < count; i++) {
            const t = count === 1 ? 0.5 : i / (count - 1);
            const y = 1 - 2 * t;
            const radial = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = goldenAngle * i;
            directions.push(new THREE.Vector3(
                Math.cos(theta) * radial,
                y,
                Math.sin(theta) * radial
            ));
        }

        state.cache.directionSets.set(count, directions);
        return directions;
    }

    function getOffsetMeters(radius) {
        return radius * state.controls.offsetRatio;
    }

    function updateControlLabels() {
        const offsetMeters = getOffsetMeters(state.controls.radius);
        if (state.dom.valMoment) state.dom.valMoment.textContent = `${formatFixed(state.controls.moment, 1)} A*m^2`;
        if (state.dom.valRadius) state.dom.valRadius.textContent = `${formatFixed(state.controls.radius, 2)} m`;
        if (state.dom.valOffset) state.dom.valOffset.textContent = `${formatFixed(offsetMeters, 2)} m`;
        if (state.dom.valSamples) state.dom.valSamples.textContent = `${Math.round(state.controls.samples)}`;
    }

    function renderEquation() {
        const eqEl = state.dom.equation;
        if (!eqEl) return;
        const tex = '\\oint_S \\vec{B}\\cdot d\\vec{A} = 0 \\qquad \\nabla\\cdot\\vec{B}=0';

        if (window.katex && typeof window.katex.render === 'function') {
            window.katex.render(tex, eqEl, { throwOnError: false, displayMode: true });
        } else {
            eqEl.textContent = 'oint_S B.dA = 0 and div(B) = 0';
        }
    }

    function updateMetricsDisplay() {
        const m = state.metrics;
        if (state.dom.metricFluxTheory) state.dom.metricFluxTheory.textContent = formatFlux(m.theoreticalFlux);
        if (state.dom.metricFluxNumeric) state.dom.metricFluxNumeric.textContent = formatFlux(m.numericFlux);
        if (state.dom.metricOutflux) state.dom.metricOutflux.textContent = formatFlux(m.outgoingFlux);
        if (state.dom.metricInflux) state.dom.metricInflux.textContent = formatFlux(m.incomingFlux);
        if (state.dom.metricField) state.dom.metricField.textContent = formatMicroTesla(m.meanField);
        if (state.dom.metricArea) state.dom.metricArea.textContent = `${formatFixed(m.area, 2)} m^2`;

        if (state.dom.liveEquation) {
            state.dom.liveEquation.textContent =
                `Phi_B,total = Phi_sale + Phi_entra = ${formatScientific(m.outgoingFlux, 2)} + ` +
                `${formatScientific(m.incomingFlux, 2)} ~= ${formatScientific(m.numericFlux, 2)} Wb`;
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

    function getDesiredCameraRadius() {
        if (state.interaction.focusMode !== 'selected') return state.three.controls.baseRadius;
        if (state.controls.configuration === 'split-magnets') return 2.75;
        if (state.controls.configuration === 'offset-cube') return 3.05;
        return state.three.controls.inspectRadius;
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
        if (!host || host.dataset.gaussBound === 'true') return;
        host.dataset.gaussBound = 'true';

        host.addEventListener('pointerdown', (event) => {
            state.three.controls.dragging = true;
            state.three.controls.moved = false;
            state.three.controls.lastX = event.clientX;
            state.three.controls.lastY = event.clientY;
            if (host.setPointerCapture) host.setPointerCapture(event.pointerId);
        });

        host.addEventListener('pointermove', (event) => {
            if (!state.three.controls.dragging) return;
            const dx = event.clientX - state.three.controls.lastX;
            const dy = event.clientY - state.three.controls.lastY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.three.controls.moved = true;
            state.three.controls.lastX = event.clientX;
            state.three.controls.lastY = event.clientY;
            state.three.controls.azimuth -= dx * 0.01;
            state.three.controls.polar = clamp(state.three.controls.polar + dy * 0.008, 0.45, 1.6);
            updateCamera();
        });

        const release = (event) => {
            if (event && event.type === 'pointerup' && !state.three.controls.moved) {
                handleMagnetSelection(event.clientX, event.clientY);
            }
            state.three.controls.dragging = false;
            state.three.controls.moved = false;
        };

        host.addEventListener('pointerup', release);
        host.addEventListener('pointerleave', release);
        host.addEventListener('pointercancel', release);
        host.addEventListener('wheel', (event) => {
            event.preventDefault();
            state.three.controls.radius = clamp(state.three.controls.radius + event.deltaY * 0.004, 5.8, 12.5);
            updateCamera();
        }, { passive: false });
    }

    function createBarMagnetGroup(scale = 1) {
        const THREE = window.THREE;
        const magnetGroup = new THREE.Group();

        const southPole = new THREE.Mesh(
            new THREE.BoxGeometry(0.54 * scale, 0.34 * scale, 0.34 * scale),
            new THREE.MeshStandardMaterial({
                color: 0x2563eb,
                emissive: 0x102040,
                emissiveIntensity: 0.85,
                metalness: 0.2,
                roughness: 0.22
            })
        );
        southPole.position.x = -0.33 * scale;
        southPole.renderOrder = 2;
        magnetGroup.add(southPole);

        const northPole = new THREE.Mesh(
            new THREE.BoxGeometry(0.54 * scale, 0.34 * scale, 0.34 * scale),
            new THREE.MeshStandardMaterial({
                color: 0xef4444,
                emissive: 0x4c0519,
                emissiveIntensity: 0.85,
                metalness: 0.2,
                roughness: 0.22
            })
        );
        northPole.position.x = 0.33 * scale;
        northPole.renderOrder = 2;
        magnetGroup.add(northPole);

        const core = new THREE.Mesh(
            new THREE.BoxGeometry(0.18 * scale, 0.22 * scale, 0.22 * scale),
            new THREE.MeshStandardMaterial({
                color: 0xe5e7eb,
                emissive: 0x2f2f2f,
                emissiveIntensity: 0.22,
                metalness: 0.82,
                roughness: 0.18
            })
        );
        core.renderOrder = 3;
        magnetGroup.add(core);

        const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1.12 * scale, 0.38 * scale, 0.38 * scale)),
            new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.55
            })
        );
        outline.renderOrder = 4;
        magnetGroup.add(outline);

        const northLabel = createPoleLabelSprite('N', '#ffffff', '#ef4444');
        northLabel.position.set(0.33 * scale, 0.38 * scale, 0.02 * scale);
        northLabel.scale.setScalar(0.4 * scale);
        magnetGroup.add(northLabel);

        const southLabel = createPoleLabelSprite('S', '#ffffff', '#2563eb');
        southLabel.position.set(-0.33 * scale, 0.38 * scale, 0.02 * scale);
        southLabel.scale.setScalar(0.4 * scale);
        magnetGroup.add(southLabel);

        return magnetGroup;
    }

    function createPoleLabelSprite(text, fg, bg) {
        const THREE = window.THREE;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 128, 128);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(64, 64, 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.font = 'bold 56px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 66);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthWrite: false
            })
        );
    }

    function tagMagnetGroup(group, magnetKey) {
        group.userData.magnetKey = magnetKey;
        group.traverse((child) => {
            child.userData.magnetKey = magnetKey;
            child.userData.isMagnetPart = true;
            if (child.material && typeof child.material.emissiveIntensity === 'number') {
                child.userData.baseEmissiveIntensity = child.material.emissiveIntensity;
            }
        });
    }

    function setSelectedMagnet(key, focusSelection) {
        if (!getMagnetByKey(key)) return;
        state.interaction.selectedMagnetKey = key;
        if (focusSelection) setFocusMode('selected');
        else updateSelectionUi();
    }

    function updateSelectionVisuals() {
        const selectedFocused = state.interaction.focusMode === 'selected';
        ['primary', 'secondary'].forEach((key) => {
            const magnet = getMagnetByKey(key);
            if (!magnet) return;
            const selected = state.interaction.selectedMagnetKey === key && selectedFocused;
            magnet.scale.setScalar(selected ? (state.controls.configuration === 'split-magnets' ? 0.9 : 1.16) : (state.controls.configuration === 'split-magnets' ? 0.72 : 1));
            magnet.traverse((child) => {
                if (child.material && typeof child.material.emissiveIntensity === 'number') {
                    const base = child.userData.baseEmissiveIntensity ?? child.material.emissiveIntensity;
                    child.material.emissiveIntensity = selected ? base + 0.32 : base;
                }
                if (child.material && 'opacity' in child.material) {
                    child.material.transparent = true;
                    child.material.opacity = selected || !selectedFocused ? 1 : 0.38;
                }
            });
        });

        if (state.three.focusRing) {
            const selectedMagnet = getMagnetByKey(state.interaction.selectedMagnetKey);
            state.three.focusRing.visible = !!selectedMagnet && selectedMagnet.visible && selectedFocused;
            if (state.three.focusRing.visible) {
                state.three.focusRing.position.copy(selectedMagnet.position);
                state.three.focusRing.scale.setScalar(state.controls.configuration === 'split-magnets' ? 0.8 : 1);
            }
        }

        if (state.three.gaussianSurface) state.three.gaussianSurface.material.opacity = selectedFocused ? 0.06 : 0.16;
        if (state.three.gaussianWire) state.three.gaussianWire.material.opacity = selectedFocused ? 0.22 : 0.55;
        if (state.three.gaussianCubeSurface) state.three.gaussianCubeSurface.material.opacity = selectedFocused ? 0.05 : 0.12;
        if (state.three.gaussianCubeWire) state.three.gaussianCubeWire.material.opacity = selectedFocused ? 0.2 : 0.5;
        if (state.three.fieldLineGroup) {
            state.three.fieldLineGroup.children.forEach((line) => {
                line.material.opacity = selectedFocused ? 0.2 : line.material.opacity;
            });
        }
        if (state.three.arrowGroup) {
            state.three.arrowGroup.children.forEach((arrow) => {
                arrow.visible = !selectedFocused;
            });
        }
    }

    function buildClosedLoop(major, minor, rotationY, color) {
        const THREE = window.THREE;
        const points = [];
        for (let i = 0; i <= 120; i++) {
            const t = (i / 120) * Math.PI * 2;
            const x = Math.cos(t) * major;
            const radial = 0.18 + minor * (1 - Math.cos(t) * Math.cos(t));
            const y = Math.sin(t) * radial;
            points.push(new THREE.Vector3(x, y, 0));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.46
            })
        );
        line.rotation.y = rotationY;
        return line;
    }

    function rebuildClosedFieldLoops(mode, radius) {
        const THREE = window.THREE;
        const group = state.three.fieldLineGroup;
        if (!THREE || !group) return;
        group.clear();

        const colors = [0x60a5fa, 0x38bdf8, 0xc084fc, 0xfacc15, 0x4ade80, 0x93c5fd];
        const modeBoost = mode === 'split' ? 0.18 : 0;
        for (let i = 0; i < 6; i++) {
            const line = buildClosedLoop(
                0.62 + radius * (0.34 + i * 0.08 + modeBoost),
                0.36 + radius * (0.16 + i * 0.05),
                (i / 6) * Math.PI,
                colors[i % colors.length]
            );
            line.rotation.x = (i / 6) * Math.PI * 0.8;
            group.add(line);
        }
    }

    function rebuildArrowHelpers(count) {
        const THREE = window.THREE;
        if (!THREE || !state.three.arrowGroup) return;
        state.three.arrowGroup.clear();

        for (let i = 0; i < count; i++) {
            const arrow = new THREE.ArrowHelper(
                new THREE.Vector3(1, 0, 0),
                new THREE.Vector3(0, 0, 0),
                0.75,
                0x38bdf8,
                0.16,
                0.08
            );
            arrow.line.material.transparent = true;
            arrow.cone.material.transparent = true;
            state.three.arrowGroup.add(arrow);
        }
    }

    function buildSceneObjects() {
        const THREE = window.THREE;
        const scene = state.three.scene;

        const referenceGroup = new THREE.Group();
        scene.add(referenceGroup);
        state.three.referenceGroup = referenceGroup;

        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(5.2, 64),
            new THREE.MeshBasicMaterial({
                color: 0x06131f,
                transparent: true,
                opacity: 0.75
            })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -2.1;
        referenceGroup.add(floor);

        const grid = new THREE.GridHelper(8, 16, 0x154360, 0x0b2235);
        grid.position.y = -2.08;
        grid.material.transparent = true;
        grid.material.opacity = 0.35;
        referenceGroup.add(grid);

        const axes = new THREE.AxesHelper(2.2);
        axes.material.transparent = true;
        axes.material.opacity = 0.65;
        referenceGroup.add(axes);

        const gaussianSurface = new THREE.Mesh(
            new THREE.SphereGeometry(1, 36, 24),
            new THREE.MeshPhysicalMaterial({
                color: 0x4fd1ff,
                transparent: true,
                opacity: 0.16,
                roughness: 0.1,
                metalness: 0.05,
                transmission: 0.12
            })
        );
        scene.add(gaussianSurface);
        state.three.gaussianSurface = gaussianSurface;

        const gaussianWire = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.SphereGeometry(1.005, 24, 18)),
            new THREE.LineBasicMaterial({
                color: 0x7dd3fc,
                transparent: true,
                opacity: 0.55
            })
        );
        scene.add(gaussianWire);
        state.three.gaussianWire = gaussianWire;

        const gaussianCubeSurface = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 2),
            new THREE.MeshPhysicalMaterial({
                color: 0xc084fc,
                transparent: true,
                opacity: 0.12,
                roughness: 0.12,
                metalness: 0.05,
                transmission: 0.08
            })
        );
        gaussianCubeSurface.visible = false;
        scene.add(gaussianCubeSurface);
        state.three.gaussianCubeSurface = gaussianCubeSurface;

        const gaussianCubeWire = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 2.02, 2.02)),
            new THREE.LineBasicMaterial({
                color: 0xc084fc,
                transparent: true,
                opacity: 0.5
            })
        );
        gaussianCubeWire.visible = false;
        scene.add(gaussianCubeWire);
        state.three.gaussianCubeWire = gaussianCubeWire;

        const magnetGroup = createBarMagnetGroup(1);
        tagMagnetGroup(magnetGroup, 'primary');
        scene.add(magnetGroup);
        state.three.magnetGroup = magnetGroup;

        const magnetGroupSecondary = createBarMagnetGroup(0.72);
        tagMagnetGroup(magnetGroupSecondary, 'secondary');
        magnetGroupSecondary.visible = false;
        scene.add(magnetGroupSecondary);
        state.three.magnetGroupSecondary = magnetGroupSecondary;

        const magnetHalo = new THREE.Mesh(
            new THREE.SphereGeometry(0.62, 24, 24),
            new THREE.MeshBasicMaterial({
                color: 0xcffafe,
                transparent: true,
                opacity: 0.14
            })
        );
        scene.add(magnetHalo);
        state.three.magnetHalo = magnetHalo;

        const magnetHaloSecondary = new THREE.Mesh(
            new THREE.SphereGeometry(0.48, 20, 20),
            new THREE.MeshBasicMaterial({
                color: 0xe9d5ff,
                transparent: true,
                opacity: 0.08
            })
        );
        magnetHaloSecondary.visible = false;
        scene.add(magnetHaloSecondary);
        state.three.magnetHaloSecondary = magnetHaloSecondary;

        const offsetLineGeometry = new THREE.BufferGeometry();
        offsetLineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const offsetLine = new THREE.Line(
            offsetLineGeometry,
            new THREE.LineDashedMaterial({
                color: 0xf8fafc,
                dashSize: 0.08,
                gapSize: 0.06,
                transparent: true,
                opacity: 0.7
            })
        );
        scene.add(offsetLine);
        state.three.offsetLine = offsetLine;

        const arrowGroup = new THREE.Group();
        scene.add(arrowGroup);
        state.three.arrowGroup = arrowGroup;
        const fieldLineGroup = new THREE.Group();
        scene.add(fieldLineGroup);
        state.three.fieldLineGroup = fieldLineGroup;

        const focusRing = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.SphereGeometry(0.82, 18, 14)),
            new THREE.LineBasicMaterial({
                color: 0xfacc15,
                transparent: true,
                opacity: 0.9
            })
        );
        focusRing.visible = false;
        scene.add(focusRing);
        state.three.focusRing = focusRing;

        rebuildArrowHelpers(Math.round(state.controls.samples));
        rebuildClosedFieldLoops('single', state.controls.radius);
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

            const key = new THREE.DirectionalLight(0xffffff, 1.2);
            key.position.set(3.8, 5.5, 4.8);
            state.three.scene.add(key);

            const fill = new THREE.PointLight(0x38bdf8, 1.2, 18, 2);
            fill.position.set(-3.2, 0.6, -2.2);
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

    function handleMagnetSelection(clientX, clientY) {
        const THREE = window.THREE;
        const renderer = state.three.renderer;
        const camera = state.three.camera;
        if (!THREE || !renderer || !camera) return;

        if (!state.interaction.raycaster) state.interaction.raycaster = new THREE.Raycaster();
        if (!state.interaction.pointer) state.interaction.pointer = new THREE.Vector2();

        const rect = renderer.domElement.getBoundingClientRect();
        state.interaction.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        state.interaction.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        state.interaction.raycaster.setFromCamera(state.interaction.pointer, camera);

        const candidates = [];
        if (state.three.magnetGroup?.visible) candidates.push(state.three.magnetGroup);
        if (state.three.magnetGroupSecondary?.visible) candidates.push(state.three.magnetGroupSecondary);
        const intersects = state.interaction.raycaster.intersectObjects(candidates, true);
        const hit = intersects.find((entry) => entry.object?.userData?.isMagnetPart);
        if (!hit) {
            setFocusMode('origin');
            return;
        }

        let current = hit.object;
        while (current && !current.userData?.magnetKey) current = current.parent;
        const magnetKey = current?.userData?.magnetKey || 'primary';
        setSelectedMagnet(magnetKey, true);
        state.needsUpdate = true;
    }

    function syncFocusTarget() {
        const controls = state.three.controls;
        if (!controls.target) return;
        const selectedMagnet = getMagnetByKey(state.interaction.selectedMagnetKey);
        const desired = state.interaction.focusMode === 'selected' && selectedMagnet
            ? selectedMagnet.position
            : { x: 0, y: 0, z: 0 };
        const desiredRadius = getDesiredCameraRadius();
        controls.target.lerp(desired, state.interaction.selectionChanged ? 0.18 : 0.12);
        controls.radius += (desiredRadius - controls.radius) * (state.interaction.selectionChanged ? 0.2 : 0.1);
        state.interaction.selectionChanged = false;
        updateCamera();
    }

    function computeDipoleField(point, dipolePosition, moment) {
        const THREE = window.THREE;
        const displacement = point.clone().sub(dipolePosition);
        const distance = Math.max(displacement.length(), 0.18);
        const distanceSq = distance * distance;
        const distanceCubed = distanceSq * distance;
        const rHat = displacement.clone().divideScalar(distance);
        const mVec = new THREE.Vector3(moment, 0, 0);
        const mDotR = mVec.dot(rHat);

        return rHat.multiplyScalar(3 * mDotR)
            .sub(mVec)
            .multiplyScalar(MU0_OVER_4PI / distanceCubed);
    }

    function computeCombinedField(point, dipoles) {
        const THREE = window.THREE;
        const total = new THREE.Vector3();
        dipoles.forEach((dipole) => {
            total.add(computeDipoleField(point, dipole.position, dipole.moment));
        });
        return total;
    }

    function getSimulationDescriptor() {
        const THREE = window.THREE;
        const radius = state.controls.radius;
        const baseOffset = getOffsetMeters(radius);
        const phase = state.simulationPhase;

        if (state.controls.configuration === 'split-magnets') {
            const separation = radius * (0.28 + state.controls.offsetRatio * 0.7 + (state.simulationActive ? 0.08 * Math.sin(phase * 1.2) : 0));
            return {
                surfaceType: 'sphere',
                magnetMode: 'split',
                surfaceScale: radius,
                dipoles: [
                    { position: new THREE.Vector3(-separation, 0, 0), moment: state.controls.moment * 0.58 },
                    { position: new THREE.Vector3(separation, 0, 0), moment: state.controls.moment * 0.58 }
                ]
            };
        }

        if (state.controls.configuration === 'offset-cube') {
            return {
                surfaceType: 'cube',
                magnetMode: 'single',
                surfaceScale: radius * 0.88,
                dipoles: [
                    {
                        position: new THREE.Vector3(
                            baseOffset * (0.55 + 0.2 * Math.cos(phase * 0.7)),
                            state.simulationActive ? 0.14 * Math.sin(phase * 0.6) : 0,
                            state.simulationActive ? 0.22 * Math.cos(phase * 0.5) : 0
                        ),
                        moment: state.controls.moment
                    }
                ]
            };
        }

        return {
            surfaceType: 'sphere',
            magnetMode: 'single',
            surfaceScale: radius,
            dipoles: [
                {
                    position: new THREE.Vector3(
                        baseOffset + (state.simulationActive ? radius * 0.12 * Math.sin(phase) : 0),
                        0,
                        state.simulationActive ? radius * 0.08 * Math.cos(phase * 0.7) : 0
                    ),
                    moment: state.controls.moment
                }
            ]
        };
    }

    function estimateFlux(surfaceType, surfaceScale, dipoles, sampleCount) {
        const samples = [];
        let numericFlux = 0;
        let outgoingFlux = 0;
        let incomingFlux = 0;
        let meanField = 0;
        let maxField = 0;
        let area = 0;

        if (surfaceType === 'cube') {
            const halfSize = surfaceScale;
            const n = clamp(Math.round(Math.sqrt(sampleCount)) + 1, 3, 6);
            const step = (2 * halfSize) / n;
            const faces = [
                { normal: [1, 0, 0], axis: 'x', sign: 1 },
                { normal: [-1, 0, 0], axis: 'x', sign: -1 },
                { normal: [0, 1, 0], axis: 'y', sign: 1 },
                { normal: [0, -1, 0], axis: 'y', sign: -1 },
                { normal: [0, 0, 1], axis: 'z', sign: 1 },
                { normal: [0, 0, -1], axis: 'z', sign: -1 }
            ];

            faces.forEach((face) => {
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j < n; j++) {
                        const u = -halfSize + step * (i + 0.5);
                        const v = -halfSize + step * (j + 0.5);
                        const point = new window.THREE.Vector3();
                        const normal = new window.THREE.Vector3(...face.normal);

                        if (face.axis === 'x') point.set(face.sign * halfSize, u, v);
                        if (face.axis === 'y') point.set(u, face.sign * halfSize, v);
                        if (face.axis === 'z') point.set(u, v, face.sign * halfSize);

                        const fieldVector = computeCombinedField(point, dipoles);
                        const fieldMagnitude = fieldVector.length();
                        const localFlux = fieldVector.dot(normal) * step * step;

                        numericFlux += localFlux;
                        if (localFlux >= 0) outgoingFlux += localFlux;
                        else incomingFlux += localFlux;

                        meanField += fieldMagnitude;
                        maxField = Math.max(maxField, fieldMagnitude);
                        samples.push({ point, normal, fieldVector, fieldMagnitude });
                    }
                }
            });

            area = 24 * halfSize * halfSize;
        } else {
            const directions = getDirections(sampleCount);
            const areaElement = (4 * Math.PI * surfaceScale * surfaceScale) / directions.length;

            for (let i = 0; i < directions.length; i++) {
                const normal = directions[i];
                const point = normal.clone().multiplyScalar(surfaceScale);
                const fieldVector = computeCombinedField(point, dipoles);
                const fieldMagnitude = fieldVector.length();
                const localFlux = fieldVector.dot(normal) * areaElement;

                numericFlux += localFlux;
                if (localFlux >= 0) outgoingFlux += localFlux;
                else incomingFlux += localFlux;

                meanField += fieldMagnitude;
                maxField = Math.max(maxField, fieldMagnitude);
                samples.push({ point, normal, fieldVector, fieldMagnitude });
            }

            area = 4 * Math.PI * surfaceScale * surfaceScale;
        }

        return {
            samples,
            numericFlux,
            outgoingFlux,
            incomingFlux,
            meanField: samples.length ? meanField / samples.length : 0,
            maxField,
            area
        };
    }

    function setArrowColor(arrow, fieldVector, intensity) {
        const outward = fieldVector.dot(arrow.position.clone().normalize()) >= 0;
        const lineColor = outward ? 0x38bdf8 : 0xf59e0b;
        const alphaFactor = 0.45 + 0.45 * intensity;
        arrow.line.material.color.setHex(lineColor);
        arrow.cone.material.color.setHex(lineColor);
        arrow.line.material.opacity = alphaFactor;
        arrow.cone.material.opacity = alphaFactor;
    }

    function recomputeVisualization() {
        if (!ensureThree()) return;
        const descriptor = getSimulationDescriptor();
        const stats = estimateFlux(
            descriptor.surfaceType,
            descriptor.surfaceScale,
            descriptor.dipoles,
            state.controls.samples
        );

        state.metrics.theoreticalFlux = 0;
        state.metrics.numericFlux = stats.numericFlux;
        state.metrics.outgoingFlux = stats.outgoingFlux;
        state.metrics.incomingFlux = stats.incomingFlux;
        state.metrics.meanField = stats.meanField;
        state.metrics.area = stats.area;

        if (state.three.arrowGroup.children.length !== stats.samples.length) {
            rebuildArrowHelpers(stats.samples.length);
        }

        if (state.three.gaussianSurface) {
            state.three.gaussianSurface.visible = descriptor.surfaceType === 'sphere';
            state.three.gaussianSurface.scale.setScalar(descriptor.surfaceScale);
        }
        if (state.three.gaussianWire) {
            state.three.gaussianWire.visible = descriptor.surfaceType === 'sphere';
            state.three.gaussianWire.scale.setScalar(descriptor.surfaceScale);
        }
        if (state.three.gaussianCubeSurface) {
            state.three.gaussianCubeSurface.visible = descriptor.surfaceType === 'cube';
            state.three.gaussianCubeSurface.scale.setScalar(descriptor.surfaceScale);
        }
        if (state.three.gaussianCubeWire) {
            state.three.gaussianCubeWire.visible = descriptor.surfaceType === 'cube';
            state.three.gaussianCubeWire.scale.setScalar(descriptor.surfaceScale);
        }
        if (state.three.magnetGroup) {
            state.three.magnetGroup.visible = true;
            state.three.magnetGroup.position.copy(descriptor.dipoles[0].position);
            state.three.magnetGroup.scale.setScalar(descriptor.magnetMode === 'split' ? 0.9 : 1.35);
        }
        if (state.three.magnetGroupSecondary) {
            state.three.magnetGroupSecondary.visible = descriptor.magnetMode === 'split';
            if (descriptor.dipoles[1]) {
                state.three.magnetGroupSecondary.position.copy(descriptor.dipoles[1].position);
                state.three.magnetGroupSecondary.scale.setScalar(0.9);
            }
        }
        if (state.three.magnetHalo) {
            state.three.magnetHalo.visible = true;
            state.three.magnetHalo.position.copy(descriptor.dipoles[0].position);
            state.three.magnetHalo.scale.setScalar(descriptor.magnetMode === 'split' ? 0.95 : 1.28);
        }
        if (state.three.magnetHaloSecondary) {
            state.three.magnetHaloSecondary.visible = descriptor.magnetMode === 'split';
            if (descriptor.dipoles[1]) {
                state.three.magnetHaloSecondary.position.copy(descriptor.dipoles[1].position);
            }
        }
        if (state.three.offsetLine) {
            const positions = state.three.offsetLine.geometry.attributes.position.array;
            const start = descriptor.magnetMode === 'split' && descriptor.dipoles[1]
                ? descriptor.dipoles[0].position
                : { x: 0, y: 0, z: 0 };
            const end = descriptor.magnetMode === 'split' && descriptor.dipoles[1]
                ? descriptor.dipoles[1].position
                : descriptor.dipoles[0].position;
            positions[0] = start.x;
            positions[1] = start.y;
            positions[2] = start.z;
            positions[3] = end.x;
            positions[4] = end.y;
            positions[5] = end.z;
            state.three.offsetLine.geometry.attributes.position.needsUpdate = true;
            state.three.offsetLine.computeLineDistances();
        }

        rebuildClosedFieldLoops(descriptor.magnetMode, state.controls.radius);

        if (descriptor.magnetMode !== 'split' && state.interaction.selectedMagnetKey === 'secondary') {
            state.interaction.selectedMagnetKey = 'primary';
            state.interaction.selectionChanged = true;
        }
        updateSelectionVisuals();
        updateSelectionUi();

        const safeMaxField = Math.max(stats.maxField, 1e-9);
        stats.samples.forEach((sample, index) => {
            const arrow = state.three.arrowGroup.children[index];
            const direction = sample.fieldMagnitude > 1e-12
                ? sample.fieldVector.clone().normalize()
                : sample.normal.clone();
            const normalizedField = clamp(sample.fieldMagnitude / safeMaxField, 0, 1);
            const length = 0.3 + 0.9 * Math.pow(normalizedField, 0.45);
            const offset = direction.clone().multiplyScalar(0.06);
            arrow.position.copy(sample.point.clone().sub(offset));
            arrow.setDirection(direction);
            arrow.setLength(length, 0.16, 0.08);
            setArrowColor(arrow, sample.fieldVector, normalizedField);
        });

        updateMetricsDisplay();
        state.graphDirty = true;
        state.needsUpdate = false;
    }

    function drawLegendSwatch(ctx, x, y, color, text) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 5, 14, 3);
        ctx.fillStyle = 'rgba(229, 237, 246, 0.86)';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText(text, x + 20, y);
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

        const rMin = 0.8;
        const rMax = 2.4;
        const steps = 44;
        const currentRadius = state.controls.radius;
        const currentConfig = state.controls.configuration;

        const fieldSeries = [];
        const outgoingSeries = [];
        const incomingSeries = [];
        const netSeries = [];

        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            const radius = rMin + (rMax - rMin) * t;
            let descriptor;
            if (currentConfig === 'split-magnets') {
                const separation = radius * (0.28 + state.controls.offsetRatio * 0.7);
                descriptor = {
                    surfaceType: 'sphere',
                    surfaceScale: radius,
                    dipoles: [
                        { position: new window.THREE.Vector3(-separation, 0, 0), moment: state.controls.moment * 0.58 },
                        { position: new window.THREE.Vector3(separation, 0, 0), moment: state.controls.moment * 0.58 }
                    ]
                };
            } else if (currentConfig === 'offset-cube') {
                descriptor = {
                    surfaceType: 'cube',
                    surfaceScale: radius * 0.88,
                    dipoles: [{ position: new window.THREE.Vector3(getOffsetMeters(radius) * 0.55, 0, 0), moment: state.controls.moment }]
                };
            } else {
                descriptor = {
                    surfaceType: 'sphere',
                    surfaceScale: radius,
                    dipoles: [{ position: new window.THREE.Vector3(getOffsetMeters(radius), 0, 0), moment: state.controls.moment }]
                };
            }
            const stats = estimateFlux(descriptor.surfaceType, descriptor.surfaceScale, descriptor.dipoles, state.controls.samples);
            fieldSeries.push(stats.meanField);
            outgoingSeries.push(stats.outgoingFlux);
            incomingSeries.push(stats.incomingFlux);
            netSeries.push(stats.numericFlux);
        }

        const maxField = Math.max(1e-7, ...fieldSeries);
        const maxFlux = Math.max(
            1e-10,
            ...outgoingSeries.map((value) => Math.abs(value)),
            ...incomingSeries.map((value) => Math.abs(value)),
            ...netSeries.map((value) => Math.abs(value))
        );

        function drawGrid(box, subdivisions, centered) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= subdivisions; i++) {
                const y = box.y + (box.h * i) / subdivisions;
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
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
                ctx.beginPath();
                ctx.moveTo(box.x, midY);
                ctx.lineTo(box.x + box.w, midY);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        function plotPositiveSeries(box, values, maxValue, color) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            values.forEach((value, index) => {
                const x = box.x + (index / (values.length - 1)) * box.w;
                const y = box.y + box.h - (value / maxValue) * box.h;
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        function plotSignedSeries(box, values, maxValue, color, dashed) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (dashed) ctx.setLineDash([6, 4]);
            else ctx.setLineDash([]);
            ctx.beginPath();
            values.forEach((value, index) => {
                const x = box.x + (index / (values.length - 1)) * box.w;
                const y = box.y + box.h / 2 - (value / maxValue) * (box.h / 2);
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }

        function radiusToX(radius) {
            return topBox.x + ((radius - rMin) / (rMax - rMin)) * topBox.w;
        }

        drawGrid(topBox, 4, false);
        drawGrid(bottomBox, 4, true);
        plotPositiveSeries(topBox, fieldSeries, maxField, '#38bdf8');
        plotSignedSeries(bottomBox, outgoingSeries, maxFlux, '#34d399', false);
        plotSignedSeries(bottomBox, incomingSeries, maxFlux, '#f59e0b', false);
        plotSignedSeries(bottomBox, netSeries, maxFlux, '#e5e7eb', true);

        const markerX = radiusToX(currentRadius);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(markerX, topBox.y);
        ctx.lineTo(markerX, bottomBox.y + bottomBox.h);
        ctx.stroke();

        ctx.fillStyle = 'rgba(229, 237, 246, 0.9)';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText('Campo medio |B| en la superficie', topBox.x, topBox.y - 6);
        ctx.fillText('Flujos parciales y flujo neto', bottomBox.x, bottomBox.y - 6);
        ctx.fillText(formatScientific(maxField * 1e6, 1) + ' uT', 4, topBox.y + 8);
        ctx.fillText(formatScientific(maxFlux, 1) + ' Wb', 6, bottomBox.y + 8);
        ctx.fillText('0', 34, topBox.y + topBox.h);
        ctx.fillText('0', 34, bottomBox.y + bottomBox.h / 2 + 4);
        ctx.fillText('r (m)', width - 46, height - 8);
        ctx.fillText(currentRadius.toFixed(2), markerX - 12, height - 8);

        drawLegendSwatch(ctx, topBox.x + 8, topBox.y + 18, '#38bdf8', 'Campo');
        drawLegendSwatch(ctx, bottomBox.x + 8, bottomBox.y + 18, '#34d399', 'Sale');
        drawLegendSwatch(ctx, bottomBox.x + 102, bottomBox.y + 18, '#f59e0b', 'Entra');
        drawLegendSwatch(ctx, bottomBox.x + 206, bottomBox.y + 18, '#e5e7eb', 'Neto');

        state.graphDirty = false;
    }

    function animateScene(timestamp) {
        const time = timestamp * 0.001;
        if (state.three.magnetHalo) {
            const scale = (state.controls.configuration === 'split-magnets' ? 0.82 : 1) + 0.06 * Math.sin(time * 2.2);
            state.three.magnetHalo.scale.setScalar(scale);
            state.three.magnetHalo.material.opacity = 0.12 + 0.04 * Math.sin(time * 2.1);
        }
        if (state.three.magnetHaloSecondary && state.three.magnetHaloSecondary.visible) {
            state.three.magnetHaloSecondary.scale.setScalar(0.82 + 0.05 * Math.cos(time * 2.4));
            state.three.magnetHaloSecondary.material.opacity = 0.07 + 0.03 * Math.cos(time * 1.9);
        }
        if (state.three.gaussianSurface) {
            state.three.gaussianSurface.rotation.y = time * 0.14;
        }
        if (state.three.gaussianWire) {
            state.three.gaussianWire.rotation.y = -time * 0.12;
        }
        if (state.three.gaussianCubeSurface && state.three.gaussianCubeSurface.visible) {
            state.three.gaussianCubeSurface.rotation.x = time * 0.12;
            state.three.gaussianCubeSurface.rotation.y = time * 0.18;
        }
        if (state.three.gaussianCubeWire && state.three.gaussianCubeWire.visible) {
            state.three.gaussianCubeWire.rotation.x = time * 0.12;
            state.three.gaussianCubeWire.rotation.y = time * 0.18;
        }
        if (state.three.fieldLineGroup) {
            state.three.fieldLineGroup.rotation.y = time * 0.08;
            state.three.fieldLineGroup.children.forEach((line, index) => {
                line.material.opacity = 0.3 + 0.18 * Math.sin(time * 1.8 + index * 0.7);
            });
        }
    }

    function tick(timestamp) {
        if (!state.running) return;
        const dt = state.lastTs ? Math.min((timestamp - state.lastTs) / 1000, 0.05) : 0.016;
        state.lastTs = timestamp;
        if (state.simulationActive) {
            state.simulationPhase += dt * 1.65;
            state.needsUpdate = true;
            state.graphDirty = true;
        }
        if (state.needsUpdate) recomputeVisualization();
        syncFocusTarget();
        if (state.graphDirty && (!state.lastGraphDraw || (timestamp - state.lastGraphDraw) >= GRAPH_FRAME_MS)) {
            drawGraph();
            state.lastGraphDraw = timestamp;
        }
        animateScene(timestamp);

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
        state.dom.host = document.getElementById('gauss-law-canvas');
        state.dom.graphCanvas = document.getElementById('gauss-graph-canvas');
        state.dom.inputConfig = document.getElementById('gauss-config');
        state.dom.configLabel = document.getElementById('gauss-config-label');
        state.dom.simulateBtn = document.getElementById('gauss-simulate-btn');
        state.dom.simStatus = document.getElementById('gauss-sim-status');
        state.dom.selectionStatus = document.getElementById('gauss-selection-status');
        state.dom.inspectorNote = document.getElementById('gauss-inspector-note');
        state.dom.inputMoment = document.getElementById('gauss-moment');
        state.dom.inputRadius = document.getElementById('gauss-radius');
        state.dom.inputOffset = document.getElementById('gauss-offset');
        state.dom.inputSamples = document.getElementById('gauss-samples');
        state.dom.valMoment = document.getElementById('gauss-moment-val');
        state.dom.valRadius = document.getElementById('gauss-radius-val');
        state.dom.valOffset = document.getElementById('gauss-offset-val');
        state.dom.valSamples = document.getElementById('gauss-samples-val');
        state.dom.metricFluxTheory = document.getElementById('gauss-metric-flux-theory');
        state.dom.metricFluxNumeric = document.getElementById('gauss-metric-flux-numeric');
        state.dom.metricOutflux = document.getElementById('gauss-metric-outflux');
        state.dom.metricInflux = document.getElementById('gauss-metric-influx');
        state.dom.metricField = document.getElementById('gauss-metric-field');
        state.dom.metricArea = document.getElementById('gauss-metric-area');
        state.dom.equation = document.getElementById('gauss-equation');
        state.dom.liveEquation = document.getElementById('gauss-live-equation');

        bindControl(state.dom.inputMoment, () => {
            state.controls.moment = parseFloat(state.dom.inputMoment.value) || 120;
            updateControlLabels();
            state.needsUpdate = true;
        });
        bindControl(state.dom.inputRadius, () => {
            state.controls.radius = parseFloat(state.dom.inputRadius.value) || 1.4;
            updateControlLabels();
            state.needsUpdate = true;
        });
        bindControl(state.dom.inputOffset, () => {
            state.controls.offsetRatio = clamp(parseFloat(state.dom.inputOffset.value) || 0.25, 0, 0.6);
            updateControlLabels();
            state.needsUpdate = true;
        });
        bindControl(state.dom.inputSamples, () => {
            state.controls.samples = Math.round(parseFloat(state.dom.inputSamples.value) || 24);
            updateControlLabels();
            state.needsUpdate = true;
        });

        if (state.dom.inputConfig && !state.dom.inputConfig.dataset.bound) {
            state.dom.inputConfig.dataset.bound = 'true';
            state.dom.inputConfig.addEventListener('change', () => {
                state.controls.configuration = state.dom.inputConfig.value || 'offset-sphere';
                state.simulationPhase = 0;
                state.needsUpdate = true;
                state.graphDirty = true;
                updateScenarioUi();
            });
        }

        if (state.dom.simulateBtn && !state.dom.simulateBtn.dataset.bound) {
            state.dom.simulateBtn.dataset.bound = 'true';
            state.dom.simulateBtn.addEventListener('click', () => {
                state.simulationActive = !state.simulationActive;
                state.graphDirty = true;
                updateScenarioUi();
            });
        }

        if (!window.__gaussLawResizeBound) {
            window.addEventListener('resize', () => {
                resizeThree();
                state.graphDirty = true;
                state.needsUpdate = true;
            });
            window.__gaussLawResizeBound = true;
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
            state.dom.host = document.getElementById('gauss-law-canvas');
            state.dom.graphCanvas = document.getElementById('gauss-graph-canvas');
        }

        updateControlLabels();
        updateScenarioUi();
        renderEquation();
        state.needsUpdate = true;
        state.graphDirty = true;
        recomputeVisualization();
        if (state.graphDirty) drawGraph();

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

    window.initGaussLaw3D = init;
    window.stopGaussLaw3D = stop;
})();

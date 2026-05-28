// ================================================================
// SDOF SIMULATOR — Interactive 1-DOF Structural Dynamics
// Solves: mÿ + cẏ + ky = -m·üg(t) using Newmark-beta
// With Chart.js streaming graphs, hover-sync highlighting, and GSAP
// ================================================================
(function () {
    'use strict';

    let sdof = {
        animId: null,
        running: false,
        ugDispArr: null,
        // Structural parameters
        mass: 1000,       // kg
        damping: 500,     // N·s/m
        stiffness: 40000, // N/m
        // Derived
        wn: 0, zeta: 0, Tn: 0, wd: 0,
        // Simulation state
        simulating: false,
        simTime: 0,
        dt: 0.01,      // time step (s)
        totalTime: 20,  // total simulation time (s)
        /** 1 = tiempo de simulación igual al reloj real (ticker constante) */
        playbackSpeed: 1,
        /** Ventana visible del sismógrafo (s): la traza avanza hacia la derecha */
        streamWindowSec: 7,
        _simClock: 0,
        _playbackLastRealMs: null,
        _playbackTickFn: null,
        /** Daño estructural: superado |y| umbral → traza verde errática (3D puede leer flag) */
        responseDamageLatched: false,
        failYThreshold: 0.08,
        chaosAmp: 0.055,
        _chaosSeed: 0,
        // Results arrays
        tArr: [],
        ugArr: [],   // ground acceleration
        yArr: [],    // displacement response
        vArr: [],    // velocity
        aArr: [],    // acceleration
        // Chart.js instances
        chartGround: null,
        chartResponse: null,
        // Índice siguiente a volcar en gráficos (0..N); mantiene compat con currentStep histórico
        currentStep: 0,
        totalSteps: 0,
        magnitude: 5.0,
        /** Valores mostrados en KaTeX (tween GSAP); m,c,k del solver miran siempre el input. */
        displayEq: { m: 1000, c: 500, k: 40000 },
        _eqDisplayRaf: 0,
    };

    // ── PUBLIC API ──
    window.initSDOFSimulator = function () {
        if (sdof.running) return;

        const canvas1 = document.getElementById('sdof-ground-canvas');
        const canvas2 = document.getElementById('sdof-response-canvas');
        if (!canvas1 || !canvas2) return;

        // Initialize Chart.js charts
        initCharts(canvas1, canvas2);

        // Read initial params
        readParams();
        sdof.displayEq.m = sdof.mass;
        sdof.displayEq.c = sdof.damping;
        sdof.displayEq.k = sdof.stiffness;
        updateDerived();
        renderEquation();

        sdof.running = true;

        // Wire input events with hover-sync + GSAP
        setupHoverSync();
        wireInputEvents();
    };

    window.stopSDOFSimulator = function () {
        sdof.running = false;
        stopPlaybackDriver();
        if (sdof.animId) cancelAnimationFrame(sdof.animId);
        if (sdof.chartGround) { sdof.chartGround.destroy(); sdof.chartGround = null; }
        if (sdof.chartResponse) { sdof.chartResponse.destroy(); sdof.chartResponse = null; }
    };

    window.triggerSDOFSimulation = function () {
        if (!sdof.running) return;

        const magEl = document.getElementById('quake-magnitude');
        if (magEl) sdof.magnitude = parseFloat(magEl.value);

        readParams();
        sdof.displayEq.m = sdof.mass;
        sdof.displayEq.c = sdof.damping;
        sdof.displayEq.k = sdof.stiffness;
        if (typeof gsap !== 'undefined') gsap.killTweensOf(sdof.displayEq);
        updateDerived();
        renderEquation();

        generateGroundMotion();
        solve();

        let yPeak = 0;
        for (let i = 0; i < sdof.totalSteps; i++) {
            yPeak = Math.max(yPeak, Math.abs(sdof.yArr[i]));
        }
        sdof.failYThreshold = Math.max(0.055, yPeak * 0.36);

        sdof.currentStep = 0;
        sdof._simClock = 0;
        sdof._playbackLastRealMs = null;
        sdof.responseDamageLatched = false;
        sdof._chaosSeed = Math.random() * 1000;
        window.__sdofStructuralDamage = false;
        sdof.simulating = true;
        clearCharts();
        applyStreamingTimeWindow(0, true);
        startPlaybackDriver();
    };

    // ── CHART.JS INITIALIZATION ──
    function initCharts(canvas1, canvas2) {
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
            },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: 7,
                    title: {
                        display: true,
                        text: 'Tiempo (s)',
                        color: 'rgba(0,0,0,0.7)',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                    },
                    ticks: {
                        color: 'rgba(0,0,0,0.6)',
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        maxTicksLimit: 10,
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.06)',
                        lineWidth: 1,
                    },
                    border: { color: 'rgba(0,0,0,0.1)' },
                },
                y: {
                    title: {
                        display: true,
                        color: 'rgba(0,0,0,0.7)',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                    },
                    ticks: {
                        color: 'rgba(0,0,0,0.6)',
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        maxTicksLimit: 6,
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.06)',
                        lineWidth: 1,
                    },
                    border: { color: 'rgba(0,0,0,0.1)' },
                },
            },
            elements: {
                point: { radius: 0 },
                line: { tension: 0.15 },
            },
        };

        // Ground acceleration chart (Red/Orange)
        sdof.chartGround = new Chart(canvas1.getContext('2d'), {
            type: 'line',
            data: {
                datasets: [{
                    data: [],
                    borderColor: '#dc2f02',
                    borderWidth: 2,
                    backgroundColor: 'rgba(220, 47, 2, 0.05)',
                    fill: true,
                }, {
                    data: [],
                    borderColor: '#ffffff',
                    borderWidth: 0,
                    pointRadius: 5,
                    pointBackgroundColor: '#dc2f02',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1.5,
                }],
            },
            options: {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        title: { ...commonOptions.scales.y.title, text: 'üg(t) [m/s²]' },
                    },
                },
            },
        });

        // Structural response chart (Dark Navy)
        sdof.chartResponse = new Chart(canvas2.getContext('2d'), {
            type: 'line',
            data: {
                datasets: [{
                    data: [],
                    borderColor: '#03045e',
                    borderWidth: 2,
                    backgroundColor: 'rgba(3, 4, 94, 0.05)',
                    fill: true,
                }, {
                    data: [],
                    borderColor: '#ffffff',
                    borderWidth: 0,
                    pointRadius: 5,
                    pointBackgroundColor: '#03045e',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1.5,
                }],
            },
            options: {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        title: { ...commonOptions.scales.y.title, text: 'y(t) [m]' },
                    },
                },
            },
        });
    }

    function clearCharts() {
        if (sdof.chartGround) {
            sdof.chartGround.data.datasets[0].data = [];
            sdof.chartGround.data.datasets[1].data = [];
            sdof.chartGround.update('none');
        }
        if (sdof.chartResponse) {
            sdof.chartResponse.data.datasets[0].data = [];
            sdof.chartResponse.data.datasets[1].data = [];
            sdof.chartResponse.update('none');
        }
    }

    function stopPlaybackDriver() {
        if (sdof._playbackTickFn && typeof gsap !== 'undefined') {
            gsap.ticker.remove(sdof._playbackTickFn);
        }
        sdof._playbackTickFn = null;
        if (sdof.animId) {
            cancelAnimationFrame(sdof.animId);
            sdof.animId = null;
        }
    }

    /** Eje X tipo cinta: tiempo crece hacia la derecha; ventana desliza cuando t > streamWindow */
    function applyStreamingTimeWindow(tNow, isInitial) {
        const w = sdof.streamWindowSec;
        let xmin, xmax;
        if (tNow <= w) {
            xmin = 0;
            xmax = w;
        } else {
            xmin = tNow - w;
            xmax = tNow;
        }
        [sdof.chartGround, sdof.chartResponse].forEach(ch => {
            if (!ch) return;
            ch.options.scales.x.min = xmin;
            ch.options.scales.x.max = xmax;
        });
        if (isInitial && sdof.chartGround) {
            sdof.chartGround.update('none');
            if (sdof.chartResponse) sdof.chartResponse.update('none');
        }
    }

    function growYRangeFromVisibleCharts() {
        const w = sdof.streamWindowSec;
        const g = sdof.chartGround, r = sdof.chartResponse;
        if (!g || !r) return;
        const tMax = r.data.datasets[0].data.length
            ? r.data.datasets[0].data[r.data.datasets[0].data.length - 1].x
            : 0;
        const tMin = Math.max(0, tMax - w);
        let maxG = 1e-6, maxR = 1e-6;
        g.data.datasets[0].data.forEach(p => {
            if (p.x >= tMin && p.x <= tMax) maxG = Math.max(maxG, Math.abs(p.y));
        });
        r.data.datasets[0].data.forEach(p => {
            if (p.x >= tMin && p.x <= tMax) maxR = Math.max(maxR, Math.abs(p.y));
        });
        const padG = maxG * 0.12 + 0.05;
        const padR = maxR * 0.15 + 0.002;
        g.options.scales.y.min = -maxG - padG;
        g.options.scales.y.max = maxG + padG;
        r.options.scales.y.min = -maxR - padR;
        r.options.scales.y.max = maxR + padR;
    }

    function plotResponseY(i) {
        const yRaw = sdof.yArr[i];
        if (Math.abs(yRaw) > sdof.failYThreshold) {
            sdof.responseDamageLatched = true;
            window.__sdofStructuralDamage = true;
        }
        if (!sdof.responseDamageLatched) return yRaw;
        const seed = sdof._chaosSeed + i * 0.37;
        const n1 = Math.sin(seed * 12.9898) * 43758.5453;
        const rnd = n1 - Math.floor(n1);
        const n2 = Math.sin((seed + 1) * 78.233) * 12345.6789;
        const rnd2 = n2 - Math.floor(n2);
        const grow = 1 + i * 0.018;
        return yRaw
            + (rnd - 0.5) * sdof.chaosAmp * grow * 2.2
            + (rnd2 - 0.5) * sdof.chaosAmp * grow
            + Math.sin(i * 1.13 + sdof._chaosSeed) * sdof.chaosAmp * 0.85 * grow;
    }

    function appendStreamSample(i) {
        const t = sdof.tArr[i];
        const ug = sdof.ugArr[i];
        const y = plotResponseY(i);

        sdof.chartGround.data.datasets[0].data.push({ x: t, y: ug });
        sdof.chartResponse.data.datasets[0].data.push({ x: t, y: y });

        sdof.chartGround.data.datasets[1].data = [{ x: t, y: ug }];
        sdof.chartResponse.data.datasets[1].data = [{ x: t, y: y }];

        applyStreamingTimeWindow(t, false);
        growYRangeFromVisibleCharts();

        if (typeof window.__applySDOF3DPlayback === 'function' && sdof.ugDispArr) {
            window.__applySDOF3DPlayback(sdof.ugDispArr[i], sdof.yArr[i]);
        }

        sdof.chartGround.update('none');
        sdof.chartResponse.update('none');
    }

    function finishPlayback() {
        sdof.simulating = false;
        stopPlaybackDriver();
        window.__sdofStructuralDamage = false;
        if (sdof.chartGround) sdof.chartGround.data.datasets[1].data = [];
        if (sdof.chartResponse) sdof.chartResponse.data.datasets[1].data = [];
        if (sdof.chartGround) sdof.chartGround.update('none');
        if (sdof.chartResponse) sdof.chartResponse.update('none');
        if (typeof window.__sdof3dPlaybackEnd === 'function') window.__sdof3dPlaybackEnd();
    }

    function playbackTick() {
        if (!sdof.running || !sdof.simulating) return;

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (sdof._playbackLastRealMs == null) sdof._playbackLastRealMs = now;
        let dtReal = (now - sdof._playbackLastRealMs) / 1000;
        sdof._playbackLastRealMs = now;
        if (dtReal > 0.25) dtReal = 0.25;

        sdof._simClock += dtReal * sdof.playbackSpeed;

        while (
            sdof.currentStep < sdof.totalSteps
            && sdof._simClock >= sdof.currentStep * sdof.dt
        ) {
            appendStreamSample(sdof.currentStep);
            sdof.currentStep++;
        }

        updatePeakDisplay();

        if (sdof.currentStep >= sdof.totalSteps) {
            finishPlayback();
        }
    }

    function startPlaybackDriver() {
        stopPlaybackDriver();
        sdof._playbackTickFn = playbackTick;
        if (typeof gsap !== 'undefined' && gsap.ticker) {
            gsap.ticker.add(playbackTick);
        } else {
            function rafLoop() {
                if (!sdof.simulating || !sdof.running) return;
                playbackTick();
                sdof.animId = requestAnimationFrame(rafLoop);
            }
            sdof.animId = requestAnimationFrame(rafLoop);
        }
    }

    // ── HOVER / FOCUS SYNC — ecuación simbólica + con valores (m verde, k azul) ──
    function setupHoverSync() {
        const params = document.querySelectorAll('.sdof-param[data-eq-var]');
        const eqCards = [
            document.getElementById('sdof-live-eq-card'),
            document.getElementById('sdof-general-eq-card'),
        ].filter(Boolean);

        function addHl(v) {
            eqCards.forEach(c => c.classList.add('sdof-eq-highlight-' + v));
        }
        function remHl(v) {
            eqCards.forEach(c => c.classList.remove('sdof-eq-highlight-' + v));
        }

        params.forEach(param => {
            const varName = param.getAttribute('data-eq-var');
            const input = param.querySelector('input');

            param.addEventListener('mouseenter', () => {
                addHl(varName);
                param.classList.add('sdof-param-active');
            });

            param.addEventListener('mouseleave', () => {
                if (input && document.activeElement === input) return;
                remHl(varName);
                param.classList.remove('sdof-param-active');
            });

            if (input) {
                input.addEventListener('focus', () => {
                    addHl(varName);
                    param.classList.add('sdof-param-active');
                });
                input.addEventListener('blur', () => {
                    remHl(varName);
                    param.classList.remove('sdof-param-active');
                });
            }
        });

        const kInput = document.getElementById('sdof-stiffness');
        if (kInput) {
            kInput.addEventListener('input', () => {
                eqCards.forEach(card => {
                    card.classList.remove('sdof-eq-pulse-k');
                    void card.offsetWidth;
                    card.classList.add('sdof-eq-pulse-k');
                    setTimeout(() => card.classList.remove('sdof-eq-pulse-k'), 900);
                });
            });
        }
    }

    // ── WIRE INPUT EVENTS ──
    function wireInputEvents() {
        ['sdof-mass', 'sdof-damping', 'sdof-stiffness'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    const oldWn = sdof.wn, oldZeta = sdof.zeta, oldTn = sdof.Tn;
                    readParams();
                    updateDerived();

                    if (typeof gsap !== 'undefined') {
                        gsap.killTweensOf(sdof.displayEq);
                        if (sdof._eqDisplayRaf) {
                            cancelAnimationFrame(sdof._eqDisplayRaf);
                            sdof._eqDisplayRaf = 0;
                        }
                        gsap.to(sdof.displayEq, {
                            m: sdof.mass,
                            c: sdof.damping,
                            k: sdof.stiffness,
                            duration: 0.48,
                            ease: 'power2.out',
                            overwrite: true,
                            onUpdate: scheduleLiveEquationRender,
                            onComplete: () => {
                                if (sdof._eqDisplayRaf) {
                                    cancelAnimationFrame(sdof._eqDisplayRaf);
                                    sdof._eqDisplayRaf = 0;
                                }
                                renderLiveEquationNumbers();
                            },
                        });
                        animateDerivedValue('sdof-wn', oldWn, sdof.wn, 2);
                        animateDerivedValue('sdof-zeta', oldZeta, sdof.zeta, 3);
                        animateDerivedValue('sdof-Tn', oldTn, sdof.Tn, 3);
                        renderEquationFreeFormOnly();
                    } else {
                        sdof.displayEq.m = sdof.mass;
                        sdof.displayEq.c = sdof.damping;
                        sdof.displayEq.k = sdof.stiffness;
                        renderEquation();
                    }

                    if (sdof.tArr.length > 0) {
                        sdof.simulating = false;
                        stopPlaybackDriver();
                        solve();
                        sdof.currentStep = sdof.totalSteps;
                        updateChartsFullData();
                    }
                });
            }
        });
    }

    function animateDerivedValue(elId, from, to, decimals) {
        const el = document.getElementById(elId);
        if (!el || typeof gsap === 'undefined') return;

        const obj = { val: from };
        gsap.to(obj, {
            val: to,
            duration: 0.5,
            ease: 'power2.out',
            onUpdate: () => {
                el.textContent = obj.val.toFixed(decimals);
            },
        });
    }

    // ── READ PARAMS ──
    function readParams() {
        const mEl = document.getElementById('sdof-mass');
        const cEl = document.getElementById('sdof-damping');
        const kEl = document.getElementById('sdof-stiffness');
        if (mEl) sdof.mass = Math.max(1, parseFloat(mEl.value) || 1000);
        if (cEl) sdof.damping = Math.max(0, parseFloat(cEl.value) || 500);
        if (kEl) sdof.stiffness = Math.max(1, parseFloat(kEl.value) || 40000);
    }

    // ── DERIVED QUANTITIES ──
    function updateDerived() {
        const m = sdof.mass, c = sdof.damping, k = sdof.stiffness;
        sdof.wn = Math.sqrt(k / m);
        sdof.zeta = c / (2 * Math.sqrt(m * k));
        sdof.Tn = (2 * Math.PI) / sdof.wn;
        sdof.wd = sdof.wn * Math.sqrt(Math.max(0, 1 - sdof.zeta * sdof.zeta));

        // Update derived display (immediate, GSAP will override if available)
        const wnEl = document.getElementById('sdof-wn');
        const zetaEl = document.getElementById('sdof-zeta');
        const TnEl = document.getElementById('sdof-Tn');
        if (wnEl && typeof gsap === 'undefined') wnEl.textContent = sdof.wn.toFixed(2);
        if (zetaEl && typeof gsap === 'undefined') zetaEl.textContent = sdof.zeta.toFixed(3);
        if (TnEl && typeof gsap === 'undefined') TnEl.textContent = sdof.Tn.toFixed(3);

        // Color the zeta indicator
        if (zetaEl) {
            if (sdof.zeta < 0.05) zetaEl.style.color = '#ef4444';
            else if (sdof.zeta < 0.3) zetaEl.style.color = '#f59e0b';
            else if (sdof.zeta <= 1.0) zetaEl.style.color = '#22c55e';
            else zetaEl.style.color = '#3b82f6';
        }
    }

    function scheduleLiveEquationRender() {
        if (sdof._eqDisplayRaf) return;
        sdof._eqDisplayRaf = requestAnimationFrame(() => {
            sdof._eqDisplayRaf = 0;
            renderLiveEquationNumbers();
        });
    }

    function formatEqInt(v) {
        return Math.round(v).toString();
    }

    /** Solo la tarjeta “Con tus valores”: números suavizados (displayEq), sin re-rendir el resto. */
    function renderLiveEquationNumbers() {
        const eqEl = document.getElementById('sdof-equation');
        if (!eqEl || typeof katex === 'undefined') return;

        const m = formatEqInt(sdof.displayEq.m);
        const c = formatEqInt(sdof.displayEq.c);
        const k = formatEqInt(sdof.displayEq.k);

        const latex = `\\htmlClass{eq-var-m}{${m}}\\,\\ddot{y} + \\htmlClass{eq-var-c}{${c}}\\,\\dot{y} + \\htmlClass{eq-var-k}{${k}}\\,y = -\\htmlClass{eq-var-m}{${m}}\\,\\ddot{u}_g(t)`;

        try {
            katex.render(latex, eqEl, {
                displayMode: true,
                throwOnError: false,
                trust: true,
            });
        } catch (e) {
            try {
                const fallback = `${m}\\,\\ddot{y} + ${c}\\,\\dot{y} + ${k}\\,y = -${m}\\,\\ddot{u}_g(t)`;
                katex.render(fallback, eqEl, { displayMode: true, throwOnError: false });
            } catch (e2) { }
        }
    }

    function renderEquationGeneralOnly() {
        const genEl = document.getElementById('sdof-equation-general');
        if (!genEl || typeof katex === 'undefined') return;

        try {
            katex.render(
                '\\htmlClass{eq-var-m}{m}\\,\\ddot{y} + \\htmlClass{eq-var-c}{c}\\,\\dot{y} + \\htmlClass{eq-var-k}{k}\\,y = -\\htmlClass{eq-var-m}{m}\\,\\ddot{u}_g(t)',
                genEl,
                { displayMode: true, throwOnError: false, trust: true }
            );
        } catch (e) {
            try {
                katex.render('m\\,\\ddot{y} + c\\,\\dot{y} + k\\,y = -m\\,\\ddot{u}_g(t)', genEl, { displayMode: true, throwOnError: false });
            } catch (e2) { }
        }
    }

    /** Forma normalizada: usa siempre ωₙ, ζ según parámetros reales (simulación fiel). */
    function renderEquationFreeFormOnly() {
        const freeEl = document.getElementById('sdof-equation-free');
        if (!freeEl || typeof katex === 'undefined') return;

        const wnStr = sdof.wn.toFixed(2);
        const zetaStr = sdof.zeta.toFixed(3);
        try {
            katex.render(
                `\\ddot{y} + 2(${zetaStr})(${wnStr})\\dot{y} + (${wnStr})^2 y = 0`,
                freeEl,
                { displayMode: true, throwOnError: false }
            );
        } catch (e) { }
    }

    function renderEquation() {
        renderLiveEquationNumbers();
        renderEquationGeneralOnly();
        renderEquationFreeFormOnly();
    }

    // ── GENERATE GROUND MOTION ──
    function generateGroundMotion() {
        const N = Math.floor(sdof.totalTime / sdof.dt);
        sdof.totalSteps = N;
        sdof.tArr = new Float64Array(N);
        sdof.ugArr = new Float64Array(N);

        const mag = sdof.magnitude;
        const amp = Math.pow(10, (mag - 4) * 0.5) * 0.5;

        for (let i = 0; i < N; i++) {
            const t = i * sdof.dt;
            sdof.tArr[i] = t;

            let envelope = 0;
            if (t < 1) envelope = t;
            else if (t < 3) envelope = 1;
            else if (t < 5) envelope = Math.exp(-(t - 3) * 0.8);
            else if (t < 7) envelope = Math.exp(-(t - 5) * 0.3) * 1.5;
            else if (t < 12) envelope = Math.exp(-(t - 7) * 0.4) * 0.8;
            else envelope = Math.exp(-(t - 12) * 1.5) * 0.3;

            let signal = 0;
            signal += Math.sin(2 * Math.PI * 1.2 * t + 0.3) * 0.4;
            signal += Math.sin(2 * Math.PI * 2.8 * t + 1.1) * 0.6;
            signal += Math.sin(2 * Math.PI * 5.5 * t + 2.7) * 0.3;
            signal += Math.sin(2 * Math.PI * 0.7 * t + 0.8) * 0.5;
            signal += Math.sin(2 * Math.PI * 8.3 * t + 4.2) * 0.15;
            signal += (Math.random() - 0.5) * 0.6;

            sdof.ugArr[i] = amp * envelope * signal;
        }

        sdof.ugDispArr = new Float64Array(N);
        let vg = 0, uDisp = 0;
        for (let i = 0; i < N; i++) {
            vg += sdof.ugArr[i] * sdof.dt;
            uDisp += vg * sdof.dt;
            sdof.ugDispArr[i] = uDisp;
        }
    }

    // ── NEWMARK-BETA SOLVER ──
    function solve() {
        const N = sdof.totalSteps;
        const m = sdof.mass, c = sdof.damping, k = sdof.stiffness;
        const dt = sdof.dt;

        sdof.yArr = new Float64Array(N);
        sdof.vArr = new Float64Array(N);
        sdof.aArr = new Float64Array(N);

        sdof.yArr[0] = 0;
        sdof.vArr[0] = 0;
        sdof.aArr[0] = (-m * sdof.ugArr[0] - c * sdof.vArr[0] - k * sdof.yArr[0]) / m;

        const gamma = 0.5;
        const beta = 0.25;

        const a1 = 1 / (beta * dt * dt);
        const a2 = gamma / (beta * dt);
        const a3 = 1 / (beta * dt);
        const a4 = 1 / (2 * beta) - 1;
        const a5 = gamma / beta - 1;
        const a6 = (dt / 2) * (gamma / beta - 2);

        const kEff = k + a1 * m + a2 * c;

        for (let i = 0; i < N - 1; i++) {
            const dP = -m * (sdof.ugArr[i + 1] - sdof.ugArr[i])
                + m * (a3 * sdof.vArr[i] + a4 * sdof.aArr[i])
                + c * (a5 * sdof.vArr[i] + a6 * sdof.aArr[i]);

            const dy = dP / kEff;

            sdof.yArr[i + 1] = sdof.yArr[i] + dy;
            sdof.vArr[i + 1] = a2 * dy - a5 * sdof.vArr[i] - a6 * sdof.aArr[i];
            sdof.aArr[i + 1] = a1 * dy - a3 * sdof.vArr[i] - a4 * sdof.aArr[i];
        }
    }

    // ── UPDATE CHARTS WITH FULL DATA (after re-solve) ──
    function updateChartsFullData() {
        if (!sdof.chartGround || !sdof.chartResponse) return;
        const steps = sdof.currentStep;
        if (steps < 2) return;

        sdof.responseDamageLatched = false;
        window.__sdofStructuralDamage = false;
        const gData = [], rData = [];
        for (let i = 0; i < steps; i++) {
            gData.push({ x: sdof.tArr[i], y: sdof.ugArr[i] });
            rData.push({ x: sdof.tArr[i], y: plotResponseY(i) });
        }

        sdof.chartGround.data.datasets[0].data = gData;
        sdof.chartGround.data.datasets[1].data = [];
        sdof.chartResponse.data.datasets[0].data = rData;
        sdof.chartResponse.data.datasets[1].data = [];

        sdof.chartGround.options.scales.x.min = 0;
        sdof.chartGround.options.scales.x.max = sdof.totalTime;
        sdof.chartResponse.options.scales.x.min = 0;
        sdof.chartResponse.options.scales.x.max = sdof.totalTime;

        let maxG = 1e-6, maxR = 1e-6;
        gData.forEach(p => { maxG = Math.max(maxG, Math.abs(p.y)); });
        rData.forEach(p => { maxR = Math.max(maxR, Math.abs(p.y)); });
        const padG = maxG * 0.1 + 0.05;
        const padR = maxR * 0.12 + 0.002;
        sdof.chartGround.options.scales.y.min = -maxG - padG;
        sdof.chartGround.options.scales.y.max = maxG + padG;
        sdof.chartResponse.options.scales.y.min = -maxR - padR;
        sdof.chartResponse.options.scales.y.max = maxR + padR;

        sdof.chartGround.update('none');
        sdof.chartResponse.update('none');
    }

    // ── PEAK DISPLAY ──
    function updatePeakDisplay() {
        const n = sdof.currentStep;
        if (n < 1) return;

        let peakY = 0, peakV = 0, peakA = 0;
        for (let i = 0; i < n; i++) {
            if (Math.abs(sdof.yArr[i]) > Math.abs(peakY)) peakY = sdof.yArr[i];
            if (Math.abs(sdof.vArr[i]) > Math.abs(peakV)) peakV = sdof.vArr[i];
            if (Math.abs(sdof.aArr[i]) > Math.abs(peakA)) peakA = sdof.aArr[i];
        }

        const peakEl = document.getElementById('sdof-peaks');
        if (peakEl) {
            peakEl.innerHTML = `
                <span><b>y_max</b> ${peakY.toFixed(4)} m</span>
                <span><b>ẏ_max</b> ${peakV.toFixed(3)} m/s</span>
                <span><b>ÿ_max</b> ${peakA.toFixed(2)} m/s²</span>
                <span><b>t</b> ${(sdof.tArr[n - 1] || 0).toFixed(1)} s</span>
            `;
        }
    }

})();

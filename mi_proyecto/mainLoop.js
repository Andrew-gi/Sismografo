// ================================================================
// mainLoop.js — Loop principal que conecta inputs → solver → 3D
//
//   Orquesta:
//     1. Lee inputs HTML (m, c, k, magnitud)
//     2. GSAP suaviza las transiciones de los inputs (visual)
//     3. SeismicSolver calcula la física pura (sin GSAP)
//     4. scene3d.update() mueve el cubo
//
//   Dependencias:
//     • SeismicSolver.js  (clase SeismicSolver)
//     • scene3d.js        (función init3DScene)
//     • Three.js          (window.THREE)
//     • GSAP              (window.gsap) — opcional pero recomendado
//
//   Uso:
//     <script src="SeismicSolver.js"></script>
//     <script src="scene3d.js"></script>
//     <script src="mainLoop.js"></script>
//     <script>
//         startMainLoop({
//             canvasId:    'sim-canvas',
//             massId:      'sdof-mass',
//             dampingId:   'sdof-damping',
//             stiffnessId: 'sdof-stiffness',
//             magnitudeId: 'quake-magnitude',
//             startBtnId:  'btn-simular',
//         });
//     </script>
// ================================================================

(function () {
    'use strict';

    // ── Estado global del loop ──
    const state = {
        running:   false,
        animId:    null,
        scene3d:   null,
        solver:    null,

        // Simulación activa (sismo en progreso)
        simActiva: false,
        simClock:  0,            // reloj de la simulación (s)
        dtSolver:  0.01,         // paso del integrador (s)
        lastFrameMs: null,

        // Velocidad de playback (1 = tiempo real)
        playbackSpeed: 1,

        // Escala para convertir desplazamiento (m) → unidades 3D
        dispScale: 40,

        // ── Valores crudos de los inputs ──
        raw: { m: 1000, c: 500, k: 40000, mag: 5.0 },

        // ── Valores suavizados por GSAP (para mostrar en UI) ──
        smooth: { m: 1000, c: 500, k: 40000, mag: 5.0 },

        // ── IDs de los elementos HTML ──
        ids: {
            canvas:    'sim-canvas',
            mass:      'sdof-mass',
            damping:   'sdof-damping',
            stiffness: 'sdof-stiffness',
            magnitude: 'quake-magnitude',
            startBtn:  'btn-simular',
            // Opcionales para feedback visual
            displayM:  'display-m',
            displayC:  'display-c',
            displayK:  'display-k',
            displayT:  'display-time',
            displayY:  'display-y',
            displayVy: 'display-vy',
        },

        // Callbacks opcionales
        onStep:  null,   // (estado) => void   — llamado en cada paso del solver
        onStart: null,   // () => void          — al iniciar simulación
        onEnd:   null,   // () => void          — al terminar simulación
    };

    // ────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ────────────────────────────────────────────────────────────────

    /**
     * Arranca el loop principal.
     *
     * @param {object} config
     * @param {string} config.canvasId     — ID del <canvas> para Three.js
     * @param {string} [config.massId]     — ID del input de masa
     * @param {string} [config.dampingId]  — ID del input de amortiguamiento
     * @param {string} [config.stiffnessId]— ID del input de rigidez
     * @param {string} [config.magnitudeId]— ID del input/slider de magnitud
     * @param {string} [config.startBtnId] — ID del botón "Simular"
     * @param {number} [config.dtSolver]   — Paso del integrador (default 0.01)
     * @param {number} [config.dispScale]  — Factor de escala desp→3D (default 40)
     * @param {number} [config.playbackSpeed] — Velocidad de playback (default 1)
     * @param {function} [config.onStep]   — Callback por paso
     * @param {function} [config.onStart]  — Callback al iniciar sismo
     * @param {function} [config.onEnd]    — Callback al terminar sismo
     */
    window.startMainLoop = function (config = {}) {
        if (state.running) {
            console.warn('mainLoop ya está corriendo. Usa stopMainLoop() primero.');
            return;
        }

        // Fusionar IDs personalizados
        if (config.canvasId)    state.ids.canvas    = config.canvasId;
        if (config.massId)      state.ids.mass      = config.massId;
        if (config.dampingId)   state.ids.damping   = config.dampingId;
        if (config.stiffnessId) state.ids.stiffness = config.stiffnessId;
        if (config.magnitudeId) state.ids.magnitude = config.magnitudeId;
        if (config.startBtnId)  state.ids.startBtn  = config.startBtnId;
        if (config.displayM)    state.ids.displayM  = config.displayM;
        if (config.displayC)    state.ids.displayC  = config.displayC;
        if (config.displayK)    state.ids.displayK  = config.displayK;
        if (config.displayT)    state.ids.displayT  = config.displayT;
        if (config.displayY)    state.ids.displayY  = config.displayY;
        if (config.displayVy)   state.ids.displayVy = config.displayVy;

        if (config.dtSolver)       state.dtSolver       = config.dtSolver;
        if (config.dispScale)      state.dispScale       = config.dispScale;
        if (config.playbackSpeed)  state.playbackSpeed   = config.playbackSpeed;
        if (config.onStep)         state.onStep          = config.onStep;
        if (config.onStart)        state.onStart         = config.onStart;
        if (config.onEnd)          state.onEnd           = config.onEnd;

        // ── Inicializar escena 3D ──
        const canvas = document.getElementById(state.ids.canvas);
        if (!canvas) {
            console.error(`mainLoop: no se encontró <canvas id="${state.ids.canvas}">`);
            return;
        }
        state.scene3d = init3DScene(canvas);

        // ── Leer inputs iniciales ──
        _readRawInputs();
        // Copiar valores crudos a smooth (sin animación inicial)
        state.smooth.m   = state.raw.m;
        state.smooth.c   = state.raw.c;
        state.smooth.k   = state.raw.k;
        state.smooth.mag = state.raw.mag;

        // ── Escuchar cambios en inputs con GSAP tween ──
        _wireInputListeners();

        // ── Botón de iniciar simulación ──
        const btn = document.getElementById(state.ids.startBtn);
        if (btn) {
            btn.addEventListener('click', _triggerSimulation);
        }

        // ── Arrancar loop ──
        state.running = true;
        state.lastFrameMs = null;
        _loop();
    };

    /**
     * Detiene el loop y libera recursos.
     */
    window.stopMainLoop = function () {
        state.running = false;
        state.simActiva = false;

        if (state.animId) {
            cancelAnimationFrame(state.animId);
            state.animId = null;
        }

        if (state.scene3d) {
            state.scene3d.dispose();
            state.scene3d = null;
        }

        state.solver = null;
    };

    /**
     * Inicia (o reinicia) la simulación sísmica con los parámetros actuales.
     * Puede llamarse desde fuera: window.triggerMainSimulation()
     */
    window.triggerMainSimulation = _triggerSimulation;

    // ────────────────────────────────────────────────────────────────
    // LOOP PRINCIPAL (requestAnimationFrame)
    // ────────────────────────────────────────────────────────────────

    function _loop() {
        if (!state.running) return;
        state.animId = requestAnimationFrame(_loop);

        const now = performance.now();
        if (state.lastFrameMs === null) state.lastFrameMs = now;

        let dtReal = (now - state.lastFrameMs) / 1000; // segundos reales
        state.lastFrameMs = now;

        // Clamp para evitar saltos tras minimizar o pausas
        if (dtReal > 0.25) dtReal = 0.25;

        // ── Actualizar displays suavizados (UI feedback) ──
        _updateSmoothDisplays();

        // ── Si hay simulación activa, avanzar el solver ──
        if (state.simActiva && state.solver) {
            // Avanzar el reloj de simulación al ritmo del playback
            state.simClock += dtReal * state.playbackSpeed;

            const dt = state.dtSolver;
            const tMax = state.solver.registroSismo.length * state.solver.dtRegistro;

            // Ejecutar todos los pasos del solver que correspondan
            // según el tiempo transcurrido
            while (state.solver.t + dt <= state.simClock && state.solver.t < tMax) {
                const resultado = state.solver.step(dt);

                // Callback opcional por paso
                if (state.onStep) state.onStep(resultado);
            }

            // Obtener desplazamiento actual y pasarlo al 3D
            const yActual = state.solver.y;
            state.scene3d.update(yActual * state.dispScale);

            // Actualizar displays de estado
            _updateStateDisplays();

            // ¿Terminó el registro?
            if (state.solver.t >= tMax) {
                state.simActiva = false;
                if (state.onEnd) state.onEnd();
            }

        } else {
            // Sin simulación: cubo en reposo (posición 0)
            // (se podría añadir un idle sutil aquí)
        }
    }

    // ────────────────────────────────────────────────────────────────
    // LECTURA DE INPUTS
    // ────────────────────────────────────────────────────────────────

    function _readRawInputs() {
        const mEl  = document.getElementById(state.ids.mass);
        const cEl  = document.getElementById(state.ids.damping);
        const kEl  = document.getElementById(state.ids.stiffness);
        const magEl = document.getElementById(state.ids.magnitude);

        if (mEl)  state.raw.m   = Math.max(1,  parseFloat(mEl.value)  || 1000);
        if (cEl)  state.raw.c   = Math.max(0,  parseFloat(cEl.value)  || 500);
        if (kEl)  state.raw.k   = Math.max(1,  parseFloat(kEl.value)  || 40000);
        if (magEl) state.raw.mag = parseFloat(magEl.value) || 5.0;
    }

    // ────────────────────────────────────────────────────────────────
    // GSAP — Suavizar transiciones de los inputs (solo visual/UI)
    // ────────────────────────────────────────────────────────────────

    function _wireInputListeners() {
        const inputIds = [state.ids.mass, state.ids.damping, state.ids.stiffness, state.ids.magnitude];

        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            el.addEventListener('input', () => {
                // Leer el valor crudo nuevo
                _readRawInputs();

                // Animar la transición suavizada con GSAP
                if (typeof gsap !== 'undefined') {
                    gsap.to(state.smooth, {
                        m:   state.raw.m,
                        c:   state.raw.c,
                        k:   state.raw.k,
                        mag: state.raw.mag,
                        duration: 0.45,
                        ease: 'power2.out',
                        overwrite: true,
                    });
                } else {
                    // Sin GSAP: asignar directamente
                    state.smooth.m   = state.raw.m;
                    state.smooth.c   = state.raw.c;
                    state.smooth.k   = state.raw.k;
                    state.smooth.mag = state.raw.mag;
                }

                // Si hay simulación activa y cambian m, c, k:
                // Re-crear el solver con los nuevos parámetros
                // (los valores RAW se usan para la FÍSICA, no los smooth)
                if (state.simActiva) {
                    _rebuildSolver();
                }
            });
        });
    }

    // ────────────────────────────────────────────────────────────────
    // GENERACIÓN DEL REGISTRO SÍSMICO
    // ────────────────────────────────────────────────────────────────

    /**
     * Genera un registro de aceleración del suelo sintético
     * basado en la magnitud actual.
     *
     * @param {number} mag      — Magnitud (escala Richter)
     * @param {number} duracion — Duración total en segundos
     * @param {number} dt       — Paso entre muestras
     * @returns {Float64Array}
     */
    function _generarRegistro(mag, duracion, dt) {
        const N = Math.floor(duracion / dt);
        const registro = new Float64Array(N);

        // Amplitud proporcional a la energía
        const amp = Math.pow(10, (mag - 4) * 0.5) * 0.5;

        for (let i = 0; i < N; i++) {
            const t = i * dt;

            // Envolvente temporal (ramp-up → meseta → decay)
            let envelope = 0;
            if (t < 1)       envelope = t;
            else if (t < 3)  envelope = 1;
            else if (t < 5)  envelope = Math.exp(-(t - 3) * 0.8);
            else if (t < 7)  envelope = Math.exp(-(t - 5) * 0.3) * 1.5;
            else if (t < 12) envelope = Math.exp(-(t - 7) * 0.4) * 0.8;
            else             envelope = Math.exp(-(t - 12) * 1.5) * 0.3;

            // Señal: suma de sinusoides + ruido
            let signal = 0;
            signal += Math.sin(2 * Math.PI * 1.2 * t + 0.3) * 0.4;
            signal += Math.sin(2 * Math.PI * 2.8 * t + 1.1) * 0.6;
            signal += Math.sin(2 * Math.PI * 5.5 * t + 2.7) * 0.3;
            signal += Math.sin(2 * Math.PI * 0.7 * t + 0.8) * 0.5;
            signal += Math.sin(2 * Math.PI * 8.3 * t + 4.2) * 0.15;
            signal += (Math.random() - 0.5) * 0.6;

            registro[i] = amp * envelope * signal;
        }

        return registro;
    }

    // ────────────────────────────────────────────────────────────────
    // INICIAR / REINICIAR SIMULACIÓN
    // ────────────────────────────────────────────────────────────────

    function _triggerSimulation() {
        if (!state.running || !state.scene3d) return;

        // Leer valores crudos actuales
        _readRawInputs();

        // Sincronizar smooth inmediatamente al disparar
        if (typeof gsap !== 'undefined') {
            gsap.killTweensOf(state.smooth);
        }
        state.smooth.m   = state.raw.m;
        state.smooth.c   = state.raw.c;
        state.smooth.k   = state.raw.k;
        state.smooth.mag = state.raw.mag;

        // Generar registro sísmico
        const duracion = 20; // segundos
        const registro = _generarRegistro(state.raw.mag, duracion, state.dtSolver);

        // Crear solver con valores CRUDOS (física pura, sin GSAP)
        state.solver = new SeismicSolver(
            state.raw.m,
            state.raw.c,
            state.raw.k,
            registro,
            { metodo: 'rk4', dtRegistro: state.dtSolver }
        );

        // Resetear reloj y estado
        state.simClock    = 0;
        state.simActiva   = true;
        state.lastFrameMs = null;

        // Resetear posición del cubo
        state.scene3d.update(0);

        if (state.onStart) state.onStart();
    }

    /**
     * Reconstruye el solver con nuevos parámetros m, c, k
     * manteniendo el mismo registro sísmico y continuando
     * desde el tiempo actual.
     */
    function _rebuildSolver() {
        if (!state.solver) return;

        // Guardar estado actual
        const tActual  = state.solver.t;
        const yActual  = state.solver.y;
        const vyActual = state.solver.vy;
        const registro = state.solver.registroSismo;

        // Crear nuevo solver con parámetros CRUDOS
        state.solver = new SeismicSolver(
            state.raw.m,
            state.raw.c,
            state.raw.k,
            registro,
            { metodo: 'rk4', dtRegistro: state.dtSolver }
        );

        // Restaurar estado (continuidad)
        state.solver.t  = tActual;
        state.solver.y  = yActual;
        state.solver.vy = vyActual;
    }

    // ────────────────────────────────────────────────────────────────
    // ACTUALIZAR DISPLAYS (valores suavizados por GSAP)
    // ────────────────────────────────────────────────────────────────

    function _updateSmoothDisplays() {
        _setTextIfExists(state.ids.displayM, Math.round(state.smooth.m));
        _setTextIfExists(state.ids.displayC, Math.round(state.smooth.c));
        _setTextIfExists(state.ids.displayK, Math.round(state.smooth.k));
    }

    function _updateStateDisplays() {
        if (!state.solver) return;
        _setTextIfExists(state.ids.displayT,  state.solver.t.toFixed(2) + ' s');
        _setTextIfExists(state.ids.displayY,  state.solver.y.toFixed(5) + ' m');
        _setTextIfExists(state.ids.displayVy, state.solver.vy.toFixed(4) + ' m/s');
    }

    function _setTextIfExists(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

})();

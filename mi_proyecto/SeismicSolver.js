// ================================================================
// SeismicSolver — Integrador numérico para SDOF sísmico
//
//   Resuelve:  m·ÿ + c·ẏ + k·y = −m·üg(t)
//
//   Métodos disponibles:
//     • 'euler'  — Euler explícito (1er orden)
//     • 'rk4'    — Runge-Kutta clásico (4to orden, por defecto)
//
//   Uso:
//     const solver = new SeismicSolver(m, c, k, registroSismo);
//     for (let i = 0; i < pasos; i++) {
//         const estado = solver.step(dt);
//         // estado → { t, y, vy, ay, ug }
//     }
// ================================================================

class SeismicSolver {
    /**
     * @param {number}   m              — Masa [kg]
     * @param {number}   c              — Amortiguamiento [N·s/m]
     * @param {number}   k              — Rigidez [N/m]
     * @param {number[]|Float64Array} registroSismo
     *        Registro de aceleración del suelo üg (m/s²), muestreado a
     *        intervalos iguales.  El paso de muestreo se fija con `dtRegistro`
     *        en las opciones (por defecto = 0.01 s).
     * @param {object}  [opciones]
     * @param {string}  [opciones.metodo='rk4']       — 'euler' | 'rk4'
     * @param {number}  [opciones.dtRegistro=0.01]     — Δt entre muestras del
     *        registro sísmico (s).
     */
    constructor(m, c, k, registroSismo, opciones = {}) {
        // ── Validaciones ──
        if (m <= 0) throw new Error('La masa m debe ser > 0');
        if (c < 0)  throw new Error('El amortiguamiento c no puede ser negativo');
        if (k <= 0) throw new Error('La rigidez k debe ser > 0');
        if (!registroSismo || registroSismo.length === 0) {
            throw new Error('Se requiere un registro sísmico con al menos 1 muestra');
        }

        // ── Parámetros estructurales ──
        this.m = m;
        this.c = c;
        this.k = k;

        // ── Registro sísmico (copia interna) ──
        this.registroSismo = Float64Array.from(registroSismo);
        this.dtRegistro    = opciones.dtRegistro ?? 0.01;

        // ── Método de integración ──
        const metodo = (opciones.metodo ?? 'rk4').toLowerCase();
        if (metodo !== 'euler' && metodo !== 'rk4') {
            throw new Error(`Método "${metodo}" no soportado. Use 'euler' o 'rk4'.`);
        }
        this.metodo = metodo;

        // ── Cantidades derivadas ──
        /** Frecuencia natural circular ωₙ (rad/s) */
        this.wn   = Math.sqrt(k / m);
        /** Razón de amortiguamiento ζ */
        this.zeta = c / (2 * Math.sqrt(m * k));
        /** Período natural Tₙ (s) */
        this.Tn   = (2 * Math.PI) / this.wn;
        /** Frecuencia natural amortiguada ωd (rad/s) */
        this.wd   = this.wn * Math.sqrt(Math.max(0, 1 - this.zeta ** 2));

        // ── Estado de la simulación ──
        this.t  = 0;    // tiempo actual (s)
        this.y  = 0;    // desplazamiento relativo (m)
        this.vy = 0;    // velocidad relativa (m/s)

        // ── Historial (opcional, para graficar después) ──
        this.historial = {
            t:  [0],
            y:  [0],
            vy: [0],
            ay: [0],
            ug: [this._ugEn(0)],
        };
    }

    // ────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ────────────────────────────────────────────────────────────────

    /**
     * Avanza la simulación un paso de tiempo dt.
     *
     * @param {number} dt — Paso de tiempo (s)
     * @returns {{ t: number, y: number, vy: number, ay: number, ug: number }}
     *   Objeto con el estado actualizado tras el paso.
     */
    step(dt) {
        if (dt <= 0) throw new Error('dt debe ser > 0');

        if (this.metodo === 'euler') {
            this._stepEuler(dt);
        } else {
            this._stepRK4(dt);
        }

        // Aceleración relativa actual (para información)
        const ug = this._ugEn(this.t);
        const ay = this._aceleracion(this.y, this.vy, ug);

        // Guardar en historial
        this.historial.t.push(this.t);
        this.historial.y.push(this.y);
        this.historial.vy.push(this.vy);
        this.historial.ay.push(ay);
        this.historial.ug.push(ug);

        return { t: this.t, y: this.y, vy: this.vy, ay, ug };
    }

    /**
     * Ejecuta la simulación completa hasta `tMax` con paso `dt`.
     *
     * @param {number} dt   — Paso de tiempo (s)
     * @param {number} tMax — Tiempo final (s).
     *   Por defecto = duración del registro.
     * @returns {{ t: Float64Array, y: Float64Array, vy: Float64Array,
     *             ay: Float64Array, ug: Float64Array }}
     */
    resolver(dt, tMax) {
        tMax = tMax ?? (this.registroSismo.length * this.dtRegistro);
        this.reset();

        const pasos = Math.ceil(tMax / dt);
        for (let i = 0; i < pasos; i++) {
            this.step(dt);
        }

        return {
            t:  Float64Array.from(this.historial.t),
            y:  Float64Array.from(this.historial.y),
            vy: Float64Array.from(this.historial.vy),
            ay: Float64Array.from(this.historial.ay),
            ug: Float64Array.from(this.historial.ug),
        };
    }

    /**
     * Reinicia el solver a condiciones iniciales.
     */
    reset() {
        this.t  = 0;
        this.y  = 0;
        this.vy = 0;
        this.historial = {
            t:  [0],
            y:  [0],
            vy: [0],
            ay: [0],
            ug: [this._ugEn(0)],
        };
    }

    /**
     * Estado actual (lectura rápida).
     */
    get estado() {
        const ug = this._ugEn(this.t);
        return {
            t:  this.t,
            y:  this.y,
            vy: this.vy,
            ay: this._aceleracion(this.y, this.vy, ug),
            ug,
        };
    }

    // ────────────────────────────────────────────────────────────────
    // MÉTODOS INTERNOS
    // ────────────────────────────────────────────────────────────────

    /**
     * Ecuación de movimiento despejada para ÿ:
     *
     *   ÿ = [ −m·üg(t) − c·ẏ − k·y ] / m
     *     = −üg(t) − (c/m)·ẏ − (k/m)·y
     *
     * @param {number} y   — desplazamiento
     * @param {number} vy  — velocidad
     * @param {number} ug  — aceleración del suelo en este instante
     * @returns {number} aceleración relativa ÿ
     */
    _aceleracion(y, vy, ug) {
        return (-this.k * y - this.c * vy - this.m * ug) / this.m;
    }

    /**
     * Interpola linealmente la aceleración del suelo en un instante t
     * arbitrario a partir del registro discreto.
     *
     * @param {number} t — tiempo (s)
     * @returns {number} üg(t) interpolada
     */
    _ugEn(t) {
        const idx = t / this.dtRegistro;
        const i0  = Math.floor(idx);
        const i1  = i0 + 1;
        const N   = this.registroSismo.length;

        if (i0 < 0) return this.registroSismo[0];
        if (i0 >= N - 1) return this.registroSismo[N - 1];

        const frac = idx - i0;
        return this.registroSismo[i0] * (1 - frac)
             + this.registroSismo[i1] * frac;
    }

    // ── Euler explícito ──────────────────────────────────────────
    _stepEuler(dt) {
        const ug = this._ugEn(this.t);
        const ay = this._aceleracion(this.y, this.vy, ug);

        this.y  += this.vy * dt;
        this.vy += ay * dt;
        this.t  += dt;
    }

    // ── Runge-Kutta 4 ────────────────────────────────────────────
    /**
     * RK4 clásico para el sistema:
     *   dy/dt  = vy
     *   dvy/dt = f(y, vy, t)   con  f = aceleración
     */
    _stepRK4(dt) {
        const t0  = this.t;
        const y0  = this.y;
        const vy0 = this.vy;

        // ── k1 ──
        const ug1  = this._ugEn(t0);
        const k1_y  = vy0;
        const k1_vy = this._aceleracion(y0, vy0, ug1);

        // ── k2 ──
        const t2   = t0 + dt / 2;
        const ug2  = this._ugEn(t2);
        const y2   = y0  + k1_y  * dt / 2;
        const vy2  = vy0 + k1_vy * dt / 2;
        const k2_y  = vy2;
        const k2_vy = this._aceleracion(y2, vy2, ug2);

        // ── k3 ──
        const y3   = y0  + k2_y  * dt / 2;
        const vy3  = vy0 + k2_vy * dt / 2;
        const k3_y  = vy3;
        const k3_vy = this._aceleracion(y3, vy3, ug2); // mismo t que k2

        // ── k4 ──
        const t4   = t0 + dt;
        const ug4  = this._ugEn(t4);
        const y4   = y0  + k3_y  * dt;
        const vy4  = vy0 + k3_vy * dt;
        const k4_y  = vy4;
        const k4_vy = this._aceleracion(y4, vy4, ug4);

        // ── Combinar ──
        this.y  = y0  + (dt / 6) * (k1_y  + 2 * k2_y  + 2 * k3_y  + k4_y);
        this.vy = vy0 + (dt / 6) * (k1_vy + 2 * k2_vy + 2 * k3_vy + k4_vy);
        this.t  = t4;
    }
}

// Exportar para uso en navegador y/o Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeismicSolver;
} else if (typeof window !== 'undefined') {
    window.SeismicSolver = SeismicSolver;
}

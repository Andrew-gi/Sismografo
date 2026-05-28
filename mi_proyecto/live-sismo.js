(function () {
    const endpoint = '/api/sismo/events';
    const snapshotEndpoint = '/api/sismo/live';
    let source = null;
    let pollingTimer = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const el = byId(id);
        if (el) el.textContent = value;
    }

    function setHtml(id, value) {
        const el = byId(id);
        if (el) el.innerHTML = value;
    }

    function setBadgeState(el, levelText) {
        if (!el) return;
        el.classList.remove('is-leve', 'is-moderado', 'is-fuerte', 'is-offline');
        if (levelText === 'Fuerte') el.classList.add('is-fuerte');
        else if (levelText === 'Moderado') el.classList.add('is-moderado');
        else if (levelText === 'Leve') el.classList.add('is-leve');
        else el.classList.add('is-offline');
    }

    function formatNumber(value, digits) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return num.toFixed(digits);
    }

    function formatTimestamp(value) {
        if (!value) return 'Sin datos';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleTimeString('es-CO');
    }

    function updateConnection(snapshot) {
        const dot = byId('hardware-connection-dot');
        const status = byId('hardware-connection-status');

        if (status) {
            if (!snapshot.connected) status.textContent = 'Sin conexión';
            else if (!snapshot.calibrated) status.textContent = 'Calibrando sensor';
            else status.textContent = snapshot.level_text || 'Sin actividad';
        }

        if (dot) {
            dot.classList.remove('is-online', 'is-warning', 'is-offline');
            if (!snapshot.connected) dot.classList.add('is-offline');
            else if ((snapshot.level_num || 0) >= 2) dot.classList.add('is-warning');
            else dot.classList.add('is-online');
        }

        const pill = document.querySelector('.live-indicator');
        if (pill) {
            pill.innerHTML = `<span class="live-dot"></span> ${snapshot.connected ? `LIVE ${String(snapshot.source || 'serial').toUpperCase()}` : 'LIVE OFFLINE'}`;
        }
    }

    function updateStats(snapshot) {
        setText('stat-events', String(snapshot.events_today ?? 0));
        setText('stat-max-mag', snapshot.max_magnitude_today > 0 ? formatNumber(snapshot.max_magnitude_today, 2) : '--.-');
        setText('stat-alerts', String(snapshot.active_alerts ?? 0));
        setText('stat-nodes', snapshot.connected ? '1/1' : '0/1');
    }

    function levelBadgeMarkup(levelText) {
        if (levelText === 'Fuerte') return '<span class=\"badge badge-red\">ALERTA FUERTE</span>';
        if (levelText === 'Moderado') return '<span class=\"badge badge-yellow\">Actividad moderada</span>';
        if (levelText === 'Leve') return '<span class=\"badge badge-green\">Actividad leve</span>';
        return '<span class=\"badge\">Sin actividad</span>';
    }

    function updateMainDashboard(snapshot) {
        const sample = snapshot.last_sample || {};
        const chipItems = document.querySelectorAll('.station-chip');
        chipItems.forEach((chip) => {
            const text = String(chip.textContent || '');
            if (text.includes('Nodos activos')) chip.textContent = `Nodos activos ${snapshot.connected ? '1' : '0'}`;
            if (text.includes('Sismos hoy')) chip.textContent = `Sismos hoy ${snapshot.events_today ?? 0}`;
            if (text.includes('Picos fuertes')) chip.textContent = `Picos fuertes ${snapshot.active_alerts ?? 0}`;
            if (text.includes('Streaming')) chip.textContent = `Streaming ${snapshot.connected ? 'LIVE' : 'OFFLINE'}`;
        });

        setText('bar-node-name', `Nodo fisico (${snapshot.port || 'COM3'})`);
        setText('bar-node-coords', `X ${formatNumber(sample.ax, 0)} | Y ${formatNumber(sample.ay, 0)} | Z ${formatNumber(sample.az, 0)}`);
        setText('coord-display', `Ax: ${formatNumber(sample.ax, 1)} | Ay: ${formatNumber(sample.ay, 1)} | Az: ${formatNumber(sample.az, 1)}`);

        setText('detail-nodo', `Nodo fisico ${snapshot.port || 'COM3'}`);
        setText('detail-ubicacion', 'Laboratorio local');
        setText('detail-coords', `X ${formatNumber(sample.ax, 0)} / Y ${formatNumber(sample.ay, 0)} / Z ${formatNumber(sample.az, 0)}`);
        setText('detail-rms', `${formatNumber(snapshot.rms_now, 2)} u`);
        setText('detail-freq', snapshot.sample_rate ? `${formatNumber(snapshot.sample_rate, 2)} Hz` : '--');
        setText('detail-amp', `${formatNumber(snapshot.magnitude_est, 2)} M`);
        setHtml('detail-class', levelBadgeMarkup(snapshot.level_text));
    }

    function drawWaveform(canvas, history) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(280, Math.round(rect.width || 280));
        const height = Math.max(140, Math.round(rect.height || 140));

        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#07111b';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(125, 211, 252, 0.16)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i += 1) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        const safeHistory = Array.isArray(history) ? history : [];
        if (safeHistory.length < 2) {
            ctx.fillStyle = '#8aa0b8';
            ctx.font = '14px Space Grotesk, sans-serif';
            ctx.fillText('Esperando muestras del sensor...', 18, height / 2);
            return;
        }

        const min = Math.min(...safeHistory);
        const max = Math.max(...safeHistory);
        const span = Math.max(max - min, 0.25);

        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 2.2;
        ctx.beginPath();

        safeHistory.forEach((value, index) => {
            const x = (index / Math.max(safeHistory.length - 1, 1)) * width;
            const normalized = (value - min) / span;
            const y = height - normalized * (height - 22) - 11;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.stroke();
    }

    function computeSpectrum(history, bins = 14) {
        const safeHistory = Array.isArray(history) ? history : [];
        if (safeHistory.length < 16) return new Array(bins).fill(0);

        const mean = safeHistory.reduce((total, value) => total + value, 0) / safeHistory.length;
        const centered = safeHistory.map((value) => value - mean);
        const limit = Math.min(Math.floor(centered.length / 2), bins);
        const result = [];

        for (let k = 1; k <= limit; k += 1) {
            let real = 0;
            let imag = 0;
            for (let n = 0; n < centered.length; n += 1) {
                const angle = (2 * Math.PI * k * n) / centered.length;
                real += centered[n] * Math.cos(angle);
                imag -= centered[n] * Math.sin(angle);
            }
            result.push(Math.sqrt(real * real + imag * imag));
        }

        const max = Math.max(...result, 1);
        while (result.length < bins) result.push(0);
        return result.map((value) => value / max);
    }

    function drawSpectrum(canvas, history) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(280, Math.round(rect.width || 280));
        const height = Math.max(140, Math.round(rect.height || 140));

        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#07111b';
        ctx.fillRect(0, 0, width, height);

        const bars = computeSpectrum(history);
        const barWidth = (width - 32) / bars.length;

        bars.forEach((value, index) => {
            const x = 16 + index * barWidth;
            const h = value * (height - 28);
            const y = height - h - 12;
            const gradient = ctx.createLinearGradient(x, y, x, height);
            gradient.addColorStop(0, value > 0.7 ? '#fb7185' : value > 0.35 ? '#facc15' : '#38bdf8');
            gradient.addColorStop(1, 'rgba(56, 189, 248, 0.08)');
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, Math.max(barWidth - 4, 6), h);
        });
    }

    function updateAxes(snapshot) {
        const sample = snapshot.last_sample || {};
        setText(
            'hardware-xyz',
            `X ${formatNumber(sample.ax, 3)} m/s²  •  Y ${formatNumber(sample.ay, 3)} m/s²  •  Z ${formatNumber(sample.az, 3)} m/s²`
        );
    }

    function updateLog(snapshot) {
        const log = byId('hardware-log');
        if (!log) return;

        const parts = [
            snapshot.connected ? 'Sensor enlazado' : 'Sensor sin enlace',
            snapshot.calibrated ? 'calibrado' : 'en calibracion',
            `fuente ${snapshot.source || 'serial'}`,
            snapshot.message || 'sin mensaje'
        ];

        log.textContent = parts.join(' • ');
    }

    function render(snapshot) {
        if (!snapshot) return;
        updateConnection(snapshot);
        updateStats(snapshot);
        setText('hardware-source', snapshot.source || 'serial');
        setText('hardware-port', snapshot.port || 'COM3');
        setText('hardware-level', snapshot.level_text || 'Sin actividad');
        setText('hardware-magnitude', snapshot.magnitude_est > 0 ? formatNumber(snapshot.magnitude_est, 2) : '--.-');
        setText('hardware-rms', formatNumber(snapshot.rms_now, 3));
        setText('hardware-quiet-rms', formatNumber(snapshot.quiet_rms, 3));
        setText('hardware-sample-rate', snapshot.sample_rate ? `${formatNumber(snapshot.sample_rate, 2)} Hz` : '--');
        setText('hardware-updated-at', formatTimestamp(snapshot.timestamp));
        updateAxes(snapshot);
        updateLog(snapshot);
        updateMainDashboard(snapshot);
        setBadgeState(byId('hardware-level-badge'), snapshot.level_text);
        drawWaveform(byId('hardware-waveform'), snapshot.history || []);
        drawSpectrum(byId('hardware-spectrum'), snapshot.history || []);

        const button = byId('hardware-simulate-btn');
        if (button) {
            const usingSimulation = snapshot.source === 'simulacion-web';
            button.textContent = usingSimulation ? 'Simulando...' : 'Simular Pulso';
            button.disabled = usingSimulation;
        }
    }

    async function bootstrapSnapshot() {
        try {
            const response = await fetch(snapshotEndpoint);
            const payload = await response.json();
            if (payload && payload.data) {
                render(payload.data);
            }
        } catch (_error) {
            updateConnection({ connected: false });
        }
    }

    function startPollingFallback(intervalMs = 1500) {
        if (pollingTimer) return;
        pollingTimer = setInterval(() => {
            bootstrapSnapshot();
        }, intervalMs);
    }

    function bindSimulationButton() {
        const button = byId('hardware-simulate-btn');
        if (!button) return;

        button.addEventListener('click', async () => {
            try {
                await fetch('/api/sismo/simular', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ intensidad: 2.8, duracionMs: 9000 })
                });
            } catch (error) {
                console.warn('No se pudo lanzar la simulacion', error);
            }
        });
    }

    function connectStream() {
        if (!window.EventSource) {
            startPollingFallback();
            return;
        }
        if (source) source.close();

        source = new EventSource(endpoint);
        source.onmessage = (event) => {
            try {
                render(JSON.parse(event.data));
            } catch (error) {
                console.warn('Paquete SSE invalido', error);
            }
        };

        source.onerror = () => {
            updateConnection({ connected: false });
            startPollingFallback();
        };
    }

    function initLiveSismo() {
        // Senal visible para confirmar que este script si cargo en el navegador.
        setText('hardware-log', 'live-sismo.js cargado, enlazando datos...');
        bindSimulationButton();
        bootstrapSnapshot();
        connectStream();
        startPollingFallback();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiveSismo, { once: true });
    } else {
        initLiveSismo();
    }
})();

let eqAnimQueue = [];
let eqAnimRunning = false;

function animateEquationsSequentially() {
    const cards = document.querySelectorAll('.equation-card');
    cards.forEach((card, i) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px) scale(0.95)';
        card.style.transition = 'none';
    });

    cards.forEach((card, i) => {
        setTimeout(() => {
            card.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0) scale(1)';

            // Glow pulse on the equation display
            const eqDisplay = card.querySelector('.equation-display');
            if (eqDisplay) {
                eqDisplay.classList.add('eq-glow-animate');
                setTimeout(() => eqDisplay.classList.remove('eq-glow-animate'), 1200);
            }
        }, 200 + i * 250);
    });
}

// ============= 2. INTERACTIVE SEISMOGRAPH CANVAS =============
let seismoAnimId = null;
let seismoTime = 0;
let seismoIntensity = 0.5;
let seismoRecording = [];

function initSeismograph() {
    const canvas = document.getElementById('seismograph-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Make canvas responsive
    function resize() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = 320;
    }
    resize();
    window.addEventListener('resize', resize);

    // Controls
    const intensitySlider = document.getElementById('seismo-intensity');
    if (intensitySlider) {
        intensitySlider.addEventListener('input', (e) => {
            seismoIntensity = parseFloat(e.target.value);
            document.getElementById('seismo-intensity-val').textContent =
                seismoIntensity < 0.3 ? 'Leve' : seismoIntensity < 0.7 ? 'Moderado' : 'Fuerte';
        });
    }

    function drawSeismograph() {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        seismoTime += 0.03;

        // --- Background ---
        ctx.fillStyle = '#0f1729';
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.lineWidth = 0.5;
        for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        const groundY = H * 0.75;
        const pivotX = W * 0.18;
        const pivotY = H * 0.15;

        // --- Ground vibration ---
        const quakeX = Math.sin(seismoTime * 8) * 12 * seismoIntensity +
            Math.sin(seismoTime * 13) * 5 * seismoIntensity;
        const quakeY = Math.cos(seismoTime * 6) * 4 * seismoIntensity;

        // Draw ground layers
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = `rgba(139, 92, 60, ${0.15 + i * 0.08})`;
            const layerY = groundY + i * 12;
            ctx.beginPath();
            ctx.moveTo(0, layerY);
            for (let x = 0; x < W; x += 5) {
                const wave = Math.sin(x * 0.02 + seismoTime * 3 + i) * 3 * seismoIntensity;
                ctx.lineTo(x, layerY + wave);
            }
            ctx.lineTo(W, H); ctx.lineTo(0, H);
            ctx.fill();
        }

        // --- Seismograph structure ---
        const baseX = pivotX + quakeX;
        const baseY = groundY + quakeY;

        // Base/frame
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3;
        ctx.fillStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.beginPath();
        ctx.roundRect(baseX - 50, baseY - 160, 100, 165, 6);
        ctx.fill(); ctx.stroke();

        // Support frame lines
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(baseX - 30, baseY - 155);
        ctx.lineTo(baseX - 30, baseY);
        ctx.moveTo(baseX + 30, baseY - 155);
        ctx.lineTo(baseX + 30, baseY);
        ctx.stroke();

        // --- Pendulum (stays still due to inertia) ---
        const pendulumX = pivotX; // Does NOT move with ground
        const pendulumY = pivotY + 40;
        const massY = pendulumY + 80;

        // Pivot point
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(baseX, baseY - 155, 5, 0, Math.PI * 2);
        ctx.fill();

        // String/wire
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(baseX, baseY - 155);
        ctx.lineTo(pendulumX, massY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Mass (bob) — stays relatively still
        const massJitter = Math.sin(seismoTime * 2) * 1.5 * seismoIntensity;
        ctx.fillStyle = '#3b82f6';
        ctx.shadowColor = '#3b82f6';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(pendulumX + massJitter, massY, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Mass label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('M', pendulumX + massJitter, massY + 4);

        // --- Pen drawing on drum ---
        const penTipX = pendulumX + massJitter + 22;
        const penTipY = massY;

        // Pen line
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pendulumX + massJitter + 18, massY);
        ctx.lineTo(penTipX + 15, penTipY);
        ctx.stroke();

        // Rotating drum (moves with ground)
        const drumX = baseX + 70;
        const drumY = massY;
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
        ctx.beginPath();
        ctx.roundRect(drumX - 5, drumY - 50, 55, 100, 4);
        ctx.fill(); ctx.stroke();

        // Record signal on drum
        const displacement = quakeX - massJitter;
        seismoRecording.push(displacement);
        if (seismoRecording.length > 180) seismoRecording.shift();

        // Draw recorded signal on drum
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < seismoRecording.length; i++) {
            const sx = drumX + 2 + seismoRecording[i] * 0.8;
            const sy = drumY + 45 - (i / seismoRecording.length) * 90;
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // --- Real-time signal trace (bottom) ---
        const traceY = H * 0.88;
        const traceH = 35;

        ctx.fillStyle = 'rgba(15, 23, 41, 0.8)';
        ctx.fillRect(W * 0.4, traceY - traceH, W * 0.55, traceH * 2 + 5);

        ctx.strokeStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(W * 0.4, traceY); ctx.lineTo(W * 0.95, traceY); ctx.stroke();

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i < seismoRecording.length; i++) {
            const sx = W * 0.4 + (i / 180) * W * 0.55;
            const sy = traceY - seismoRecording[i] * 1.2;
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('Señal registrada en tiempo real', W * 0.4, traceY - traceH - 5);
        ctx.fillText('📍 Masa inercial (no se mueve)', pivotX - 40, massY + 40);
        ctx.fillText('🔩 Base (se mueve con el suelo)', baseX - 50, baseY + 15);

        // Displacement indicator
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(`Desplazamiento: ${Math.abs(displacement).toFixed(1)} mm`, W * 0.95, traceY - traceH - 5);

        seismoAnimId = requestAnimationFrame(drawSeismograph);
    }

    drawSeismograph();
}

function stopSeismograph() {
    if (seismoAnimId) cancelAnimationFrame(seismoAnimId);
}

// ============= 3. SENSOR SIGNAL VISUALIZATION =============
let sensorAnimId = null;
let sensorTime = 0;

function initSensorViz() {
    const canvas = document.getElementById('sensor-viz-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = 200;
    }
    resize();
    window.addEventListener('resize', resize);

    function drawSensorViz() {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        sensorTime += 0.04;

        ctx.fillStyle = '#0f1729';
        ctx.fillRect(0, 0, W, H);

        // Section widths
        const sec = W / 3;

        // --- Section 1: Analog sensor signal (piezoelectric) ---
        ctx.fillStyle = 'rgba(8, 145, 178, 0.1)';
        ctx.fillRect(0, 0, sec - 5, H);
        ctx.fillStyle = '#0891b2';
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('🎤 Señal Analógica', sec / 2, 18);

        const midY1 = H / 2 + 10;
        ctx.strokeStyle = '#0891b2';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#0891b2';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        for (let x = 10; x < sec - 15; x++) {
            const t = (x / sec) * 6 * Math.PI + sensorTime * 5;
            const noise = (Math.random() - 0.5) * 8;
            const sig = Math.sin(t) * 30 + Math.sin(t * 3.7) * 12 + noise;
            x === 10 ? ctx.moveTo(x, midY1 + sig) : ctx.lineTo(x, midY1 + sig);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // --- Arrow 1 ---
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(sec - 5, H / 2); ctx.lineTo(sec - 20, H / 2 - 8); ctx.lineTo(sec - 20, H / 2 + 8);
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.font = '9px Inter';
        ctx.fillText('ADC', sec - 12, H / 2 - 12);

        // --- Section 2: Digital conversion (stepped) ---
        ctx.fillStyle = 'rgba(5, 150, 105, 0.1)';
        ctx.fillRect(sec, 0, sec - 5, H);
        ctx.fillStyle = '#059669';
        ctx.font = 'bold 10px Inter';
        ctx.fillText('⚡ Señal Digital', sec + sec / 2, 18);

        const midY2 = H / 2 + 10;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        const stepW = 4;
        for (let x = sec + 10; x < sec * 2 - 15; x += stepW) {
            const t = ((x - sec) / sec) * 6 * Math.PI + sensorTime * 5;
            const sig = Math.round(Math.sin(t) * 6 + Math.sin(t * 3.7) * 2.5) * 5;
            ctx.lineTo(x, midY2 + sig);
            ctx.lineTo(x + stepW, midY2 + sig);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Binary bits flowing
        ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
        ctx.font = '9px Courier New';
        for (let i = 0; i < 8; i++) {
            const bx = sec + 15 + i * 22;
            const by = H - 25;
            const bit = Math.round(Math.sin(sensorTime * 3 + i * 0.8) * 0.5 + 0.5);
            ctx.fillText(bit.toString(), bx, by);
        }

        // --- Arrow 2 ---
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(sec * 2 - 5, H / 2); ctx.lineTo(sec * 2 - 20, H / 2 - 8); ctx.lineTo(sec * 2 - 20, H / 2 + 8);
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.font = '9px Inter';
        ctx.fillText('FFT', sec * 2 - 12, H / 2 - 12);

        // --- Section 3: FFT spectrum ---
        ctx.fillStyle = 'rgba(124, 58, 237, 0.1)';
        ctx.fillRect(sec * 2, 0, sec, H);
        ctx.fillStyle = '#7c3aed';
        ctx.font = 'bold 10px Inter';
        ctx.fillText('📊 Espectro FFT', sec * 2 + sec / 2, 18);

        const nBars = 16;
        const barW2 = (sec - 40) / nBars;
        for (let i = 0; i < nBars; i++) {
            const freq = (i + 1) * 2;
            const amp = Math.abs(Math.sin(freq * 0.3 + sensorTime * 0.5)) *
                Math.exp(-i * 0.15) * (H * 0.45);
            const bx = sec * 2 + 20 + i * barW2;
            const by = H - 30 - amp;

            const grad = ctx.createLinearGradient(bx, by, bx, H - 30);
            grad.addColorStop(0, amp > H * 0.25 ? '#ef4444' : '#7c3aed');
            grad.addColorStop(1, 'rgba(124, 58, 237, 0.1)');
            ctx.fillStyle = grad;
            ctx.fillRect(bx, by, barW2 - 2, amp);
        }

        ctx.fillStyle = 'rgba(124, 58, 237, 0.5)';
        ctx.font = '8px Inter';
        ctx.fillText('Frecuencia (Hz) →', sec * 2 + sec / 2, H - 8);

        sensorAnimId = requestAnimationFrame(drawSensorViz);
    }

    drawSensorViz();
}

function stopSensorViz() {
    if (sensorAnimId) cancelAnimationFrame(sensorAnimId);
}

// ============= 4. EARTHQUAKE SIMULATION =============
let quakeAnimId = null;
let quakeTime = 0;
let quakeActive = false;
let quakeWaves = [];
let quakeMagnitude = 0;

function initQuakeSimulation() {
    const canvas = document.getElementById('quake-sim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = 300;
    }
    resize();
    window.addEventListener('resize', resize);

    const triggerBtn = document.getElementById('trigger-quake');
    if (triggerBtn) {
        triggerBtn.addEventListener('click', () => {
            quakeActive = true;
            quakeTime = 0;
            quakeMagnitude = 1;
            quakeWaves = [];
            for (let i = 0; i < 6; i++) {
                quakeWaves.push({ radius: 0, opacity: 1, speed: 1.5 + i * 0.3, delay: i * 12 });
            }
        });
    }

    const magSlider = document.getElementById('quake-magnitude');
    if (magSlider) {
        magSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('quake-mag-val').textContent = v.toFixed(1);
        });
    }

    // Buildings data
    const buildings = [
        { x: 0.15, h: 60, w: 30, color: '#64748b', floors: 4 },
        { x: 0.25, h: 90, w: 25, color: '#475569', floors: 6 },
        { x: 0.35, h: 45, w: 35, color: '#64748b', floors: 3 },
        { x: 0.55, h: 70, w: 28, color: '#475569', floors: 5 },
        { x: 0.65, h: 50, w: 32, color: '#64748b', floors: 3 },
        { x: 0.75, h: 100, w: 22, color: '#475569', floors: 7 },
        { x: 0.85, h: 55, w: 30, color: '#64748b', floors: 4 }
    ];

    function drawQuakeSimulation() {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Sky gradient
        const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.6);
        skyGrad.addColorStop(0, '#1e293b');
        skyGrad.addColorStop(1, '#334155');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);

        const groundY = H * 0.7;
        const epicenterX = W * 0.45;
        const epicenterY = H * 0.88;

        if (quakeActive) {
            quakeTime++;
            const magVal = parseFloat(document.getElementById('quake-magnitude')?.value || 5);
            quakeMagnitude = Math.max(0, 1 - quakeTime * 0.003) * (magVal / 5);
        }

        const shakeX = quakeActive ? (Math.sin(quakeTime * 0.3) * 8 + Math.sin(quakeTime * 0.7) * 4) * quakeMagnitude : 0;
        const shakeY = quakeActive ? Math.cos(quakeTime * 0.4) * 3 * quakeMagnitude : 0;

        // --- Underground layers ---
        const layers = [
            { y: groundY, color: '#92400e', label: 'Suelo' },
            { y: groundY + 25, color: '#78350f', label: 'Roca sedimentaria' },
            { y: groundY + 55, color: '#451a03', label: 'Roca ígnea' }
        ];

        layers.forEach((layer, i) => {
            ctx.fillStyle = layer.color;
            ctx.beginPath();
            ctx.moveTo(0, layer.y);
            for (let x = 0; x < W; x += 3) {
                const wave = quakeActive ? Math.sin(x * 0.03 + quakeTime * 0.2 + i) * 3 * quakeMagnitude : 0;
                ctx.lineTo(x + shakeX * 0.5, layer.y + wave);
            }
            ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
        });

        // --- Epicenter ---
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = quakeActive ? 20 * quakeMagnitude : 8;
        ctx.beginPath();
        ctx.arc(epicenterX, epicenterY, 8 + (quakeActive ? Math.sin(quakeTime * 0.5) * 3 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('★', epicenterX, epicenterY + 3);

        // --- Seismic waves ---
        if (quakeActive) {
            quakeWaves.forEach(wave => {
                if (quakeTime > wave.delay) {
                    wave.radius += wave.speed;
                    wave.opacity = Math.max(0, 1 - wave.radius / (W * 0.6));

                    if (wave.opacity > 0) {
                        ctx.strokeStyle = `rgba(239, 68, 68, ${wave.opacity * 0.5})`;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(epicenterX, epicenterY, wave.radius, 0, Math.PI * 2);
                        ctx.stroke();

                        // P-wave (faster, blue)
                        ctx.strokeStyle = `rgba(59, 130, 246, ${wave.opacity * 0.4})`;
                        ctx.beginPath();
                        ctx.arc(epicenterX, epicenterY, wave.radius * 1.3, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                }
            });
        }

        // Label
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.font = '9px Inter';
        ctx.fillText('Epicentro ★', epicenterX, epicenterY + 20);

        // --- Buildings ---
        buildings.forEach(b => {
            const bx = W * b.x + shakeX;
            const by = groundY - b.h + shakeY;
            const sway = quakeActive ? Math.sin(quakeTime * 0.15 + b.x * 10) * 6 * quakeMagnitude * (b.h / 80) : 0;

            ctx.save();
            ctx.translate(bx + b.w / 2, groundY);
            ctx.transform(1, 0, sway / b.h, 1, 0, 0);
            ctx.translate(-bx - b.w / 2, -groundY);

            // Building body
            ctx.fillStyle = b.color;
            ctx.fillRect(bx, by, b.w, b.h);

            // Windows
            const floorH = b.h / b.floors;
            for (let f = 0; f < b.floors; f++) {
                const wy = by + f * floorH + floorH * 0.3;
                const ww = b.w * 0.25;
                ctx.fillStyle = quakeActive && quakeMagnitude > 0.3 ?
                    `rgba(251, 191, 36, ${0.4 + Math.random() * 0.4})` :
                    'rgba(251, 191, 36, 0.6)';
                ctx.fillRect(bx + b.w * 0.15, wy, ww, floorH * 0.35);
                ctx.fillRect(bx + b.w * 0.55, wy, ww, floorH * 0.35);
            }

            ctx.restore();
        });

        // --- Status text ---
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        if (quakeActive && quakeMagnitude > 0.1) {
            ctx.fillStyle = '#ef4444';
            ctx.fillText(`⚠ SISMO EN PROGRESO — Magnitud: ${(quakeMagnitude * 5 + 2).toFixed(1)}`, 15, 25);

            // Wave type labels
            ctx.font = '10px Inter';
            ctx.fillStyle = '#3b82f6';
            ctx.fillText('→ Onda P (rápida)', 15, 45);
            ctx.fillStyle = '#ef4444';
            ctx.fillText('→ Onda S (lenta, destructiva)', 15, 60);
        } else if (quakeActive) {
            ctx.fillStyle = '#10b981';
            ctx.fillText('✓ Sismo finalizado — Análisis de datos', 15, 25);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText('Presiona "Simular Sismo" para iniciar', 15, 25);
        }

        // Fade out
        if (quakeActive && quakeTime > 350) {
            quakeActive = false;
            quakeTime = 0;
            quakeMagnitude = 0;
        }

        quakeAnimId = requestAnimationFrame(drawQuakeSimulation);
    }

    drawQuakeSimulation();
}

function stopQuakeSimulation() {
    if (quakeAnimId) cancelAnimationFrame(quakeAnimId);
}

// ============= 5. TRIAXIAL ACCELEROMETER (PSEUDO-3D) =============
let triaxialAnimId = null;
let triaxialTime = 0;

function initTriaxialViz() {
    const canvas = document.getElementById('triaxial-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = 180;
    }
    resize();
    window.addEventListener('resize', resize);

    function drawTriaxial() {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        triaxialTime += 0.05;

        ctx.fillStyle = '#0f1729';
        ctx.fillRect(0, 0, W, H);

        const centerX = W / 2;
        const centerY = H / 2 + 10;

        // Simulate some seismic noise and a periodic larger shake
        const shake = (Math.sin(triaxialTime * 0.5) > 0.8) ? 1 : 0.1;
        const dx = (Math.sin(triaxialTime * 7) + Math.cos(triaxialTime * 3)) * 4 * shake;
        const dy = (Math.cos(triaxialTime * 6) + Math.sin(triaxialTime * 4)) * 4 * shake;
        const dz = (Math.sin(triaxialTime * 5) + Math.cos(triaxialTime * 8)) * 4 * shake;

        // Isometric projection angles
        const angleX = Math.PI / 6; // 30 degrees down-left
        const angleY = Math.PI / 6; // 30 degrees down-right

        // Frame corners (pseudo 3D)
        const frameSize = 60;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Draw axes lines (springs)
        function drawSpring(x1, y1, x2, y2, color, label) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;

            // Draw a zig-zag spring
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            const dx = x2 - x1, dy = y2 - y1;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = 8;
            for (let i = 1; i < steps; i++) {
                const t = i / steps;
                const px = x1 + dx * t;
                const py = y1 + dy * t;
                const perpX = -dy / dist * ((i % 2 === 0) ? 5 : -5);
                const perpY = dx / dist * ((i % 2 === 0) ? 5 : -5);
                ctx.lineTo(px + perpX, py + perpY);
            }
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Label
            ctx.fillStyle = color;
            ctx.font = 'bold 12px Inter';
            ctx.fillText(label, x1 + (dx > 0 ? -15 : 10), y1 + (dy > 0 ? -10 : 15));
        }

        // Anchor points
        const anchorX = centerX - Math.cos(angleX) * frameSize;
        const anchorY = centerY + Math.sin(angleX) * frameSize;

        const anchorY_ax = centerX + Math.cos(angleY) * frameSize;
        const anchorY_ay = centerY + Math.sin(angleY) * frameSize;

        const anchorZ_x = centerX;
        const anchorZ_y = centerY - frameSize;

        // Mass position (affected by shake)
        const massPx = centerX + dx - dz * 0.5;
        const massPy = centerY + dy + dz * 0.5;

        // Draw Springs
        drawSpring(anchorX, anchorY, massPx, massPy, '#ef4444', 'Eje X'); // Red X
        drawSpring(anchorY_ax, anchorY_ay, massPx, massPy, '#10b981', 'Eje Y'); // Green Y
        drawSpring(anchorZ_x, anchorZ_y, massPx, massPy, '#3b82f6', 'Eje Z'); // Blue Z

        // Draw Mass (MEMS proof mass)
        ctx.fillStyle = 'rgba(100, 116, 139, 0.9)';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();

        // Isometric cube for mass
        const s = 15;
        // Top face
        ctx.moveTo(massPx, massPy - s);
        ctx.lineTo(massPx + s * 0.866, massPy - s * 0.5);
        ctx.lineTo(massPx, massPy);
        ctx.lineTo(massPx - s * 0.866, massPy - s * 0.5);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Left face
        ctx.fillStyle = 'rgba(71, 85, 105, 0.9)';
        ctx.beginPath();
        ctx.moveTo(massPx - s * 0.866, massPy - s * 0.5);
        ctx.lineTo(massPx, massPy);
        ctx.lineTo(massPx, massPy + s);
        ctx.lineTo(massPx - s * 0.866, massPy + s * 0.5);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Right face
        ctx.fillStyle = 'rgba(51, 65, 85, 0.9)';
        ctx.beginPath();
        ctx.moveTo(massPx, massPy);
        ctx.lineTo(massPx + s * 0.866, massPy - s * 0.5);
        ctx.lineTo(massPx + s * 0.866, massPy + s * 0.5);
        ctx.lineTo(massPx, massPy + s);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Output signals visualization
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px Inter';
        ctx.fillText(`X: ${(dx).toFixed(2)} g`, W - 70, 20);
        ctx.fillText(`Y: ${(dy).toFixed(2)} g`, W - 70, 35);
        ctx.fillText(`Z: ${(dz).toFixed(2)} g`, W - 70, 50);

        triaxialAnimId = requestAnimationFrame(drawTriaxial);
    }
    drawTriaxial();
}

function stopTriaxialViz() {
    if (triaxialAnimId) cancelAnimationFrame(triaxialAnimId);
}

// ============= 6. MICROCONTROLLER (MCU) & DATA FLOW =============
let mcuAnimId = null;
let mcuTime = 0;
let mcuSignalData = Array(50).fill(0.5); // Store signal history

function initMCUFlowViz() {
    const canvas = document.getElementById('mcu-flow-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Controls
    const ctrlThresh = document.getElementById('mcu-ctrl-thresh');
    const ctrlSignal = document.getElementById('mcu-ctrl-signal');
    const btnInject = document.getElementById('mcu-btn-signal');
    const valThresh = document.getElementById('mcu-thresh-val');
    const valSignal = document.getElementById('mcu-sig-val');

    let isInjecting = false;

    function updateValLabels() {
        if (valThresh) valThresh.textContent = parseFloat(ctrlThresh.value).toFixed(1);
        if (valSignal) valSignal.textContent = parseFloat(ctrlSignal.value).toFixed(1);
    }

    if (ctrlThresh) ctrlThresh.addEventListener('input', updateValLabels);
    if (ctrlSignal) {
        ctrlSignal.addEventListener('input', (e) => {
            updateValLabels();
            // Don't auto-reset if manual input
        });
    }

    if (btnInject) {
        btnInject.addEventListener('click', () => {
            isInjecting = true;
            if (ctrlSignal) ctrlSignal.value = 8.5; // Spike signal
            updateValLabels();

            // Auto decay after 2 seconds
            setTimeout(() => {
                isInjecting = false;
            }, 2000);
        });
    }

    function resize() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = 260;
    }
    resize();
    window.addEventListener('resize', resize);

    function drawMCUFlow() {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        mcuTime += 0.04;

        ctx.fillStyle = '#0f1729';
        ctx.fillRect(0, 0, W, H);

        const cy = H / 2 - 20;

        // Read current values
        const threshold = ctrlThresh ? parseFloat(ctrlThresh.value) : 3.0;
        let currentSignal = ctrlSignal ? parseFloat(ctrlSignal.value) : 0.5;

        // Auto decay signal if not manually dragged and injecting is over
        if (!isInjecting && currentSignal > 0.5) {
            currentSignal = Math.max(0.5, currentSignal - 0.05);
            if (ctrlSignal) ctrlSignal.value = currentSignal;
            updateValLabels();
        }

        // Add some noise to the base signal if it's low
        if (currentSignal < 1.0) {
            currentSignal += (Math.random() - 0.5) * 0.4;
        }

        // Update signal history
        mcuSignalData.push(currentSignal);
        if (mcuSignalData.length > 50) mcuSignalData.shift();

        // Determine State
        const isEventActive = currentSignal >= threshold;

        // ==========================================
        // DRAW FLOW GRAPH
        // ==========================================
        function drawFlowLine(x1, y1, x2, y2, color, active) {
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

            if (active) {
                const numPackets = 4;
                ctx.fillStyle = color;
                for (let i = 0; i < numPackets; i++) {
                    const t = ((mcuTime * 0.8 + i / numPackets) % 1.0);
                    const px = x1 + (x2 - x1) * t;
                    const py = y1 + (y2 - y1) * t;
                    ctx.beginPath();
                    ctx.arc(px, py, 3, 0, Math.PI * 2);
                    ctx.fill();

                    // Glow
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 8;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
        }

        function drawBlock(x, y, w, h, title, color, icon, isBlinking) {
            ctx.fillStyle = `rgba(${color}, 0.15)`;
            ctx.strokeStyle = `rgba(${color}, 0.6)`;
            if (isBlinking && Math.sin(mcuTime * 6) > 0) {
                ctx.fillStyle = `rgba(${color}, 0.4)`;
                ctx.strokeStyle = `rgba(${color}, 1)`;
                ctx.shadowColor = `rgba(${color}, 0.8)`;
                ctx.shadowBlur = 15;
            }
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
            ctx.fill(); ctx.stroke();
            ctx.shadowBlur = 0; // reset

            ctx.fillStyle = '#fff';
            ctx.font = '16px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(icon, x, y - 5);

            ctx.font = 'bold 10px Inter';
            ctx.fillStyle = `rgb(${color})`;

            const lines = title.split('\\n');
            lines.forEach((line, idx) => {
                ctx.fillText(line, x, y + 12 + (idx * 12));
            });
        }

        // Layout positions
        const pADC = { x: W * 0.15, y: cy };
        const pMCU = { x: W * 0.5, y: cy };
        const pMem = { x: W * 0.85, y: cy - 40 };
        const pTx = { x: W * 0.85, y: cy + 40 };

        // Flows
        drawFlowLine(pADC.x + 40, pADC.y, pMCU.x - 50, pMCU.y, '#10b981', true); // continuous ADC flow
        drawFlowLine(pMCU.x + 50, pMCU.y, pMem.x - 40, pMem.y, '#f59e0b', true); // continuous storage flow
        drawFlowLine(pMCU.x + 50, pMCU.y, pTx.x - 35, pTx.y, '#3b82f6', isEventActive); // Tx only when event active

        // Blocks
        drawBlock(pADC.x, pADC.y, 80, 60, "ADC 24-bit", "16, 185, 129", "⚡", false);

        // Core MCU
        drawBlock(pMCU.x, pMCU.y, 100, 80, "ARM Cortex-M4\\nAlgoritmo STA/LTA", "139, 92, 246", "🧠", isEventActive);

        if (isEventActive) {
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 11px Inter';
            ctx.fillText("¡EVENTO SÍSMICO DETECTADO!", pMCU.x, pMCU.y - 50);
            ctx.fillText("Wake-up / Transmitiendo", W * 0.85, pTx.y + 35);
        } else {
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'italic 10px Inter';
            ctx.fillText("Modo Sleep (Bajo Consumo)", pMCU.x, pMCU.y - 50);
        }

        drawBlock(pMem.x, pMem.y, 80, 50, "Memoria SD\\nBuffer Circular", "245, 158, 11", "💾", false);
        drawBlock(pTx.x, pTx.y, 70, 50, "Módem WiFi/4G", "59, 130, 246", "📡", isEventActive);

        // ==========================================
        // DRAW LIVE SIGNAL GRAPHIC (Bottom)
        // ==========================================
        const graphY = H - 20;
        const graphH = 50;
        const graphW = W - 100;
        const graphX = 50;

        // Background
        ctx.fillStyle = 'rgba(15, 23, 41, 0.8)';
        ctx.fillRect(graphX, graphY - graphH, graphW, graphH);

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(graphX, graphY - graphH, graphW, graphH);

        // Draw Threshold Line
        const threshY = graphY - (threshold / 10) * graphH;
        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([4, 2]);
        ctx.beginPath(); ctx.moveTo(graphX, threshY); ctx.lineTo(graphX + graphW, threshY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ef4444';
        ctx.font = '9px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(`Umbral (${threshold.toFixed(1)})`, graphX - 5, threshY + 3);

        // Draw Signal Line
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < mcuSignalData.length; i++) {
            const sx = graphX + (i / (mcuSignalData.length - 1)) * graphW;
            const sigVal = Math.min(10, mcuSignalData[i]); // Cap at 10 for display
            const sy = graphY - (sigVal / 10) * graphH;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.textAlign = 'left';
        ctx.fillText('Señal STA/LTA', graphX + 5, graphY - graphH + 12);

        mcuAnimId = requestAnimationFrame(drawMCUFlow);
    }

    updateValLabels();
    drawMCUFlow();
}

function stopMCUFlowViz() {
    if (mcuAnimId) cancelAnimationFrame(mcuAnimId);
}

// ============= 7. START/STOP ALL EDUCATIONAL ANIMATIONS =============
function startEduAnimations() {
    animateEquationsSequentially();
    initSeismograph();
    initSensorViz();
    initQuakeSimulation();
    initTriaxialViz();
    initMCUFlowViz();
}

function stopEduAnimations() {
    stopSeismograph();
    stopSensorViz();
    stopQuakeSimulation();
    stopTriaxialViz();
    stopMCUFlowViz();
}

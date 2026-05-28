// ================================================================
// INTERACTIVE EQUATIONS — 4 Educational 3D Canvas Widgets
// ================================================================

// ============= GLOBALS =============
let ieqAnimIds = {};
let ieqTime = 0;
let ieqInitialized = { mechanism: false, damping: false, freqresp: false, stalta: false };

// Robust resize: handles hidden parents by using fallback dimensions
function ieqResizeCanvas(canvas) {
    const parent = canvas.parentElement;
    let w = parent.clientWidth;
    let h = parent.clientHeight;
    // If parent is hidden, try offsetWidth/Height or use fallback
    if (w < 10) w = parent.offsetWidth || 600;
    if (h < 10) h = parent.offsetHeight || 340;
    if (w < 10) w = 600;
    if (h < 10) h = 340;
    canvas.width = w;
    canvas.height = h;
}

// ============= 1. SEISMOGRAPH MECHANISM WIDGET =============
function initMechanismWidget() {
    const canvas = document.getElementById('ieq-mechanism-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() { ieqResizeCanvas(canvas); }
    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    const traceHistory = [];

    function draw() {
        // Re-check size on each frame
        if (canvas.width < 10 || canvas.height < 10) resize();
        const W = canvas.width, H = canvas.height;
        if (W < 10 || H < 10) { ieqAnimIds.mechanism = requestAnimationFrame(draw); return; }
        ctx.clearRect(0, 0, W, H);

        // Background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0a0e1a');
        bgGrad.addColorStop(1, '#111827');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Grid lines
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < W; i += 30) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
        }
        for (let i = 0; i < H; i += 30) {
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
        }

        t += 0.03;

        // Ground motion — complex composed signal
        const groundX = Math.sin(t * 2.5) * 30 + Math.sin(t * 4.1) * 12 + Math.sin(t * 7) * 5;

        // 3D perspective params
        const cx = W * 0.35, cy = H * 0.45;
        const depth = 0.6;

        // === GROUND / BASE ===
        const baseY = cy + 80;
        const baseW = 200, baseH = 20;

        // Ground shaking layer
        ctx.save();
        ctx.translate(groundX, 0);

        // Ground platform — 3D box
        const gx = cx - baseW / 2, gy = baseY;
        // Top face
        ctx.fillStyle = 'rgba(100, 116, 139, 0.8)';
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + baseW, gy);
        ctx.lineTo(gx + baseW - 15 * depth, gy - 10 * depth);
        ctx.lineTo(gx - 15 * depth, gy - 10 * depth);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Front face
        ctx.fillStyle = 'rgba(71, 85, 105, 0.9)';
        ctx.fillRect(gx, gy, baseW, baseH);
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
        ctx.strokeRect(gx, gy, baseW, baseH);

        // Side pillars (3D frame)
        const pillarW = 8;
        const pillarH = 100;
        const pillarY = gy - pillarH;

        // Left pillar
        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.fillRect(gx + 15, pillarY, pillarW, pillarH);
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        ctx.strokeRect(gx + 15, pillarY, pillarW, pillarH);

        // Right pillar  
        ctx.fillRect(gx + baseW - 23, pillarY, pillarW, pillarH);
        ctx.strokeRect(gx + baseW - 23, pillarY, pillarW, pillarH);

        // Top bar connecting pillars
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        ctx.fillRect(gx + 15, pillarY, baseW - 30, 8);
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        ctx.strokeRect(gx + 15, pillarY, baseW - 30, 8);

        // Frame label
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('MARCO (se mueve)', gx + baseW + 10, pillarY + 50);

        ctx.restore(); // End ground translation

        // === INERTIAL MASS (stays relatively still) ===
        const massResponseDelay = 0.92; // Mass barely moves
        const massX = cx + groundX * (1 - massResponseDelay);
        const massY = pillarY + 35 + Math.sin(t * 0.5) * 2;
        const massW = 50, massH = 30;

        // Spring visualization (connecting mass to frame top bar)
        const springStartX = cx + groundX - baseW / 2 + 15 + pillarW / 2;
        const springEndX = massX - massW / 2;
        const springY = pillarY + 8;

        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const springSegs = 12;
        const springAmp = 8;
        for (let i = 0; i <= springSegs; i++) {
            const frac = i / springSegs;
            const sx = springStartX + (springEndX - springStartX) * frac;
            const sy = springY + 15 + (i % 2 === 0 ? -springAmp : springAmp) * (i > 0 && i < springSegs ? 1 : 0);
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Mass body — glowing cyan box
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 15;
        ctx.fillStyle = 'rgba(0, 212, 255, 0.25)';
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(massX - massW / 2, massY, massW, massH, 6);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Mass label
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('m', massX, massY + massH / 2 + 4);

        // Mass annotation
        ctx.font = 'bold 10px Inter';
        ctx.fillText('MASA INERCIAL (quieta)', massX, massY - 12);

        // === PEN / RECORDING ARM ===
        const penTipX = massX + massW / 2 + 5;
        const penTipY = massY + massH;
        ctx.strokeStyle = '#ff006e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(massX + massW / 2, massY + massH / 2);
        ctx.lineTo(penTipX + 20, penTipY + 15);
        ctx.stroke();

        // Pen tip glow
        ctx.shadowColor = '#ff006e';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff006e';
        ctx.beginPath();
        ctx.arc(penTipX + 20, penTipY + 15, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // === Z(t) TRACE — the recorded signal ===
        const z_t = groundX * massResponseDelay; // Relative displacement
        traceHistory.push(z_t);
        if (traceHistory.length > 200) traceHistory.shift();

        const traceX = W * 0.6;
        const traceY = H * 0.3;
        const traceW = W * 0.35;
        const traceH = 120;

        // Trace background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(traceX, traceY, traceW, traceH, 8);
        ctx.fill();
        ctx.stroke();

        // Trace title
        ctx.fillStyle = '#ff006e';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('z(t) — Desplazamiento Relativo', traceX + 10, traceY + 18);

        // Draw trace
        ctx.strokeStyle = '#ff006e';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ff006e';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        const midTrace = traceY + traceH / 2 + 5;
        traceHistory.forEach((val, i) => {
            const px = traceX + 5 + (i / 200) * (traceW - 10);
            const py = midTrace - val * 1.2;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Zero line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(traceX + 5, midTrace); ctx.lineTo(traceX + traceW - 5, midTrace); ctx.stroke();
        ctx.setLineDash([]);

        // === z(t) ARROW annotation ===
        const arrowX = cx + groundX + baseW / 2 - 60;
        const arrowY1 = baseY - 5;
        const arrowY2 = massY + massH + 5;

        ctx.strokeStyle = '#ff006e';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(arrowX, arrowY2); ctx.lineTo(arrowX, arrowY1); ctx.stroke();
        ctx.setLineDash([]);
        // Arrow head
        ctx.fillStyle = '#ff006e';
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY1);
        ctx.lineTo(arrowX - 4, arrowY1 + 8);
        ctx.lineTo(arrowX + 4, arrowY1 + 8);
        ctx.closePath();
        ctx.fill();

        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('z(t)', arrowX, (arrowY1 + arrowY2) / 2);

        // === MPU6050 badge ===
        const badgeX = W * 0.6, badgeY = H * 0.78;
        ctx.shadowColor = '#8b5cf6';
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, 160, 45, 8);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#8b5cf6';
        ctx.font = 'bold 12px JetBrains Mono';
        ctx.textAlign = 'left';
        ctx.fillText('MPU6050', badgeX + 12, badgeY + 18);
        ctx.font = '10px Inter';
        ctx.fillStyle = 'rgba(139, 92, 246, 0.8)';
        ctx.fillText('Mide esta aceleración', badgeX + 12, badgeY + 34);

        // Arrow from MPU badge to z(t) trace
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(badgeX + 80, badgeY);
        ctx.lineTo(traceX + traceW / 2, traceY + traceH);
        ctx.stroke();
        ctx.setLineDash([]);

        ieqAnimIds.mechanism = requestAnimationFrame(draw);
    }

    draw();
}

function stopMechanismWidget() {
    if (ieqAnimIds.mechanism) cancelAnimationFrame(ieqAnimIds.mechanism);
}

// ============= 2. DAMPING ζ WIDGET =============
function initDampingWidget() {
    const canvas = document.getElementById('ieq-damping-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const slider = document.getElementById('ieq-zeta-slider');
    const valLabel = document.getElementById('ieq-zeta-val');
    const zoneLabel = document.getElementById('ieq-zeta-zone');

    function resize() { ieqResizeCanvas(canvas); }
    resize();
    window.addEventListener('resize', resize);

    let t = 0;

    function draw() {
        if (canvas.width < 10 || canvas.height < 10) resize();
        const W = canvas.width, H = canvas.height;
        if (W < 10 || H < 10) { ieqAnimIds.damping = requestAnimationFrame(draw); return; }
        const zeta = parseFloat(slider ? slider.value : 0.7);
        if (valLabel) valLabel.textContent = zeta.toFixed(2);

        // Update zone label
        if (zoneLabel) {
            if (zeta < 0.5) {
                zoneLabel.textContent = '⚠ Subamortiguado — Rebota y distorsiona';
                zoneLabel.style.color = '#ff006e';
            } else if (zeta <= 1.0) {
                zoneLabel.textContent = '✅ Óptimo — Fidelidad máxima';
                zoneLabel.style.color = '#00ff88';
            } else {
                zoneLabel.textContent = '🐢 Sobreamortiguado — Demasiado lento';
                zoneLabel.style.color = '#f59e0b';
            }
        }

        ctx.clearRect(0, 0, W, H);

        // Background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0a0e1a');
        bgGrad.addColorStop(1, '#111827');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < W; i += 30) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
        }
        for (let i = 0; i < H; i += 30) {
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
        }

        t += 0.02;

        // === LEFT: Impulse Response h(t) ===
        const plotX = 30, plotY = 45;
        const plotW = W * 0.55, plotH = H - 90;
        const midY = plotY + plotH / 2;

        // Plot background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.roundRect(plotX - 5, plotY - 25, plotW + 10, plotH + 40, 8);
        ctx.fill();

        // Title
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('Respuesta al Impulso h(t)', plotX + 5, plotY - 8);

        // Zero line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(plotX, midY); ctx.lineTo(plotX + plotW, midY); ctx.stroke();

        // Axes labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('t (tiempo)', plotX + plotW / 2, plotY + plotH + 15);
        ctx.save();
        ctx.translate(plotX - 15, midY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('h(t)', 0, 0);
        ctx.restore();

        // Draw impulse response for current ζ
        const omega_n = 6; // natural frequency
        const omega_d = omega_n * Math.sqrt(Math.max(0.001, 1 - zeta * zeta));

        ctx.lineWidth = 2.5;
        ctx.beginPath();

        // Color based on zeta zone
        let lineColor;
        if (zeta < 0.5) lineColor = '#ff006e';
        else if (zeta <= 1.0) lineColor = '#00ff88';
        else lineColor = '#f59e0b';

        ctx.strokeStyle = lineColor;
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = 8;

        for (let px = 0; px < plotW; px++) {
            const tVal = (px / plotW) * 5;
            let h;
            if (zeta < 1.0) {
                // Underdamped
                h = Math.exp(-zeta * omega_n * tVal) * Math.sin(omega_d * tVal) / omega_d;
            } else if (zeta === 1.0) {
                // Critically damped
                h = tVal * Math.exp(-omega_n * tVal);
            } else {
                // Overdamped
                const s1 = -omega_n * (zeta - Math.sqrt(zeta * zeta - 1));
                const s2 = -omega_n * (zeta + Math.sqrt(zeta * zeta - 1));
                h = (Math.exp(s1 * tVal) - Math.exp(s2 * tVal)) / (s1 - s2);
            }

            const py = midY - h * plotH * 1.8;
            px === 0 ? ctx.moveTo(plotX + px, py) : ctx.lineTo(plotX + px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Envelope for underdamped
        if (zeta < 1.0 && zeta > 0) {
            ctx.strokeStyle = `rgba(${zeta < 0.5 ? '255,0,110' : '0,255,136'}, 0.25)`;
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            for (let px = 0; px < plotW; px++) {
                const tVal = (px / plotW) * 5;
                const env = Math.exp(-zeta * omega_n * tVal) / omega_d;
                ctx.lineTo(plotX + px, midY - env * plotH * 1.8);
            }
            ctx.stroke();
            ctx.beginPath();
            for (let px = 0; px < plotW; px++) {
                const tVal = (px / plotW) * 5;
                const env = -Math.exp(-zeta * omega_n * tVal) / omega_d;
                ctx.lineTo(plotX + px, midY - env * plotH * 1.8);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // === RIGHT: 3D Mass-Spring Visualization ===
        const vizX = W * 0.62, vizY = H * 0.15;
        const vizW = W * 0.34, vizH = H * 0.7;

        // Compute current displacement
        const impulseT = (t % 5);
        let disp;
        if (zeta < 1.0) {
            disp = Math.exp(-zeta * omega_n * impulseT) * Math.sin(omega_d * impulseT) / omega_d;
        } else if (zeta === 1.0) {
            disp = impulseT * Math.exp(-omega_n * impulseT);
        } else {
            const s1 = -omega_n * (zeta - Math.sqrt(zeta * zeta - 1));
            const s2 = -omega_n * (zeta + Math.sqrt(zeta * zeta - 1));
            disp = (Math.exp(s1 * impulseT) - Math.exp(s2 * impulseT)) / (s1 - s2);
        }
        const massDisp = disp * 80;

        // Anchor point (top)
        const anchorX = vizX + vizW / 2;
        const anchorY = vizY + 10;

        // Mass position
        const massYPos = vizY + vizH * 0.5 + massDisp;

        // Spring (zigzag)
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const springN = 14;
        const springAmpV = 12;
        for (let i = 0; i <= springN; i++) {
            const frac = i / springN;
            const sy = anchorY + 20 + (massYPos - anchorY - 40) * frac;
            const sx = anchorX + (i > 0 && i < springN ? (i % 2 === 0 ? -springAmpV : springAmpV) : 0);
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Damper (parallel to spring, offset)
        const dampX = anchorX + 30;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        // Cylinder
        const dampTop = anchorY + 30;
        const dampBot = massYPos - 20;
        const dampMid = (dampTop + dampBot) / 2;
        ctx.beginPath();
        ctx.moveTo(dampX, anchorY + 20);
        ctx.lineTo(dampX, dampTop);
        ctx.stroke();
        // Piston body
        ctx.strokeRect(dampX - 8, dampTop, 16, (dampBot - dampTop) * 0.6);
        // Piston rod
        ctx.beginPath();
        ctx.moveTo(dampX, dampTop + (dampBot - dampTop) * 0.6);
        ctx.lineTo(dampX, massYPos - 10);
        ctx.stroke();
        // Damper rod
        ctx.beginPath();
        ctx.moveTo(dampX, massYPos - 10);
        ctx.lineTo(dampX, massYPos);
        ctx.stroke();

        // Labels
        ctx.fillStyle = lineColor;
        ctx.font = '10px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('k (resorte)', anchorX - vizW * 0.3, (anchorY + massYPos) / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('c (amortiguador)', dampX + 12, dampMid);

        // Anchor bar
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.fillRect(anchorX - 40, anchorY, 80, 6);
        // Hatching on top
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;
        for (let i = -40; i < 40; i += 8) {
            ctx.beginPath();
            ctx.moveTo(anchorX + i, anchorY);
            ctx.lineTo(anchorX + i + 6, anchorY - 8);
            ctx.stroke();
        }

        // Mass block — glowing
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = 15;
        ctx.fillStyle = `rgba(${zeta < 0.5 ? '255,0,110' : zeta <= 1.0 ? '0,255,136' : '245,158,11'}, 0.3)`;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(anchorX - 25, massYPos, 50, 30, 6);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = lineColor;
        ctx.font = 'bold 14px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('m', anchorX, massYPos + 20);

        // === ζ ZONE BAR at bottom ===
        const barX = 30, barY = H - 25, barW = W - 60;
        const zones = [
            { start: 0, end: 0.5, color: '#ff006e', label: 'Rebota' },
            { start: 0.5, end: 1.0, color: '#00ff88', label: 'ζ≈0.7 Óptimo' },
            { start: 1.0, end: 2.0, color: '#f59e0b', label: 'Lento' }
        ];

        zones.forEach(z => {
            const x1 = barX + (z.start / 2) * barW;
            const x2 = barX + (z.end / 2) * barW;
            ctx.fillStyle = z.color + '30';
            ctx.fillRect(x1, barY, x2 - x1, 12);
            ctx.fillStyle = z.color;
            ctx.font = '9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(z.label, (x1 + x2) / 2, barY - 3);
        });

        // Current ζ marker
        const markerX = barX + (zeta / 2) * barW;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(markerX, barY - 2);
        ctx.lineTo(markerX - 5, barY - 10);
        ctx.lineTo(markerX + 5, barY - 10);
        ctx.closePath();
        ctx.fill();

        ieqAnimIds.damping = requestAnimationFrame(draw);
    }

    if (slider) slider.addEventListener('input', () => { });
    draw();
}

function stopDampingWidget() {
    if (ieqAnimIds.damping) cancelAnimationFrame(ieqAnimIds.damping);
}

// ============= 3. FREQUENCY RESPONSE |H(ω)| WIDGET =============
function initFreqResponseWidget() {
    const canvas = document.getElementById('ieq-freqresp-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const slider = document.getElementById('ieq-freqresp-zeta');
    const valLabel = document.getElementById('ieq-freqresp-val');

    function resize() { ieqResizeCanvas(canvas); }
    resize();
    window.addEventListener('resize', resize);

    let t = 0;

    function draw() {
        if (canvas.width < 10 || canvas.height < 10) resize();
        const W = canvas.width, H = canvas.height;
        if (W < 10 || H < 10) { ieqAnimIds.freqresp = requestAnimationFrame(draw); return; }
        const zeta = parseFloat(slider ? slider.value : 0.7);
        if (valLabel) valLabel.textContent = zeta.toFixed(2);

        ctx.clearRect(0, 0, W, H);

        // Background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0a0e1a');
        bgGrad.addColorStop(1, '#111827');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < W; i += 30) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
        }
        for (let i = 0; i < H; i += 30) {
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
        }

        t += 0.01;

        const plotX = 55, plotY = 45;
        const plotW = W - 80, plotH = H - 100;

        // Plot background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.roundRect(plotX - 10, plotY - 25, plotW + 20, plotH + 50, 10);
        ctx.fill();

        // Title
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('Respuesta en Frecuencia | H(ω) |', plotX, plotY - 8);

        // Axes labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('ω / ω₀  (frecuencia normalizada)', plotX + plotW / 2, plotY + plotH + 25);

        ctx.save();
        ctx.translate(plotX - 35, plotY + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('| H(ω) |', 0, 0);
        ctx.restore();

        // Compute |H(ω)| = (ω/ω₀)² / sqrt((1-(ω/ω₀)²)² + (2ζ(ω/ω₀))²)
        // For a seismometer: H(r) = r² / sqrt((1-r²)² + (2ζr)²) where r = ω/ω₀
        const maxR = 5; // max frequency ratio
        const maxH = 3; // max display gain

        // Y-axis markings
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '9px JetBrains Mono';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 3; i++) {
            const y = plotY + plotH - (i / maxH) * plotH;
            ctx.fillText(i.toFixed(1), plotX - 5, y + 3);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
        }

        // X-axis markings
        ctx.textAlign = 'center';
        for (let i = 0; i <= 5; i++) {
            const x = plotX + (i / maxR) * plotW;
            ctx.fillText(i.toFixed(0), x, plotY + plotH + 12);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke();
        }

        // ω/ω₀ = 1 vertical highlight
        const oneX = plotX + (1 / maxR) * plotW;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(oneX, plotY); ctx.lineTo(oneX, plotY + plotH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '9px Inter';
        ctx.fillText('ω₀', oneX, plotY - 2);

        // Draw multiple ζ curves (faded) for reference
        const refZetas = [0.1, 0.3, 0.5, 0.7, 1.0, 1.5];
        refZetas.forEach(rz => {
            if (Math.abs(rz - zeta) < 0.05) return; // skip if too close to current
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let px = 1; px < plotW; px++) {
                const r = (px / plotW) * maxR;
                const r2 = r * r;
                const mag = r2 / Math.sqrt(Math.pow(1 - r2, 2) + Math.pow(2 * rz * r, 2));
                const clampedMag = Math.min(mag, maxH);
                const y = plotY + plotH - (clampedMag / maxH) * plotH;
                px === 1 ? ctx.moveTo(plotX + px, y) : ctx.lineTo(plotX + px, y);
            }
            ctx.stroke();
        });

        // Main curve — current ζ with gradient
        ctx.lineWidth = 3;
        ctx.beginPath();
        const gradient = ctx.createLinearGradient(plotX, 0, plotX + plotW, 0);
        gradient.addColorStop(0, '#8b5cf6');
        gradient.addColorStop(0.3, '#00d4ff');
        gradient.addColorStop(0.6, '#00ff88');
        gradient.addColorStop(1, '#ff006e');
        ctx.strokeStyle = gradient;
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 8;

        for (let px = 1; px < plotW; px++) {
            const r = (px / plotW) * maxR;
            const r2 = r * r;
            const mag = r2 / Math.sqrt(Math.pow(1 - r2, 2) + Math.pow(2 * zeta * r, 2));
            const clampedMag = Math.min(mag, maxH);
            const y = plotY + plotH - (clampedMag / maxH) * plotH;
            px === 1 ? ctx.moveTo(plotX + px, y) : ctx.lineTo(plotX + px, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Flat band highlight for ζ=0.7 (when ω > ω₀)
        if (zeta >= 0.6 && zeta <= 0.8) {
            // Highlight the flat region
            const flatStartX = plotX + (1.5 / maxR) * plotW;
            const flatY = plotY + plotH - (1.0 / maxH) * plotH;
            ctx.fillStyle = 'rgba(0, 255, 136, 0.08)';
            ctx.fillRect(flatStartX, flatY - 15, plotW - (flatStartX - plotX), 30);
            ctx.fillStyle = '#00ff88';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('← Banda plana — Fidelidad uniforme →', flatStartX + (plotW - (flatStartX - plotX)) / 2, flatY - 20);
        }

        // |H|=1 reference line
        const h1Y = plotY + plotH - (1.0 / maxH) * plotH;
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(plotX, h1Y); ctx.lineTo(plotX + plotW, h1Y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 255, 136, 0.5)';
        ctx.font = '9px JetBrains Mono';
        ctx.textAlign = 'left';
        ctx.fillText('|H|=1', plotX + plotW + 3, h1Y + 3);

        // Animate scanning line
        const scanX = plotX + ((t * 30) % plotW);
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(scanX, plotY); ctx.lineTo(scanX, plotY + plotH); ctx.stroke();

        // ζ label in corner
        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 13px JetBrains Mono';
        ctx.textAlign = 'right';
        ctx.fillText(`ζ = ${zeta.toFixed(2)}`, plotX + plotW, plotY + 15);

        ieqAnimIds.freqresp = requestAnimationFrame(draw);
    }

    draw();
}

function stopFreqResponseWidget() {
    if (ieqAnimIds.freqresp) cancelAnimationFrame(ieqAnimIds.freqresp);
}

// ============= 4. STA/LTA ALGORITHM WIDGET =============
function initSTALTAWidget() {
    const canvas = document.getElementById('ieq-stalta-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const slider = document.getElementById('ieq-stalta-threshold');
    const valLabel = document.getElementById('ieq-stalta-val');

    function resize() { ieqResizeCanvas(canvas); }
    resize();
    window.addEventListener('resize', resize);

    // Generate synthetic seismic signal with P and S waves
    const N = 600;
    const signal = new Float32Array(N);
    const pWaveStart = 180; // Sample index where P wave arrives
    const sWaveStart = 300; // Sample index where S wave arrives

    for (let i = 0; i < N; i++) {
        // Background noise
        let val = (Math.random() - 0.5) * 0.08;

        // P wave — smaller amplitude, higher frequency
        if (i >= pWaveStart && i < sWaveStart) {
            const tP = (i - pWaveStart) / 60;
            val += Math.sin(tP * 15) * 0.3 * Math.exp(-tP * 0.8) +
                Math.sin(tP * 22) * 0.15 * Math.exp(-tP * 1.2);
        }

        // S wave — larger amplitude, lower frequency
        if (i >= sWaveStart) {
            const tS = (i - sWaveStart) / 60;
            val += Math.sin(tS * 8) * 0.8 * Math.exp(-tS * 0.4) +
                Math.sin(tS * 12) * 0.4 * Math.exp(-tS * 0.6) +
                Math.sin(tS * 18) * 0.2 * Math.exp(-tS * 0.9);
        }

        signal[i] = val;
    }

    let t = 0;
    let animProgress = 0;

    function draw() {
        if (canvas.width < 10 || canvas.height < 10) resize();
        if (canvas.width < 10 || canvas.height < 10) { ieqAnimIds.stalta = requestAnimationFrame(draw); return; }
        const W = canvas.width, H = canvas.height;
        const threshold = parseFloat(slider ? slider.value : 3.0);
        if (valLabel) valLabel.textContent = threshold.toFixed(1);

        ctx.clearRect(0, 0, W, H);

        // Background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0a0e1a');
        bgGrad.addColorStop(1, '#111827');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < W; i += 30) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
        }
        for (let i = 0; i < H; i += 30) {
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
        }

        t += 0.02;
        animProgress = Math.min(animProgress + 1.5, N);

        const plotMargin = 45;
        const plotW = W - plotMargin - 20;

        // === TOP: Raw Signal ===
        const sigY = 30, sigH = H * 0.30;
        const sigMid = sigY + sigH / 2;

        // Background for signal
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.roundRect(plotMargin - 5, sigY - 5, plotW + 10, sigH + 10, 6);
        ctx.fill();

        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('Señal Sísmica a(t)', plotMargin, sigY - 10);

        // Draw signal
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        const visibleN = Math.min(animProgress, N);
        for (let i = 0; i < visibleN; i++) {
            const x = plotMargin + (i / N) * plotW;
            const y = sigMid - signal[i] * sigH * 0.8;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // P wave marker
        const pX = plotMargin + (pWaveStart / N) * plotW;
        if (animProgress > pWaveStart) {
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(pX, sigY); ctx.lineTo(pX, sigY + sigH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#00ff88';
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Onda P', pX, sigY + sigH + 14);
            // Arrow
            ctx.beginPath();
            ctx.moveTo(pX, sigY - 2);
            ctx.lineTo(pX - 4, sigY + 6);
            ctx.lineTo(pX + 4, sigY + 6);
            ctx.closePath();
            ctx.fill();
        }

        // S wave marker
        const sX = plotMargin + (sWaveStart / N) * plotW;
        if (animProgress > sWaveStart) {
            ctx.strokeStyle = '#ff006e';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(sX, sigY); ctx.lineTo(sX, sigY + sigH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ff006e';
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Onda S', sX, sigY + sigH + 14);
            ctx.beginPath();
            ctx.moveTo(sX, sigY - 2);
            ctx.lineTo(sX - 4, sigY + 6);
            ctx.lineTo(sX + 4, sigY + 6);
            ctx.closePath();
            ctx.fill();
        }

        // === MIDDLE: STA & LTA Windows ===
        const staLen = 15; // short window
        const ltaLen = 80; // long window

        // Compute STA/LTA ratio
        const ratioArr = new Float32Array(N);
        for (let i = ltaLen; i < N; i++) {
            let sta = 0, lta = 0;
            for (let j = 0; j < staLen; j++) sta += Math.abs(signal[i - j]);
            sta /= staLen;
            for (let j = 0; j < ltaLen; j++) lta += Math.abs(signal[i - j]);
            lta /= ltaLen;
            ratioArr[i] = lta > 0.001 ? sta / lta : 1;
        }

        // === BOTTOM: STA/LTA Ratio ===
        const ratY = H * 0.48, ratH = H * 0.30;
        const ratMid = ratY + ratH;
        const maxRatio = 12;

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.roundRect(plotMargin - 5, ratY - 5, plotW + 10, ratH + 10, 6);
        ctx.fill();

        ctx.fillStyle = '#8b5cf6';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('STA/LTA Ratio R(t)', plotMargin, ratY - 10);

        // Y axis for ratio
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '9px JetBrains Mono';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const val = (i / 4) * maxRatio;
            const y = ratMid - (val / maxRatio) * ratH;
            ctx.fillText(val.toFixed(0), plotMargin - 8, y + 3);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(plotMargin, y); ctx.lineTo(plotMargin + plotW, y); ctx.stroke();
        }

        // Draw ratio
        ctx.lineWidth = 2;
        const ratGrad = ctx.createLinearGradient(plotMargin, 0, plotMargin + plotW, 0);
        ratGrad.addColorStop(0, '#8b5cf6');
        ratGrad.addColorStop(0.5, '#ff006e');
        ratGrad.addColorStop(1, '#f59e0b');
        ctx.strokeStyle = ratGrad;
        ctx.shadowColor = '#8b5cf6';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = ltaLen; i < visibleN; i++) {
            const x = plotMargin + (i / N) * plotW;
            const y = ratMid - Math.min(ratioArr[i], maxRatio) / maxRatio * ratH;
            i === ltaLen ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Threshold line
        const threshY = ratMid - Math.min(threshold, maxRatio) / maxRatio * ratH;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(plotMargin, threshY);
        ctx.lineTo(plotMargin + plotW, threshY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Threshold label
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 10px JetBrains Mono';
        ctx.textAlign = 'right';
        ctx.fillText(`Umbral = ${threshold.toFixed(1)}`, plotMargin + plotW, threshY - 6);

        // Detection triggers — where ratio exceeds threshold
        let triggerPoints = [];
        let inTrigger = false;
        for (let i = ltaLen; i < visibleN; i++) {
            if (ratioArr[i] >= threshold && !inTrigger) {
                triggerPoints.push(i);
                inTrigger = true;
            }
            if (ratioArr[i] < threshold * 0.8) {
                inTrigger = false;
            }
        }

        // Draw detection markers
        triggerPoints.forEach(tp => {
            const tx = plotMargin + (tp / N) * plotW;

            // Vertical line across both plots
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(tx, sigY);
            ctx.lineTo(tx, ratY + ratH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Detection marker — glowing circle
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(tx, threshY, 5 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Label
            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('⚡ DETECCIÓN', tx, ratY - 12);
        });

        // === STA/LTA Window visualization on signal ===
        if (animProgress > ltaLen && animProgress < N) {
            const curI = Math.floor(animProgress);
            const curX = plotMargin + (curI / N) * plotW;

            // LTA window (long, subtle)
            const ltaStartX = plotMargin + (Math.max(0, curI - ltaLen) / N) * plotW;
            ctx.fillStyle = 'rgba(139, 92, 246, 0.08)';
            ctx.fillRect(ltaStartX, sigY, curX - ltaStartX, sigH);
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(ltaStartX, sigY, curX - ltaStartX, sigH);

            // STA window (short, brighter)
            const staStartX = plotMargin + (Math.max(0, curI - staLen) / N) * plotW;
            ctx.fillStyle = 'rgba(0, 212, 255, 0.12)';
            ctx.fillRect(staStartX, sigY, curX - staStartX, sigH);
            ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
            ctx.strokeRect(staStartX, sigY, curX - staStartX, sigH);

            // Labels
            ctx.fillStyle = 'rgba(139, 92, 246, 0.7)';
            ctx.font = '9px Inter';
            ctx.textAlign = 'right';
            ctx.fillText('LTA', ltaStartX - 3, sigY + sigH / 2);

            ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
            ctx.fillText('STA', staStartX - 3, sigY + sigH / 2 - 12);

            // Scanning line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(curX, sigY); ctx.lineTo(curX, sigY + sigH);
            ctx.stroke();
        }

        // === LEGEND ===
        const legY = H - 30;
        const items = [
            { color: '#00ff88', label: 'Onda P (rápida)' },
            { color: '#ff006e', label: 'Onda S (destructiva)' },
            { color: '#f59e0b', label: 'Umbral detección' },
            { color: '#8b5cf6', label: 'LTA ventana' },
            { color: '#00d4ff', label: 'STA ventana' }
        ];
        let lx = plotMargin;
        items.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.fillRect(lx, legY, 10, 10);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.font = '9px Inter';
            ctx.textAlign = 'left';
            ctx.fillText(item.label, lx + 14, legY + 9);
            lx += ctx.measureText(item.label).width + 30;
        });

        // Reset animation cycle
        if (animProgress >= N) {
            animProgress = 0;
        }

        ieqAnimIds.stalta = requestAnimationFrame(draw);
    }

    draw();
}

function stopSTALTAWidget() {
    if (ieqAnimIds.stalta) cancelAnimationFrame(ieqAnimIds.stalta);
}

// ============= START/STOP ALL INTERACTIVE EQUATION WIDGETS =============
function startInteractiveEquations() {
    initMechanismWidget();
    initDampingWidget();
    initFreqResponseWidget();
    initSTALTAWidget();

    // Render KaTeX equations
    setTimeout(() => {
        const eqs = {
            'ieq-eq-mechanism': 'm\\ddot{z} + c\\dot{z} + kz = -m\\ddot{x}_g(t)',
            'ieq-eq-damping': '\\zeta = \\frac{c}{2\\sqrt{mk}} \\qquad h(t) = \\frac{1}{\\omega_d} e^{-\\zeta\\omega_n t} \\sin(\\omega_d t)',
            'ieq-eq-freqresp': '|H(\\omega)| = \\frac{\\left(\\frac{\\omega}{\\omega_0}\\right)^2}{\\sqrt{\\left(1 - \\left(\\frac{\\omega}{\\omega_0}\\right)^2\\right)^2 + \\left(2\\zeta\\frac{\\omega}{\\omega_0}\\right)^2}}',
            'ieq-eq-stalta': 'R(t) = \\frac{\\text{STA}(t)}{\\text{LTA}(t)} = \\frac{\\frac{1}{n_s}\\sum_{i=t-n_s}^{t}|a_i|}{\\frac{1}{n_l}\\sum_{i=t-n_l}^{t}|a_i|}'
        };

        for (const [id, tex] of Object.entries(eqs)) {
            const el = document.getElementById(id);
            if (el && typeof katex !== 'undefined') {
                katex.render(tex, el, { throwOnError: false, displayMode: true });
            }
        }
    }, 100);
}

function stopInteractiveEquations() {
    stopMechanismWidget();
    stopDampingWidget();
    stopFreqResponseWidget();
    stopSTALTAWidget();
}

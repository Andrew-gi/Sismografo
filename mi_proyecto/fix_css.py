import sys

css_file = r'c:\Users\Administrator\Downloads\pagina actigravity\styles.css'

with open(css_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the last occurrence of the about nav-icon block
marker = '.nav-item[data-view="about"] .nav-icon {'
idx = content.rfind(marker)
if idx == -1:
    print("MARKER NOT FOUND")
    sys.exit(1)

# Find the closing brace of that block
close = content.find('}', idx)
# Keep everything up to and including that closing brace
keep = content[:close+2]  # +2 to include } and newline

new_css = """

.nav-icon {
    font-size: 1.3rem;
    transition: transform 0.2s ease;
}

.nav-item:hover .nav-icon {
    transform: scale(1.15);
}

/* ============================================
   SISBOT GUIDE CHARACTER
   ============================================ */
.hero-visual {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

.hero-wave-svg {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    opacity: 0.35;
    pointer-events: none;
}

.sisbot-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 2;
    gap: 4px;
}

.sisbot-bubble {
    position: relative;
    background: rgba(15, 23, 42, 0.94);
    backdrop-filter: blur(12px);
    border: 1.5px solid rgba(59, 130, 246, 0.55);
    border-radius: 16px;
    padding: 14px 18px;
    max-width: 300px;
    font-size: 0.82rem;
    line-height: 1.55;
    color: rgba(255,255,255,0.92);
    box-shadow: 0 8px 32px rgba(14,165,233,0.2), 0 0 0 1px rgba(59,130,246,0.08);
    text-align: center;
    animation: sisbot-bubble-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.sisbot-bubble strong {
    color: #38bdf8;
}

.sisbot-bubble-tail {
    position: absolute;
    bottom: -11px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 10px solid transparent;
    border-right: 10px solid transparent;
    border-top: 12px solid rgba(59, 130, 246, 0.55);
}

.sisbot-bubble-tail::after {
    content: '';
    position: absolute;
    top: -13px;
    left: -9px;
    width: 0;
    height: 0;
    border-left: 9px solid transparent;
    border-right: 9px solid transparent;
    border-top: 11px solid rgba(15, 23, 42, 0.94);
}

.sisbot-character {
    cursor: pointer;
    user-select: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
}

.sisbot-svg {
    width: 130px;
    height: auto;
    animation: sisbot-float 3.5s ease-in-out infinite;
    filter: drop-shadow(0 16px 32px rgba(14, 165, 233, 0.30)) drop-shadow(0 4px 12px rgba(0,0,0,0.5));
    transition: filter 0.3s ease;
}

.sisbot-character:hover .sisbot-svg {
    filter: drop-shadow(0 20px 40px rgba(14, 165, 233, 0.55)) drop-shadow(0 4px 12px rgba(0,0,0,0.5));
    animation-play-state: paused;
}

.sisbot-character:active .sisbot-svg {
    transform: scale(0.96);
    transition: transform 0.1s ease;
}

.sisbot-click-hint {
    font-size: 0.68rem;
    color: rgba(255,255,255,0.32);
    letter-spacing: 0.5px;
    animation: sisbot-hint-pulse 2s ease-in-out infinite;
}

.sisbot-eye-glow {
    animation: sisbot-blink 5s ease-in-out infinite;
}

.sisbot-antenna-dot {
    animation: sisbot-antenna-pulse 2s ease-in-out infinite;
}

.sisbot-led {
    animation: sisbot-led-blink 1.8s ease-in-out infinite;
}

.sisbot-wave-line {
    stroke-dasharray: 120;
    stroke-dashoffset: 0;
    animation: sisbot-wave-draw 3s ease-in-out infinite;
}

@keyframes sisbot-float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-12px); }
}

@keyframes sisbot-blink {
    0%, 90%, 100% { opacity: 1; }
    95%, 98% { opacity: 0.08; }
}

@keyframes sisbot-antenna-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

@keyframes sisbot-led-blink {
    0%, 78%, 100% { opacity: 1; }
    88% { opacity: 0.15; }
}

@keyframes sisbot-wave-draw {
    0% { stroke-dashoffset: 120; opacity: 0.4; }
    50% { stroke-dashoffset: 0; opacity: 1; }
    100% { stroke-dashoffset: -120; opacity: 0.4; }
}

@keyframes sisbot-bubble-in {
    0% { opacity: 0; transform: scale(0.7) translateY(10px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes sisbot-hint-pulse {
    0%, 100% { opacity: 0.32; }
    50% { opacity: 0.65; }
}

.sisbot-bubble.text-change {
    animation: sisbot-text-anim 0.35s ease;
}

@keyframes sisbot-text-anim {
    0% { opacity: 1; transform: scale(1); }
    40% { opacity: 0; transform: scale(0.93) translateY(-4px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* ============================================
   3D WAVE CANVAS - Grayscale Illustration Style
   ============================================ */
#wave-canvas {
    border-radius: 10px;
    border: 1px solid rgba(148,163,184,0.10);
    box-shadow: inset 0 0 60px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.35);
}
"""

final = keep + new_css
with open(css_file, 'w', encoding='utf-8') as f:
    f.write(final)

print("SUCCESS: CSS fixed, total chars:", len(final))

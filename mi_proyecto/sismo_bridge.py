import json
import math
import os
import re
import sys
import time
from collections import deque
from datetime import datetime, timezone

try:
    import serial
except Exception as exc:  # pragma: no cover - depends on environment
    serial = None
    SERIAL_IMPORT_ERROR = str(exc)
else:
    SERIAL_IMPORT_ERROR = None


PORT = os.getenv("SISMO_SERIAL_PORT", "COM3")
BAUD = int(os.getenv("SISMO_SERIAL_BAUD", "115200"))
BUFFER_SIZE = int(os.getenv("SISMO_BUFFER_SIZE", "256"))
WINDOW_SIZE = int(os.getenv("SISMO_WINDOW_SIZE", "40"))
EMIT_INTERVAL = float(os.getenv("SISMO_EMIT_INTERVAL", "0.18"))

MULT_BAJO = 3.0
MULT_INTERMEDIO = 12.0
MULT_FUERTE = 25.0


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SismoBridge:
    def __init__(self):
        self.pattern = re.compile(r"[, \t]+")
        self.ser = None
        self.last_connect_attempt = 0.0
        self.connected = False
        self.status = "starting"
        self.message = "Iniciando puente serial"

        self.buffer = deque(maxlen=BUFFER_SIZE)
        self.timestamp_buffer = deque(maxlen=BUFFER_SIZE)
        self.accel_history = deque(maxlen=90)

        self.base_ax = 0.0
        self.base_ay = 0.0
        self.base_az = 0.0
        self.quiet_rms = 0.0
        self.calibrated = False
        self.calib_start = None
        self.calib_samples = []
        self.quiet_samples = []

        self.square_buffer = [0.0] * WINDOW_SIZE
        self.buf_index = 0
        self.sum_squares = 0.0
        self.buf_filled = False

        self.level_num = 0
        self.level_text = "Sin conexion"
        self.level_color = "gray"
        self.magnitude_est = 0.0
        self.max_magnitude_today = 0.0
        self.events_today = 0
        self.active_alerts = 0
        self.last_strong_state = False
        self.current_day = datetime.now().date()
        self.last_sample = {"ax": 0.0, "ay": 0.0, "az": 0.0, "magnitude": 0.0}

    def reset_calibration(self):
        self.base_ax = 0.0
        self.base_ay = 0.0
        self.base_az = 0.0
        self.quiet_rms = 0.0
        self.calibrated = False
        self.calib_start = None
        self.calib_samples = []
        self.quiet_samples = []
        self.square_buffer = [0.0] * WINDOW_SIZE
        self.buf_index = 0
        self.sum_squares = 0.0
        self.buf_filled = False
        self.level_num = 0
        self.level_text = "Calibrando..."
        self.level_color = "gray"
        self.magnitude_est = 0.0
        self.active_alerts = 0
        self.last_strong_state = False

    def connect(self):
        if serial is None:
            self.status = "serial_import_error"
            self.message = f"pyserial no disponible: {SERIAL_IMPORT_ERROR}"
            self.connected = False
            return

        now = time.time()
        if now - self.last_connect_attempt < 3.0:
            return

        self.last_connect_attempt = now

        try:
            self.ser = serial.Serial(PORT, BAUD, timeout=0.2)
            time.sleep(2)
            self.connected = True
            self.status = "connected"
            self.message = f"Puerto {PORT} abierto"
            self.reset_calibration()
        except Exception as exc:  # pragma: no cover - depends on environment
            self.ser = None
            self.connected = False
            self.status = "port_error"
            self.message = f"No se pudo abrir {PORT}: {exc}"

    def disconnect(self, message):
        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
        except Exception:
            pass

        self.ser = None
        self.connected = False
        self.status = "disconnected"
        self.message = message

    def get_rms_now(self):
        n = WINDOW_SIZE if self.buf_filled else self.buf_index
        if n <= 0:
            return 0.0
        return math.sqrt(self.sum_squares / n)

    def estimate_sample_rate(self):
        if len(self.timestamp_buffer) < 2:
            return 0.0

        diffs = []
        prev = None
        for ts in self.timestamp_buffer:
            if prev is not None:
                diff = ts - prev
                if 0.0 < diff < 1.0:
                    diffs.append(diff)
            prev = ts

        if not diffs:
            return 0.0
        return 1.0 / (sum(diffs) / len(diffs))

    def determine_level(self, rms_now):
        if not self.calibrated or self.quiet_rms <= 0.0 or rms_now <= 0.0:
            return 0, "Sin actividad", "gray"

        thr_bajo = self.quiet_rms * MULT_BAJO
        thr_inter = self.quiet_rms * MULT_INTERMEDIO
        thr_fuerte = self.quiet_rms * MULT_FUERTE

        if rms_now >= thr_fuerte:
            return 3, "Fuerte", "#d9534f"
        if rms_now >= thr_inter:
            return 2, "Moderado", "#f0ad4e"
        if rms_now >= thr_bajo:
            return 1, "Leve", "#5cb85c"
        return 0, "Sin actividad", "gray"

    def compute_magnitude(self, rms_now):
        if self.quiet_rms <= 0.0 or rms_now <= 0.0:
            return 0.0

        ratio = max(rms_now / max(self.quiet_rms, 1e-9), 1e-9)
        r1, m1 = MULT_BAJO, 3.0
        r2, m2 = MULT_INTERMEDIO, 4.0
        r3, m3 = MULT_FUERTE, 5.5
        x = math.log10(ratio + 1.0)
        x1 = math.log10(r1 + 1.0)
        x2 = math.log10(r2 + 1.0)
        x3 = math.log10(r3 + 1.0)

        if x <= x2:
            slope = (m2 - m1) / max(x2 - x1, 1e-9)
            bias = m1 - slope * x1
            mag = bias + slope * x
        else:
            slope = (m3 - m2) / max(x3 - x2, 1e-9)
            bias = m2 - slope * x2
            mag = bias + slope * x

        return round(max(0.0, min(9.9, mag)), 2)

    def update_daily_counters(self):
        today = datetime.now().date()
        if today != self.current_day:
            self.current_day = today
            self.events_today = 0
            self.max_magnitude_today = 0.0
            self.last_strong_state = False

    def process_sample(self, ax, ay, az):
        ts = time.time()
        magnitude = math.sqrt(ax * ax + ay * ay + az * az)
        self.buffer.append(round(magnitude, 4))
        self.timestamp_buffer.append(ts)
        self.accel_history.append(
            {"ax": round(ax, 4), "ay": round(ay, 4), "az": round(az, 4)}
        )
        self.last_sample = {
            "ax": round(ax, 4),
            "ay": round(ay, 4),
            "az": round(az, 4),
            "magnitude": round(magnitude, 4)
        }

        if not self.calibrated:
            if self.calib_start is None:
                self.calib_start = ts

            elapsed = ts - self.calib_start
            if elapsed < 2.0:
                self.calib_samples.append((ax, ay, az))
            elif elapsed < 3.0:
                self.quiet_samples.append((ax, ay, az))
            else:
                self.finish_calibration()
            return

        dx = ax - self.base_ax
        dy = ay - self.base_ay
        dz = az - self.base_az
        delta_mag = math.sqrt(dx * dx + dy * dy + dz * dz)
        square = delta_mag * delta_mag

        if not self.buf_filled:
            self.square_buffer[self.buf_index] = square
            self.sum_squares += square
            self.buf_index += 1
            if self.buf_index >= WINDOW_SIZE:
                self.buf_index = 0
                self.buf_filled = True
        else:
            self.sum_squares -= self.square_buffer[self.buf_index]
            self.square_buffer[self.buf_index] = square
            self.sum_squares += square
            self.buf_index = (self.buf_index + 1) % WINDOW_SIZE

        rms_now = self.get_rms_now()
        self.level_num, self.level_text, self.level_color = self.determine_level(rms_now)
        self.magnitude_est = self.compute_magnitude(rms_now) if self.level_num > 0 else 0.0
        self.active_alerts = 1 if self.level_num == 3 else 0
        self.status = "streaming"
        self.message = "Lectura serial activa"

        self.update_daily_counters()
        if self.magnitude_est > self.max_magnitude_today:
            self.max_magnitude_today = self.magnitude_est

        strong_now = self.level_num == 3
        if strong_now and not self.last_strong_state:
            self.events_today += 1
        self.last_strong_state = strong_now

    def finish_calibration(self):
        if self.calib_samples:
            self.base_ax = sum(v[0] for v in self.calib_samples) / len(self.calib_samples)
            self.base_ay = sum(v[1] for v in self.calib_samples) / len(self.calib_samples)
            self.base_az = sum(v[2] for v in self.calib_samples) / len(self.calib_samples)

        if self.quiet_samples:
            total = 0.0
            for x, y, z in self.quiet_samples:
                dx = x - self.base_ax
                dy = y - self.base_ay
                dz = z - self.base_az
                delta_mag = math.sqrt(dx * dx + dy * dy + dz * dz)
                total += delta_mag * delta_mag
            self.quiet_rms = math.sqrt(total / len(self.quiet_samples))
        else:
            self.quiet_rms = 0.01

        self.calibrated = True
        self.status = "streaming"
        self.message = "Calibracion terminada"
        self.level_text = "Sin actividad"
        self.level_color = "gray"

    def read_once(self):
        if not self.connected:
            self.connect()
            return

        try:
            raw = self.ser.readline()
        except Exception as exc:  # pragma: no cover - depends on environment
            self.disconnect(f"Lectura interrumpida: {exc}")
            return

        if not raw:
            return

        line = raw.decode("utf-8", errors="ignore").strip()
        if not line:
            return

        parts = self.pattern.split(line)
        if len(parts) < 3:
            return

        try:
            ax = float(parts[0])
            ay = float(parts[1])
            az = float(parts[2])
        except ValueError:
            return

        self.process_sample(ax, ay, az)

    def snapshot(self):
        return {
            "connected": self.connected,
            "calibrated": self.calibrated,
            "source": "serial",
            "port": PORT,
            "status": self.status,
            "level_num": self.level_num,
            "level_text": self.level_text if self.connected else "Sin conexion",
            "level_color": self.level_color if self.connected else "gray",
            "magnitude_est": round(self.magnitude_est, 2),
            "max_magnitude_today": round(self.max_magnitude_today, 2),
            "rms_now": round(self.get_rms_now(), 4),
            "quiet_rms": round(self.quiet_rms, 4),
            "sample_rate": round(self.estimate_sample_rate(), 2),
            "sample_count": len(self.buffer),
            "events_today": self.events_today,
            "active_alerts": self.active_alerts,
            "last_sample": self.last_sample,
            "history": list(self.buffer),
            "accel_history": list(self.accel_history),
            "message": self.message,
            "timestamp": now_iso()
        }


def emit(snapshot):
    sys.stdout.write(json.dumps(snapshot, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    bridge = SismoBridge()
    next_emit = 0.0

    while True:
        bridge.read_once()

        now = time.time()
        if now >= next_emit:
            emit(bridge.snapshot())
            next_emit = now + EMIT_INTERVAL

        time.sleep(0.01)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass

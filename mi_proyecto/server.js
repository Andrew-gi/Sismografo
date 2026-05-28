const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");
const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const { spawn } = require("child_process");
const dotenv = require("dotenv");
const { query, pool } = require("./db");
const { upload } = require("./uploads");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "cambia-esta-clave";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const SISMO_BRIDGE_PATH = path.join(__dirname, "sismo_bridge.py");
const SISMO_DB_PERSIST_INTERVAL_MS = Math.max(1500, Number(process.env.SISMO_DB_PERSIST_INTERVAL_MS || 4000));
const SISMO_DB_TABLE = "eventos_hardware_sismo";
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function createEmptySismoSnapshot() {
  return {
    connected: false,
    calibrated: false,
    source: "serial",
    port: process.env.SISMO_SERIAL_PORT || "COM3",
    status: "disconnected",
    level_num: 0,
    level_text: "Sin conexion",
    level_color: "gray",
    magnitude_est: 0,
    max_magnitude_today: 0,
    rms_now: 0,
    quiet_rms: 0,
    sample_rate: 0,
    sample_count: 0,
    events_today: 0,
    active_alerts: 0,
    last_sample: { ax: 0, ay: 0, az: 0, magnitude: 0 },
    history: [],
    accel_history: [],
    message: "Esperando enlace con el puente del sismografo",
    timestamp: new Date().toISOString()
  };
}

const sismoRealtime = {
  bridgeSnapshot: createEmptySismoSnapshot(),
  currentSnapshot: createEmptySismoSnapshot(),
  bridgeProcess: null,
  clients: new Set(),
  simulationInterval: null,
  shuttingDown: false,
  persistReady: false,
  persistInFlight: false,
  persistLastAtMs: 0,
  persistLastLevel: -1,
  persistLastHash: ""
};

function clampNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (!value) return "usuario";
  if (value === "administrador") return "admin";
  return value;
}

function toDbRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "admin" ? "administrador" : normalized;
}

function mapUser(row) {
  if (!row) return null;
  return {
    usuario_id: row.usuario_id,
    nombre: row.nombre,
    email: row.email,
    telefono: row.telefono,
    telegram_id: row.telegram_id,
    rol: normalizeRole(row.rol),
    activo: Boolean(row.activo),
    fecha_registro: row.fecha_registro,
    archivos: row.archivos || null
  };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function safeCompareStrings(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;

  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 3) return false;
    const [, salt, digest] = parts;
    const computed = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return safeCompareStrings(computed, digest);
  }

  if (/^[A-Fa-f0-9]{64}$/.test(storedHash)) {
    return safeCompareStrings(sha256Hex(password), storedHash);
  }

  return safeCompareStrings(String(password), String(storedHash));
}

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.usuario_id,
      email: user.email,
      rol: user.rol
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function sanitizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sanitizeOptionalText(value, maxLength = 255) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function quoteIdentifier(identifier) {
  if (!SAFE_IDENTIFIER.test(String(identifier || ""))) {
    throw new Error("Identificador SQL invalido.");
  }
  return `\`${identifier}\``;
}

async function getUserByEmail(email) {
  const rows = await query(
    `SELECT usuario_id, nombre, email, telefono, telegram_id, rol, activo, fecha_registro, password_hash, archivos
     FROM usuarios
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [sanitizeEmail(email)]
  );
  return rows[0] || null;
}

async function getUserById(userId) {
  const rows = await query(
    `SELECT usuario_id, nombre, email, telefono, telegram_id, rol, activo, fecha_registro, password_hash, archivos
     FROM usuarios
     WHERE usuario_id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function requireUserExists(userId) {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("Usuario no encontrado.");
  }
  return user;
}

async function listUsersForReports() {
  const rows = await query(
    `SELECT usuario_id, nombre, email, telefono, telegram_id, rol, activo, fecha_registro, archivos
     FROM usuarios
     ORDER BY usuario_id ASC`
  );
  return rows.map(mapUser);
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: "Token requerido." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.sub);
    if (!user || !user.activo) {
      return res.status(401).json({ ok: false, message: "Sesion invalida o usuario inactivo." });
    }
    req.auth = payload;
    req.user = mapUser(user);
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, message: "Token invalido o vencido." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.rol !== "admin") {
    return res.status(403).json({ ok: false, message: "Se requiere rol admin." });
  }
  return next();
}

function validatePasswordOrThrow(password) {
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("La contrasena debe tener al menos 6 caracteres.");
  }
}

function makeSnapshotHash(snapshot) {
  const sample = snapshot?.last_sample || {};
  return [
    snapshot?.level_num ?? 0,
    Math.round(clampNumber(snapshot?.rms_now) * 10),
    Math.round(clampNumber(snapshot?.magnitude_est) * 100),
    Math.round(clampNumber(sample?.ax)),
    Math.round(clampNumber(sample?.ay)),
    Math.round(clampNumber(sample?.az)),
    snapshot?.status || ""
  ].join("|");
}

function shouldPersistSnapshot(snapshot) {
  if (!sismoRealtime.persistReady) return false;
  if (!snapshot || snapshot.source !== "serial") return false;
  if (!snapshot.connected || !snapshot.calibrated) return false;
  if (String(snapshot.status || "").toLowerCase() !== "streaming") return false;

  const nowMs = Date.now();
  const level = Number(snapshot.level_num || 0);
  const hash = makeSnapshotHash(snapshot);
  const elapsed = nowMs - sismoRealtime.persistLastAtMs;
  const levelChanged = level !== sismoRealtime.persistLastLevel;
  const changedEnough = hash !== sismoRealtime.persistLastHash;
  const highPriority = level >= 2;

  if (levelChanged && elapsed >= 900) return true;
  if (highPriority && changedEnough && elapsed >= 1400) return true;
  if (changedEnough && elapsed >= SISMO_DB_PERSIST_INTERVAL_MS) return true;
  return false;
}

async function ensureSismoPersistenceSchema() {
  await query(
    `CREATE TABLE IF NOT EXISTS ${SISMO_DB_TABLE} (
      evento_hw_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      timestamp_iso VARCHAR(40) NOT NULL,
      fuente VARCHAR(32) NOT NULL DEFAULT 'serial',
      puerto VARCHAR(32) NOT NULL DEFAULT 'COM3',
      estado VARCHAR(40) NOT NULL DEFAULT 'streaming',
      nivel_num TINYINT NOT NULL DEFAULT 0,
      nivel_texto VARCHAR(24) NOT NULL DEFAULT 'Sin actividad',
      magnitud_estimada DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      rms_actual DOUBLE NOT NULL DEFAULT 0,
      rms_reposo DOUBLE NOT NULL DEFAULT 0,
      frecuencia_muestreo DOUBLE NOT NULL DEFAULT 0,
      ax DOUBLE NOT NULL DEFAULT 0,
      ay DOUBLE NOT NULL DEFAULT 0,
      az DOUBLE NOT NULL DEFAULT 0,
      vector_magnitud DOUBLE NOT NULL DEFAULT 0,
      payload_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (evento_hw_id),
      KEY idx_hw_created_at (created_at),
      KEY idx_hw_nivel (nivel_num)
    )`
  );
  sismoRealtime.persistReady = true;
}

async function persistSismoSnapshot(snapshot) {
  if (!shouldPersistSnapshot(snapshot)) return;
  if (sismoRealtime.persistInFlight) return;

  sismoRealtime.persistInFlight = true;
  try {
    const sample = snapshot.last_sample || {};
    const payloadJson = JSON.stringify({
      level_num: snapshot.level_num ?? 0,
      level_text: snapshot.level_text || "Sin actividad",
      max_magnitude_today: clampNumber(snapshot.max_magnitude_today),
      sample_count: clampNumber(snapshot.sample_count)
    });

    await query(
      `INSERT INTO ${SISMO_DB_TABLE} (
        timestamp_iso, fuente, puerto, estado, nivel_num, nivel_texto,
        magnitud_estimada, rms_actual, rms_reposo, frecuencia_muestreo,
        ax, ay, az, vector_magnitud, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(snapshot.timestamp || new Date().toISOString()),
        String(snapshot.source || "serial"),
        String(snapshot.port || process.env.SISMO_SERIAL_PORT || "COM3"),
        String(snapshot.status || "streaming"),
        clampNumber(snapshot.level_num),
        String(snapshot.level_text || "Sin actividad"),
        clampNumber(snapshot.magnitude_est),
        clampNumber(snapshot.rms_now),
        clampNumber(snapshot.quiet_rms),
        clampNumber(snapshot.sample_rate),
        clampNumber(sample.ax),
        clampNumber(sample.ay),
        clampNumber(sample.az),
        clampNumber(sample.magnitude),
        payloadJson
      ]
    );

    sismoRealtime.persistLastAtMs = Date.now();
    sismoRealtime.persistLastLevel = Number(snapshot.level_num || 0);
    sismoRealtime.persistLastHash = makeSnapshotHash(snapshot);
  } catch (error) {
    console.warn(`[sismo db] No se pudo guardar evento hardware: ${error.message}`);
  } finally {
    sismoRealtime.persistInFlight = false;
  }
}

function broadcastSismoSnapshot(snapshot) {
  sismoRealtime.currentSnapshot = snapshot;
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of sismoRealtime.clients) {
    client.write(payload);
  }
}

function applyBridgeSnapshot(snapshot) {
  sismoRealtime.bridgeSnapshot = {
    ...createEmptySismoSnapshot(),
    ...snapshot
  };
  if (!sismoRealtime.simulationInterval) {
    broadcastSismoSnapshot(sismoRealtime.bridgeSnapshot);
  }
  persistSismoSnapshot(sismoRealtime.bridgeSnapshot);
}

function computeSimulationLevel(rms) {
  if (rms >= 22) return { level_num: 3, level_text: "Fuerte", level_color: "#d9534f", magnitude_est: 5.8 };
  if (rms >= 10) return { level_num: 2, level_text: "Moderado", level_color: "#f0ad4e", magnitude_est: 4.3 };
  if (rms >= 4) return { level_num: 1, level_text: "Leve", level_color: "#5cb85c", magnitude_est: 3.2 };
  return { level_num: 0, level_text: "Sin actividad", level_color: "gray", magnitude_est: 0 };
}

function startSyntheticSismoSimulation({ intensity = 2.4, durationMs = 9000 } = {}) {
  const safeIntensity = Math.max(0.6, Math.min(Number(intensity) || 2.4, 4.8));
  const safeDuration = Math.max(3000, Math.min(Number(durationMs) || 9000, 30000));
  const baseline = sismoRealtime.bridgeSnapshot;
  const history = [];
  const accelHistory = [];
  const sampleRate = 12.5;
  const startedAt = Date.now();

  if (sismoRealtime.simulationInterval) {
    clearInterval(sismoRealtime.simulationInterval);
    sismoRealtime.simulationInterval = null;
  }

  sismoRealtime.simulationInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = now - startedAt;
    const progress = elapsed / safeDuration;

    if (progress >= 1) {
      clearInterval(sismoRealtime.simulationInterval);
      sismoRealtime.simulationInterval = null;
      broadcastSismoSnapshot(sismoRealtime.bridgeSnapshot);
      return;
    }

    const envelope = Math.sin(Math.PI * Math.min(progress, 1));
    const carrierA = Math.sin(elapsed / 170);
    const carrierB = Math.sin(elapsed / 95 + 0.7);
    const carrierC = Math.cos(elapsed / 135 + 1.2);
    const ax = envelope * safeIntensity * 4.5 * carrierA;
    const ay = envelope * safeIntensity * 3.8 * carrierB;
    const az = 9.81 + envelope * safeIntensity * 2.9 * carrierC;
    const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
    const rms = Math.abs(envelope * safeIntensity * 11.5);
    const level = computeSimulationLevel(rms);

    history.push(Number(magnitude.toFixed(4)));
    accelHistory.push({
      ax: Number(ax.toFixed(4)),
      ay: Number(ay.toFixed(4)),
      az: Number(az.toFixed(4))
    });

    while (history.length > 120) history.shift();
    while (accelHistory.length > 90) accelHistory.shift();

    const snapshot = {
      ...baseline,
      connected: true,
      calibrated: true,
      source: "simulacion-web",
      port: "virtual",
      status: "streaming",
      sample_rate: sampleRate,
      sample_count: history.length,
      level_num: level.level_num,
      level_text: level.level_text,
      level_color: level.level_color,
      magnitude_est: level.magnitude_est,
      max_magnitude_today: Math.max(baseline.max_magnitude_today || 0, level.magnitude_est),
      rms_now: Number(rms.toFixed(4)),
      quiet_rms: baseline.quiet_rms || 0.35,
      active_alerts: level.level_num === 3 ? 1 : 0,
      events_today: (baseline.events_today || 0) + (level.level_num >= 2 ? 1 : 0),
      last_sample: {
        ax: Number(ax.toFixed(4)),
        ay: Number(ay.toFixed(4)),
        az: Number(az.toFixed(4)),
        magnitude: Number(magnitude.toFixed(4))
      },
      history: [...history],
      accel_history: [...accelHistory],
      message: "Pulso sintetico enviado desde la pagina web",
      timestamp: new Date(now).toISOString()
    };

    broadcastSismoSnapshot(snapshot);
  }, 120);
}

function resolvePythonCommand() {
  if (process.env.PYTHON_BIN) return { command: process.env.PYTHON_BIN, args: [SISMO_BRIDGE_PATH] };

  const localPython312 = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python312", "python.exe")
    : null;

  if (localPython312 && fs.existsSync(localPython312)) {
    return { command: localPython312, args: [SISMO_BRIDGE_PATH] };
  }

  if (process.platform === "win32") return { command: "py", args: ["-3", SISMO_BRIDGE_PATH] };
  return { command: "python3", args: [SISMO_BRIDGE_PATH] };
}

function launchSismoBridge() {
  const { command, args } = resolvePythonCommand();
  const child = spawn(command, args, {
    cwd: __dirname,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        applyBridgeSnapshot(JSON.parse(trimmed));
      } catch (_error) {
        console.warn("[sismo] No se pudo interpretar el JSON del puente.");
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const message = chunk.toString("utf8").trim();
    if (message) console.warn(`[sismo bridge] ${message}`);
  });

  child.on("error", (error) => {
    if (sismoRealtime.bridgeProcess === child) sismoRealtime.bridgeProcess = null;
    applyBridgeSnapshot({
      connected: false,
      status: "bridge_error",
      message: `No se pudo iniciar Python: ${error.message}`
    });
    if (!sismoRealtime.shuttingDown) setTimeout(ensureSismoBridge, 3000);
  });

  child.on("close", (code) => {
    if (sismoRealtime.bridgeProcess === child) sismoRealtime.bridgeProcess = null;
    if (!sismoRealtime.shuttingDown) {
      applyBridgeSnapshot({
        connected: false,
        status: "bridge_closed",
        message: `El puente del sismografo se cerro (codigo ${code ?? "desconocido"})`
      });
      setTimeout(ensureSismoBridge, 3000);
    }
  });

  sismoRealtime.bridgeProcess = child;
}

function ensureSismoBridge() {
  if (sismoRealtime.shuttingDown || sismoRealtime.bridgeProcess) return;
  launchSismoBridge();
}

async function getTableColumns(tableName) {
  if (!SAFE_IDENTIFIER.test(String(tableName || ""))) {
    throw new Error("Nombre de tabla invalido.");
  }

  const rows = await query(
    `SELECT COLUMN_NAME, COLUMN_KEY, EXTRA, IS_NULLABLE, DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName]
  );

  if (!rows.length) {
    throw new Error("La tabla solicitada no existe.");
  }

  return rows;
}

function normalizeDbValue(column, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const dataType = String(column.DATA_TYPE || "").toLowerCase();
  if (dataType === "tinyint" && column.COLUMN_NAME === "activo") {
    return value ? 1 : 0;
  }
  return value;
}

function buildWritableData(payload, columns, { forInsert = false, primaryKey = null } = {}) {
  const columnMap = new Map(columns.map((column) => [column.COLUMN_NAME, column]));
  const entries = [];

  for (const [key, rawValue] of Object.entries(payload || {})) {
    const column = columnMap.get(key);
    if (!column) continue;
    if (column.EXTRA.includes("auto_increment")) continue;
    if (!forInsert && primaryKey && key === primaryKey) continue;
    entries.push([key, normalizeDbValue(column, rawValue)]);
  }

  return entries;
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/api/auth/register", async (req, res) => {
  try {
    const nombre = sanitizeOptionalText(req.body?.nombre, 100);
    const email = sanitizeEmail(req.body?.email);
    const telefono = sanitizeOptionalText(req.body?.telefono, 20) ?? null;
    const telegramId = sanitizeOptionalText(req.body?.telegram_id, 50) ?? null;
    const password = req.body?.password;

    if (!nombre) {
      return res.status(400).json({ ok: false, message: "El nombre es obligatorio." });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "Correo electronico invalido." });
    }
    validatePasswordOrThrow(password);

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, message: "Ese correo ya esta registrado." });
    }

    const passwordHash = hashPassword(password);
    const result = await query(
      `INSERT INTO usuarios (nombre, email, telefono, telegram_id, rol, activo, fecha_registro, password_hash)
       VALUES (?, ?, ?, ?, 'usuario', 1, CURDATE(), ?)`,
      [nombre, email, telefono, telegramId, passwordHash]
    );

    const created = await requireUserExists(result.insertId);
    return res.status(201).json({
      ok: true,
      message: "Registro exitoso.",
      user: mapUser(created)
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = sanitizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "Debes enviar correo y contrasena." });
    }

    const userRow = await getUserByEmail(email);
    if (!userRow || !userRow.activo) {
      return res.status(401).json({ ok: false, message: "Credenciales invalidas." });
    }

    if (!userRow.password_hash) {
      return res.status(400).json({
        ok: false,
        message: "La cuenta existe pero no tiene contrasena configurada."
      });
    }

    const validPassword = verifyPassword(password, userRow.password_hash);
    if (!validPassword) {
      return res.status(401).json({ ok: false, message: "Credenciales invalidas." });
    }

    const user = mapUser(userRow);
    return res.json({
      ok: true,
      token: signAuthToken(user),
      user
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "No se pudo iniciar sesion.", error: error.message });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  return res.json({
    ok: true,
    user: req.user
  });
});

app.get("/api/admin/usuarios", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT usuario_id, nombre, email, telefono, telegram_id, rol, activo, fecha_registro, archivos
       FROM usuarios
       ORDER BY usuario_id ASC`
    );
    const data = rows.map(mapUser);
    return res.json({ ok: true, total: data.length, data });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "No se pudo listar usuarios.", error: error.message });
  }
});

app.post("/api/admin/usuarios", requireAuth, requireAdmin, async (req, res) => {
  try {
    const nombre = sanitizeOptionalText(req.body?.nombre, 100);
    const email = sanitizeEmail(req.body?.email);
    const telefono = sanitizeOptionalText(req.body?.telefono, 20) ?? null;
    const telegramId = sanitizeOptionalText(req.body?.telegram_id, 50) ?? null;
    const rol = toDbRole(req.body?.rol || "usuario");
    const password = req.body?.password;

    if (!nombre) {
      return res.status(400).json({ ok: false, message: "El nombre es obligatorio." });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "Correo electronico invalido." });
    }
    validatePasswordOrThrow(password);

    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, message: "Ese correo ya esta registrado." });
    }

    const passwordHash = hashPassword(password);
    const result = await query(
      `INSERT INTO usuarios (nombre, email, telefono, telegram_id, rol, activo, fecha_registro, password_hash)
       VALUES (?, ?, ?, ?, ?, 1, CURDATE(), ?)`,
      [nombre, email, telefono, telegramId, rol, passwordHash]
    );

    const created = await requireUserExists(result.insertId);
    return res.status(201).json({
      ok: true,
      message: "Usuario creado correctamente.",
      user: mapUser(created)
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.put("/api/admin/usuarios/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ ok: false, message: "ID de usuario invalido." });
    }

    const existing = await requireUserExists(userId);
    const updates = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(req.body, "nombre")) {
      const nombre = sanitizeOptionalText(req.body.nombre, 100);
      if (!nombre) throw new Error("El nombre no puede quedar vacio.");
      updates.push("nombre = ?");
      params.push(nombre);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const email = sanitizeEmail(req.body.email);
      if (!email || !email.includes("@")) throw new Error("Correo electronico invalido.");
      const emailOwner = await getUserByEmail(email);
      if (emailOwner && Number(emailOwner.usuario_id) !== userId) {
        return res.status(409).json({ ok: false, message: "Ese correo ya pertenece a otro usuario." });
      }
      updates.push("email = ?");
      params.push(email);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "telefono")) {
      updates.push("telefono = ?");
      params.push(sanitizeOptionalText(req.body.telefono, 20));
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "telegram_id")) {
      updates.push("telegram_id = ?");
      params.push(sanitizeOptionalText(req.body.telegram_id, 50));
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "rol")) {
      updates.push("rol = ?");
      params.push(toDbRole(req.body.rol));
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "activo")) {
      updates.push("activo = ?");
      params.push(req.body.activo ? 1 : 0);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "password")) {
      validatePasswordOrThrow(req.body.password);
      updates.push("password_hash = ?");
      params.push(hashPassword(req.body.password));
    }

    if (!updates.length) {
      return res.status(400).json({ ok: false, message: "No hay campos validos para actualizar." });
    }

    params.push(userId);
    await query(`UPDATE usuarios SET ${updates.join(", ")} WHERE usuario_id = ?`, params);

    const updated = await requireUserExists(existing.usuario_id);
    return res.json({
      ok: true,
      message: "Usuario actualizado.",
      user: mapUser(updated)
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.delete("/api/admin/usuarios/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ ok: false, message: "ID de usuario invalido." });
    }
    if (req.user && Number(req.user.usuario_id) === userId) {
      return res.status(400).json({ ok: false, message: "No puedes eliminar tu propia cuenta desde el panel." });
    }

    const existing = await requireUserExists(userId);
    await query("DELETE FROM usuarios WHERE usuario_id = ?", [userId]);

    return res.json({
      ok: true,
      message: "Usuario eliminado.",
      user: mapUser(existing)
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.post("/api/reportes/usuarios/:id/archivo", requireAuth, requireAdmin, (req, res, next) => {
  upload.single("archivo")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next();
  });
}, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ ok: false, message: "ID de usuario invalido." });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "Debes adjuntar un archivo." });
    }

    await requireUserExists(userId);
    await query("UPDATE usuarios SET archivos = ? WHERE usuario_id = ?", [req.file.filename, userId]);
    const updated = await requireUserExists(userId);

    return res.status(201).json({
      ok: true,
      message: "Archivo cargado correctamente.",
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: `/uploads/${req.file.filename}`
      },
      user: mapUser(updated)
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.get("/api/reportes/usuarios/excel", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await listUsersForReports();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Usuarios");

    sheet.columns = [
      { header: "ID", key: "usuario_id", width: 10 },
      { header: "Nombre", key: "nombre", width: 28 },
      { header: "Email", key: "email", width: 32 },
      { header: "Telefono", key: "telefono", width: 18 },
      { header: "Telegram", key: "telegram_id", width: 20 },
      { header: "Rol", key: "rol", width: 14 },
      { header: "Activo", key: "activo", width: 12 },
      { header: "Fecha registro", key: "fecha_registro", width: 18 },
      { header: "Archivo", key: "archivos", width: 34 }
    ];

    users.forEach((user) => {
      sheet.addRow({
        ...user,
        activo: user.activo ? "SI" : "NO",
        fecha_registro: user.fecha_registro ? new Date(user.fecha_registro).toISOString().slice(0, 10) : "",
        archivos: user.archivos || ""
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="reporte_usuarios.xlsx"');
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return res.status(500).json({ ok: false, message: "No se pudo generar el reporte Excel.", error: error.message });
  }
});

app.get("/api/reportes/usuarios/pdf", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await listUsersForReports();
    const doc = new PDFDocument({ margin: 40, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="reporte_usuarios.pdf"');

    doc.pipe(res);
    doc.fontSize(18).text("Reporte de usuarios", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555").text(`Generado: ${new Date().toISOString()}`);
    doc.moveDown();
    doc.fillColor("#000");

    users.forEach((user, index) => {
      const line = [
        `#${user.usuario_id}`,
        user.nombre || "",
        user.email || "",
        `rol=${user.rol || ""}`,
        `activo=${user.activo ? "SI" : "NO"}`,
        `archivo=${user.archivos || "Sin archivo"}`
      ].join(" | ");

      doc.fontSize(10).text(line, { width: 520 });
      if (index < users.length - 1) doc.moveDown(0.4);
    });

    doc.end();
  } catch (error) {
    return res.status(500).json({ ok: false, message: "No se pudo generar el reporte PDF.", error: error.message });
  }
});

app.get("/api/admin/db/tables", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT TABLE_NAME AS table_name
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME ASC`
    );
    return res.json({ ok: true, total: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "No se pudieron listar las tablas.", error: error.message });
  }
});

app.get("/api/admin/db/table/:table", requireAuth, requireAdmin, async (req, res) => {
  try {
    const tableName = req.params.table;
    const columns = await getTableColumns(tableName);
    const primaryKey = columns.find((column) => column.COLUMN_KEY === "PRI")?.COLUMN_NAME || null;
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 10000);
    const all = String(req.query.all || "").toLowerCase() === "true";
    const sql = all
      ? `SELECT * FROM ${quoteIdentifier(tableName)}`
      : `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${limit}`;

    const rows = await query(sql);
    return res.json({
      ok: true,
      total: rows.length,
      primary_key: primaryKey,
      columns: columns.map((column) => column.COLUMN_NAME),
      data: rows
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.post("/api/admin/db/table/:table", requireAuth, requireAdmin, async (req, res) => {
  try {
    const tableName = req.params.table;
    const columns = await getTableColumns(tableName);
    const writableData = buildWritableData(req.body, columns, { forInsert: true });

    if (!writableData.length) {
      return res.status(400).json({ ok: false, message: "No hay columnas validas para insertar." });
    }

    const columnSql = writableData.map(([key]) => quoteIdentifier(key)).join(", ");
    const placeholderSql = writableData.map(() => "?").join(", ");
    const values = writableData.map(([, value]) => value);

    const result = await query(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES (${placeholderSql})`,
      values
    );

    return res.status(201).json({
      ok: true,
      message: "Fila creada correctamente.",
      insert_id: result.insertId || null
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.put("/api/admin/db/table/:table/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const tableName = req.params.table;
    const columns = await getTableColumns(tableName);
    const primaryKey = columns.find((column) => column.COLUMN_KEY === "PRI")?.COLUMN_NAME;
    if (!primaryKey) {
      return res.status(400).json({ ok: false, message: "La tabla no tiene llave primaria." });
    }

    const writableData = buildWritableData(req.body, columns, { primaryKey });
    if (!writableData.length) {
      return res.status(400).json({ ok: false, message: "No hay columnas validas para actualizar." });
    }

    const setSql = writableData.map(([key]) => `${quoteIdentifier(key)} = ?`).join(", ");
    const values = writableData.map(([, value]) => value);
    values.push(req.params.id);

    const result = await query(
      `UPDATE ${quoteIdentifier(tableName)}
       SET ${setSql}
       WHERE ${quoteIdentifier(primaryKey)} = ?`,
      values
    );

    return res.json({
      ok: true,
      message: "Fila actualizada.",
      affected_rows: result.affectedRows || 0
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.delete("/api/admin/db/table/:table/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const tableName = req.params.table;
    const columns = await getTableColumns(tableName);
    const primaryKey = columns.find((column) => column.COLUMN_KEY === "PRI")?.COLUMN_NAME;
    if (!primaryKey) {
      return res.status(400).json({ ok: false, message: "La tabla no tiene llave primaria." });
    }

    const result = await query(
      `DELETE FROM ${quoteIdentifier(tableName)}
       WHERE ${quoteIdentifier(primaryKey)} = ?`,
      [req.params.id]
    );

    return res.json({
      ok: true,
      message: "Fila eliminada.",
      affected_rows: result.affectedRows || 0
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1 AS ok");
    return res.json({ ok: true, db: "conectada" });
  } catch (error) {
    return res.status(500).json({ ok: false, db: "sin conexion", error: error.message });
  }
});

app.get("/api/sismo/live", (_req, res) => {
  return res.json({
    ok: true,
    data: sismoRealtime.currentSnapshot
  });
});

app.get("/api/sismo/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  res.write("retry: 2500\n");
  res.write(`data: ${JSON.stringify(sismoRealtime.currentSnapshot)}\n\n`);
  sismoRealtime.clients.add(res);

  const keepAlive = setInterval(() => {
    res.write("event: ping\ndata: {}\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sismoRealtime.clients.delete(res);
  });
});

app.post("/api/sismo/simular", (req, res) => {
  const { intensidad = 2.4, duracionMs = 9000 } = req.body || {};
  startSyntheticSismoSimulation({ intensity: intensidad, durationMs: duracionMs });
  return res.json({
    ok: true,
    message: "Simulacion sismica iniciada",
    data: {
      intensidad: Number(intensidad),
      duracionMs: Number(duracionMs)
    }
  });
});

app.get("/api/sismo/historial", async (req, res) => {
  const requestedLimit = Number(req.query.limit || 120);
  const safeLimit = Math.max(1, Math.min(500, requestedLimit));

  if (!sismoRealtime.persistReady) {
    return res.json({ ok: true, total: 0, data: [], message: "Persistencia no inicializada" });
  }

  try {
    const rows = await query(
      `SELECT evento_hw_id, timestamp_iso, fuente, puerto, estado,
              nivel_num, nivel_texto, magnitud_estimada, rms_actual,
              rms_reposo, frecuencia_muestreo, ax, ay, az, vector_magnitud, created_at
       FROM ${SISMO_DB_TABLE}
       ORDER BY evento_hw_id DESC
       LIMIT ${safeLimit}`
    );
    return res.json({ ok: true, total: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Error consultando historial", error: error.message });
  }
});

app.use(express.static(__dirname));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/reportes", express.static(path.join(__dirname, "public", "reportes")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((err, _req, res, _next) => {
  return res.status(500).json({ ok: false, message: "Error interno", error: err.message });
});

app.listen(PORT, async () => {
  try {
    await query("SELECT 1");
    await ensureSismoPersistenceSchema();
    console.log(`Servidor en http://localhost:${PORT} (DB conectada)`);
  } catch (error) {
    sismoRealtime.persistReady = false;
    console.log(`Servidor en http://localhost:${PORT} (DB sin conexion: ${error.message})`);
  }

  ensureSismoBridge();
});

process.on("SIGINT", async () => {
  sismoRealtime.shuttingDown = true;
  if (sismoRealtime.simulationInterval) {
    clearInterval(sismoRealtime.simulationInterval);
    sismoRealtime.simulationInterval = null;
  }
  if (sismoRealtime.bridgeProcess) {
    sismoRealtime.bridgeProcess.kill();
  }
  await pool.end();
  process.exit(0);
});

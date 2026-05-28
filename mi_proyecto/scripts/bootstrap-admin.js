const crypto = require("crypto");
const dotenv = require("dotenv");
const { query, pool } = require("../db");

dotenv.config();

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = String(argv[index] || "");
    if (!part.startsWith("--")) continue;

    const key = part.slice(2);
    const next = argv[index + 1];
    if (!next || String(next).startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = String(next);
    index += 1;
  }

  return options;
}

function sanitizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePasswordOrThrow(password) {
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("La contrasena debe tener al menos 6 caracteres.");
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function buildRandomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  const bytes = crypto.randomBytes(length * 2);
  let password = "";

  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
    if (password.length >= length) break;
  }

  return password;
}

async function getUserByEmail(email) {
  const rows = await query(
    `SELECT usuario_id, nombre, email, rol, activo
     FROM usuarios
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [sanitizeEmail(email)]
  );

  return rows[0] || null;
}

async function upsertAdmin({ nombre, email, password }) {
  const existing = await getUserByEmail(email);
  const passwordHash = hashPassword(password);

  if (existing) {
    await query(
      `UPDATE usuarios
       SET nombre = ?, rol = 'administrador', activo = 1, password_hash = ?
       WHERE usuario_id = ?`,
      [nombre, passwordHash, existing.usuario_id]
    );

    return {
      action: "updated",
      usuario_id: existing.usuario_id,
      email,
      nombre
    };
  }

  const result = await query(
    `INSERT INTO usuarios (nombre, email, telefono, telegram_id, rol, activo, fecha_registro, password_hash)
     VALUES (?, ?, NULL, NULL, 'administrador', 1, CURDATE(), ?)`,
    [nombre, email, passwordHash]
  );

  return {
    action: "created",
    usuario_id: result.insertId,
    email,
    nombre
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = sanitizeEmail(args.email || "admin@localhost");
  const nombre = String(args.name || args.nombre || "Administrador principal").trim();
  const password = String(args.password || buildRandomPassword());

  if (!email || !email.includes("@")) {
    throw new Error("Debes proporcionar un correo valido con --email.");
  }
  if (!nombre) {
    throw new Error("Debes proporcionar un nombre valido con --name.");
  }
  validatePasswordOrThrow(password);

  const result = await upsertAdmin({ nombre, email, password });

  console.log(JSON.stringify({
    ok: true,
    action: result.action,
    usuario_id: result.usuario_id,
    email: result.email,
    nombre: result.nombre,
    password
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

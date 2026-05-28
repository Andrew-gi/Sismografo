const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || "archivo")
      .normalize("NFKD")
      .replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png"
]);

const allowedExtensions = new Set([".pdf", ".xlsx", ".docx", ".jpg", ".jpeg", ".png"]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    const mimeOk = allowedMimeTypes.has(String(file.mimetype || "").toLowerCase());
    const extOk = allowedExtensions.has(ext);
    if (!mimeOk || !extOk) {
      return cb(new Error("Tipo de archivo no permitido. Solo PDF, XLSX, DOCX, JPG, JPEG, PNG."));
    }
    return cb(null, true);
  }
});

module.exports = {
  upload,
  uploadsDir
};

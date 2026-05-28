const $ = (id) => document.getElementById(id);
const out = $("resultado");
const TOKEN_KEY = "sismo_auth_token";
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";

function log(msg) {
  out.textContent = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
}

function resolveApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url}`;
}

function authHeader() {
  const token = $("token").value.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url, options = {}) {
  try {
    const resp = await fetch(resolveApiUrl(url), options);
    return resp;
  } catch (_err) {
    throw new Error("No hay conexion con el servidor. Ejecuta npm start y abre http://localhost:3000/reportes/");
  }
}

function persistToken(token) {
  const safeToken = String(token || "").trim();
  $("token").value = safeToken;
  if (safeToken) {
    localStorage.setItem(TOKEN_KEY, safeToken);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

$("token").value = localStorage.getItem(TOKEN_KEY) || "";

$("btnLoginToken").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!email || !password) {
    log("Ingresa correo y contrasena para obtener token.");
    return;
  }

  try {
    const resp = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok || !json.token) {
      log(json);
      return;
    }

    persistToken(json.token);
    log(`Token cargado correctamente. Usuario: ${json.user?.email || email}`);
  } catch (err) {
    log(`Error: ${err.message}`);
  }
});

$("btnSubir").addEventListener("click", async () => {
  const usuarioId = $("usuarioId").value.trim();
  const file = $("archivo").files[0];

  if (!usuarioId || !file) {
    log("Debes ingresar ID de usuario y seleccionar un archivo.");
    return;
  }

  try {
    const fd = new FormData();
    fd.append("archivo", file);
    const resp = await request(`/api/reportes/usuarios/${usuarioId}/archivo`, {
      method: "POST",
      headers: authHeader(),
      body: fd
    });
    const json = await resp.json();
    log(json);
  } catch (err) {
    log(`Error: ${err.message}`);
  }
});

async function downloadWithAuth(url, filename) {
  const token = $("token").value.trim();
  if (!token) {
    log("Pega el token JWT para descargar reportes.");
    return;
  }
  try {
    const resp = await request(url, { headers: authHeader() });
    if (!resp.ok) {
      const msg = await resp.text();
      log(`Error ${resp.status}: ${msg}`);
      return;
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    log(`Descarga iniciada: ${filename}`);
  } catch (err) {
    log(`Error: ${err.message}`);
  }
}

$("btnExcel").addEventListener("click", () => {
  downloadWithAuth("/api/reportes/usuarios/excel", "reporte_usuarios.xlsx");
});

$("btnPdf").addEventListener("click", () => {
  downloadWithAuth("/api/reportes/usuarios/pdf", "reporte_usuarios.pdf");
});

$("btnUsuarios").addEventListener("click", async () => {
  const tbody = document.querySelector("#tablaUsuarios tbody");
  tbody.innerHTML = "";

  try {
    const resp = await request("/api/admin/usuarios", { headers: authHeader() });
    const json = await resp.json();
    if (!resp.ok || !json.ok) {
      log(json);
      return;
    }

    (json.data || []).forEach((u) => {
      const tr = document.createElement("tr");
      const archivo = u.archivos ? `<a href="/uploads/${u.archivos}" target="_blank" rel="noopener">${u.archivos}</a>` : "Sin archivo";
      tr.innerHTML = `
        <td>${u.usuario_id ?? ""}</td>
        <td>${u.nombre ?? ""}</td>
        <td>${u.email ?? ""}</td>
        <td>${u.rol ?? ""}</td>
        <td>${u.activo ? "SI" : "NO"}</td>
        <td>${archivo}</td>
      `;
      tbody.appendChild(tr);
    });

    log(`Usuarios cargados: ${json.total}`);
  } catch (err) {
    log(`Error: ${err.message}`);
  }
});

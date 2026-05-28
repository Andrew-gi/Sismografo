# API lista para pruebas (login, registro, CRUD y panel admin de usuarios)

## 1) Configurar variables de entorno
1. Copia `.env.example` a `.env`.
2. Ajusta usuario y clave de MySQL.

## 2) Levantar servidor
```bash
npm start
```

Luego abre:
- `http://localhost:3000/` (tu pagina principal)
- `http://localhost:3000/admin-panel.html` (inicio de sesion + panel admin)

## 3) Ejecutar pruebas automaticas
En otra terminal PowerShell:
```powershell
.\probar_api.ps1
```

## Endpoints principales
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/usuarios` (solo admin)
- `POST /api/admin/usuarios` (solo admin)
- `DELETE /api/admin/usuarios/:id` (solo admin)
- `GET /api/nodos`
- `POST /api/nodos`
- `PUT /api/nodos/:id`
- `DELETE /api/nodos/:id`
- `GET /api/eventos/confirmados`
- `GET /api/alertas/historial`

## Nota
Si falla la conexion, valida que exista la base `sismografo_db` con el script:
`C:\Users\Administrator\Downloads\sismografo_database.sql`

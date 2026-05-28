$baseUrl = "http://localhost:3000"
$tag = Get-Date -Format "yyyyMMddHHmmss"
$email = "demo_$tag@sismored.co"
$password = "ClaveSegura123*"

Write-Host "1) Health check..."
Invoke-RestMethod -Method Get -Uri "$baseUrl/api/health" | ConvertTo-Json -Depth 6

Write-Host "`n2) Registro..."
$registerBody = @{
  nombre = "Usuario Demo $tag"
  email = $email
  password = $password
  telefono = "+573000000000"
  telegram_id = "@demo_$tag"
  rol = "usuario"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/register" -ContentType "application/json" -Body $registerBody | ConvertTo-Json -Depth 6

Write-Host "`n3) Login..."
$loginBody = @{
  email = $email
  password = $password
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $loginResponse.token
$headers = @{ Authorization = "Bearer $token" }

$loginResponse | ConvertTo-Json -Depth 6

Write-Host "`n4) Crear nodo..."
$nodoNombre = "Nodo_Test_$tag"
$createNodoBody = @{
  nombre = $nodoNombre
  latitud = 3.451111
  longitud = -76.531111
  estado = "activo"
  firmware_version = "v1.1.0"
} | ConvertTo-Json

$createNodo = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/nodos" -Headers $headers -ContentType "application/json" -Body $createNodoBody
$nodoId = $createNodo.nodo_id
$createNodo | ConvertTo-Json -Depth 6

Write-Host "`n5) Listar nodos..."
Invoke-RestMethod -Method Get -Uri "$baseUrl/api/nodos" -Headers $headers | ConvertTo-Json -Depth 6

Write-Host "`n6) Actualizar nodo..."
$updateNodoBody = @{
  estado = "inactivo"
  firmware_version = "v1.1.1"
} | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$baseUrl/api/nodos/$nodoId" -Headers $headers -ContentType "application/json" -Body $updateNodoBody | ConvertTo-Json -Depth 6

Write-Host "`n7) Consultar eventos confirmados..."
Invoke-RestMethod -Method Get -Uri "$baseUrl/api/eventos/confirmados" -Headers $headers | ConvertTo-Json -Depth 6

Write-Host "`n8) Consultar historial de alertas..."
Invoke-RestMethod -Method Get -Uri "$baseUrl/api/alertas/historial" -Headers $headers | ConvertTo-Json -Depth 6

Write-Host "`n9) Eliminar nodo..."
Invoke-RestMethod -Method Delete -Uri "$baseUrl/api/nodos/$nodoId" -Headers $headers | ConvertTo-Json -Depth 6

Write-Host "`nPruebas completadas."

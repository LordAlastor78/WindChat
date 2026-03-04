# WindChat - Setup y Dev Script
# Uso: .\dev.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "<<< WindChat - Dev Launch >>>" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Verificar si es primera vez
if (-Not (Test-Path ".\node_modules")) {
    Write-Host "[*] Primera instalación detectada. Instalando dependencias..." -ForegroundColor Yellow
    npm install
    npm install -w server
    npm install -w client
    Write-Host "[OK] Dependencias instaladas" -ForegroundColor Green
    Write-Host ""
}

Write-Host "[*] Iniciando WindChat..." -ForegroundColor Green
Write-Host ""
Write-Host "[+] Que se abrira:" -ForegroundColor Cyan
Write-Host "  * Servidor WebSocket: http://localhost:8080" -ForegroundColor White
Write-Host "  * Cliente: https://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "[+] En el navegador:" -ForegroundColor Cyan
Write-Host "  1. Abre https://localhost:3000" -ForegroundColor White
Write-Host "  2. Click en 'Crear / Conectar'" -ForegroundColor White
Write-Host "  3. Se genera un roomID" -ForegroundColor White
Write-Host "  4. Abre otra ventana privada" -ForegroundColor White
Write-Host "  5. Pega el mismo roomID y conecta" -ForegroundColor White
Write-Host "  6. Ambos conectados! Prueba enviar mensajes" -ForegroundColor White
Write-Host ""
Write-Host "[!] Para detener: Ctrl+C en ambas terminales" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Lanzar servidor en background
Write-Host "[*] Iniciando servidor..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:server"

# Esperar a que el servidor inicie
Start-Sleep -Seconds 3

# Lanzar cliente
Write-Host "[*] Iniciando cliente..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:client"

Write-Host "[OK] WindChat en desarrollo. Abre las ventanas que se abrieron..." -ForegroundColor Green
Write-Host ""

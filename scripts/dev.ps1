# WindChat - Setup and Dev Script
# Usage: .\dev.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "<<< WindChat - Dev Launch >>>" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Verificar si es primera vez
if (-Not (Test-Path ".\node_modules")) {
    Write-Host "[*] First-time setup detected. Installing dependencies..." -ForegroundColor Yellow
    npm install
    npm install -w server
    npm install -w client
    Write-Host "[OK] Dependencies installed" -ForegroundColor Green
    Write-Host ""
}

Write-Host "[*] Starting WindChat..." -ForegroundColor Green
Write-Host ""
Write-Host "[+] What will open:" -ForegroundColor Cyan
Write-Host "  * WebSocket server: http://localhost:8080" -ForegroundColor White
Write-Host "  * Client: https://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "[+] In the browser:" -ForegroundColor Cyan
Write-Host "  1. Open https://localhost:3000" -ForegroundColor White
Write-Host "  2. Click 'Create / Connect'" -ForegroundColor White
Write-Host "  3. A room ID will be generated" -ForegroundColor White
Write-Host "  4. Open another private window" -ForegroundColor White
Write-Host "  5. Paste the same room ID and connect" -ForegroundColor White
Write-Host "  6. Both users connected. Send test messages" -ForegroundColor White
Write-Host ""
Write-Host "[!] To stop: Ctrl+C in both terminals" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Start server in background
Write-Host "[*] Starting server..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:server"

# Wait for server startup
Start-Sleep -Seconds 3

# Start client
Write-Host "[*] Starting client..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:client"

Write-Host "[OK] WindChat dev mode started. Open the terminals that were launched..." -ForegroundColor Green
Write-Host ""

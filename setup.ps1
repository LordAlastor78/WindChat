# WindChat - Setup Script
# Uso: .\setup.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "<<< WindChat - Setup >>>" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[*] Verificando Node.js..." -ForegroundColor Yellow
$node = node --version
$npm = npm --version
Write-Host "[OK] Node: $node, npm: $npm" -ForegroundColor Green
Write-Host ""

Write-Host "[*] Instalando dependencias root..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Error en instalación root" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Instalando dependencias servidor..." -ForegroundColor Yellow
npm install --workspace=server
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Error en instalación server" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Instalando dependencias cliente..." -ForegroundColor Yellow
npm install --workspace=client
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Error en instalación client" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Setup completado!" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos pasos:" -ForegroundColor Cyan
Write-Host "  1. Ejecuta: .\dev.ps1" -ForegroundColor White
Write-Host "  2. Abre: https://localhost:3000" -ForegroundColor White
Write-Host ""

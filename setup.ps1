# WindChat - Setup Script
# Usage: .\setup.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "<<< WindChat - Setup >>>" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[*] Checking Node.js..." -ForegroundColor Yellow
$node = node --version
$npm = npm --version
Write-Host "[OK] Node: $node, npm: $npm" -ForegroundColor Green
Write-Host ""

Write-Host "[*] Installing root dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Root install failed" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Installing server dependencies..." -ForegroundColor Yellow
npm install --workspace=server
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Server install failed" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Installing client dependencies..." -ForegroundColor Yellow
npm install --workspace=client
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Client install failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Run: .\dev.ps1" -ForegroundColor White
Write-Host "  2. Open: https://localhost:3000" -ForegroundColor White
Write-Host ""

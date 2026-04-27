# WindChat - Build Script
# Generate production artifacts
# Usage: .\build.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "<<< WindChat - Build Production >>>" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[*] Building server..." -ForegroundColor Yellow
npm run build:server
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Server build failed" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Building client..." -ForegroundColor Yellow
npm run build:client
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Client build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Build completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Generated files:" -ForegroundColor Cyan
Write-Host "  * server/dist/index.js -> Deploy on server" -ForegroundColor White
Write-Host "  * client/dist/ -> Deploy on CDN/webserver" -ForegroundColor White

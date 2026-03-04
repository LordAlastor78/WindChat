# WindChat - Build Script
# Genera archivos para producción
# Uso: .\build.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "🌬️  WindChat - Build Production" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "🔨 Building servidor..." -ForegroundColor Yellow
npm run build:server
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en build servidor" -ForegroundColor Red
    exit 1
}

Write-Host "🔨 Building cliente..." -ForegroundColor Yellow
npm run build:client
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en build cliente" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ ¡Build completado!" -ForegroundColor Green
Write-Host ""
Write-Host "Archivos generados:" -ForegroundColor Cyan
Write-Host "  • server/dist/index.js → Deploy en servidor" -ForegroundColor White
Write-Host "  • client/dist/ → Deploy en CDN/webserver" -ForegroundColor White
Write-Host ""
Write-Host "Para deployar con Cloudflare Tunnel:" -ForegroundColor Cyan
Write-Host "  1. cd server && node dist/index.js" -ForegroundColor White
Write-Host "  2. cloudflared tunnel --url http://localhost:8080" -ForegroundColor White
Write-Host ""

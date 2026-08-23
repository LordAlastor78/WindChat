# ==============================================================================
# WindChat Desktop - Setup Script para Windows (PowerShell)
# Prepara dependencias, compila relay-rust y descarga sidecars para Tauri 2.
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " WindChat Desktop - Setup Windows (PowerShell)" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Comprobar herramientas requeridas
function Test-Command ($cmd) {
    return [bool](Get-Command -Name $cmd -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "node")) {
    Write-Host "[ERROR] node no encontrado. Instala Node.js v20 o superior." -ForegroundColor Red
    exit 1
}

if (-not (Test-Command "npm")) {
    Write-Host "[ERROR] npm no encontrado." -ForegroundColor Red
    exit 1
}

if (-not (Test-Command "cargo")) {
    Write-Host "[ERROR] cargo / Rust no encontrado. Instala Rust desde https://rustup.rs" -ForegroundColor Red
    exit 1
}

# 2. Deteccion de arquitectura y target triple de Rust
$target = "x86_64-pc-windows-msvc"
if (Test-Command "rustc") {
    $rustcV = rustc -vV
    foreach ($line in $rustcV) {
        if ($line -match "^host:\s+(.+)$") {
            $target = $Matches[1].Trim()
            break
        }
    }
}

Write-Host "[*] Target triple de Rust detectado: $target" -ForegroundColor Yellow

# Si el target es GNU, verificar que dlltool.exe este disponible
if ($target -like "*-gnu" -and -not (Test-Command "dlltool.exe")) {
    Write-Host "[ADVERTENCIA] Detectado toolchain GNU ($target) pero no se encontro 'dlltool.exe'." -ForegroundColor Magenta
    Write-Host "  Para compilar en Windows se recomienda usar el toolchain oficial de Microsoft (MSVC):" -ForegroundColor Yellow
    Write-Host "    rustup default stable-x86_64-pc-windows-msvc" -ForegroundColor White
    Write-Host "  O si prefieres GNU, instala MinGW-w64 y asegurate de que su carpeta 'bin' este en el PATH." -ForegroundColor Yellow
    Write-Host ""
}

$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$binDir = Join-Path $rootDir "desktop\src-tauri\binaries"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
}

# 3. Compilar relay-rust
Write-Host "[*] Compilando relay-rust en modo release..." -ForegroundColor Yellow
Push-Location (Join-Path $rootDir "relay-rust")
try {
    cargo build --release
} finally {
    Pop-Location
}

$relaySrc = Join-Path $rootDir "relay-rust\target\release\relay-rust.exe"
$relayDst = Join-Path $binDir "relay-rust-$target.exe"

if (Test-Path $relaySrc) {
    Copy-Item -Path $relaySrc -Destination $relayDst -Force
    Write-Host "[OK] relay-rust copiado a: desktop\src-tauri\binaries\relay-rust-$target.exe" -ForegroundColor Green
} else {
    Write-Host "[ERROR] No se encontro el binario compilado de relay-rust" -ForegroundColor Red
    exit 1
}

# 4. Descargar cloudflared oficial para Windows
$cfDst = Join-Path $binDir "cloudflared-$target.exe"
$cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

if ($target -like "aarch64*") {
    $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe"
}

Write-Host "[*] Descargando sidecar cloudflared oficial desde GitHub..." -ForegroundColor Yellow
if (Test-Command "curl.exe") {
    curl.exe -fsSL $cfUrl -o $cfDst
} else {
    Invoke-WebRequest -Uri $cfUrl -OutFile $cfDst -UseBasicParsing
}

Write-Host "[OK] cloudflared instalado en: desktop\src-tauri\binaries\cloudflared-$target.exe" -ForegroundColor Green

# 5. Instalar dependencias de Node.js y compilar frontend
Write-Host "[*] Instalando dependencias de Node.js..." -ForegroundColor Yellow
Push-Location $rootDir
try {
    npm install
    npm run build -w client
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " [OK] Setup de WindChat Desktop completado" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Comandos disponibles para ejecutar la aplicacion:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Modo desarrollo:" -ForegroundColor White
Write-Host "     cd desktop; npm run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "  2. Compilar binario final portable (.exe):" -ForegroundColor White
Write-Host "     cd desktop; npm run build:portable" -ForegroundColor Yellow
Write-Host "     (El binario quedara en desktop\src-tauri\target\release\fugazchat-desktop.exe)" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# WindChat Desktop - Setup Script para sistemas UNIX (Linux / macOS)
# Prepara dependencias, compila relay-rust y descarga sidecars para Tauri 2.
# ==============================================================================

echo "=================================================="
echo " WindChat Desktop - Setup UNIX (Linux / macOS)"
echo "=================================================="

# 1. Comprobar herramientas requeridas
command -v node >/dev/null 2>&1 || { echo "[ERROR] node no encontrado. Instala Node.js v20 o superior."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[ERROR] npm no encontrado."; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "[ERROR] cargo / Rust no encontrado. Instala Rust desde https://rustup.rs"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "[ERROR] curl no encontrado."; exit 1; }

# 2. Deteccion de arquitectura y plataforma
OS="$(uname -s)"
ARCH="$(uname -m)"

if command -v rustc >/dev/null 2>&1; then
    TARGET="$(rustc -vV | grep host | awk '{print $2}')"
else
    case "${OS}_${ARCH}" in
        Linux_x86_64)   TARGET="x86_64-unknown-linux-gnu" ;;
        Linux_aarch64)  TARGET="aarch64-unknown-linux-gnu" ;;
        Linux_arm64)    TARGET="aarch64-unknown-linux-gnu" ;;
        Darwin_x86_64)  TARGET="x86_64-apple-darwin" ;;
        Darwin_arm64)   TARGET="aarch64-apple-darwin" ;;
        *)              TARGET="${ARCH}-unknown-${OS}" ;;
    esac
fi

echo "[*] Sistema detectado: ${OS} (${ARCH})"
echo "[*] Target triple de Rust: ${TARGET}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROOT_DIR}/desktop/src-tauri/binaries"
mkdir -p "${BIN_DIR}"

# 3. Compilar relay-rust
echo "[*] Compilando relay-rust en modo release..."
(
    cd "${ROOT_DIR}/relay-rust"
    cargo build --release
)

RELAY_SRC="${ROOT_DIR}/relay-rust/target/release/relay-rust"
RELAY_DST="${BIN_DIR}/relay-rust-${TARGET}"

if [ -f "${RELAY_SRC}" ]; then
    cp "${RELAY_SRC}" "${RELAY_DST}"
    chmod +x "${RELAY_DST}"
    echo "[OK] relay-rust copiado a: desktop/src-tauri/binaries/relay-rust-${TARGET}"
else
    echo "[ERROR] No se encontro el binario compilado de relay-rust"
    exit 1
fi

# 4. Descargar cloudflared oficial
CF_DST="${BIN_DIR}/cloudflared-${TARGET}"
echo "[*] Descargando sidecar cloudflared para ${OS} ${ARCH}..."

case "${OS}" in
    Linux)
        case "${ARCH}" in
            x86_64|amd64)   CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
            aarch64|arm64)  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
            armv7l|armhf)   CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm" ;;
            *)              echo "[ERROR] Arquitectura Linux no soportada automaticamente: ${ARCH}"; exit 1 ;;
        esac
        curl -fsSL "${CF_URL}" -o "${CF_DST}"
        chmod +x "${CF_DST}"
        ;;
    Darwin)
        TMP_DIR="$(mktemp -d)"
        case "${ARCH}" in
            x86_64)         CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz" ;;
            arm64|aarch64)  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz" ;;
            *)              echo "[ERROR] Arquitectura macOS no soportada automaticamente: ${ARCH}"; exit 1 ;;
        esac
        curl -fsSL "${CF_URL}" -o "${TMP_DIR}/cf.tgz"
        tar -xzf "${TMP_DIR}/cf.tgz" -C "${TMP_DIR}"
        mv "${TMP_DIR}/cloudflared" "${CF_DST}"
        chmod +x "${CF_DST}"
        rm -rf "${TMP_DIR}"
        ;;
    *)
        echo "[ERROR] Sistema operativo no soportado por este script: ${OS}"
        exit 1
        ;;
esac

echo "[OK] cloudflared instalado en: desktop/src-tauri/binaries/cloudflared-${TARGET}"

# 5. Instalar dependencias y compilar frontend
echo "[*] Instalando dependencias de Node.js..."
(
    cd "${ROOT_DIR}"
    npm install
    npm run build -w client
)

echo ""
echo "=================================================="
echo " [OK] Setup de WindChat Desktop completado"
echo "=================================================="
echo "Comandos disponibles para ejecutar la aplicacion:"
echo ""
echo "  1. Modo desarrollo:"
echo "     cd desktop && npm run dev"
echo ""
echo "  2. Compilar binario final portable:"
echo "     cd desktop && npm run build:portable"
echo "     (El binario quedara en desktop/src-tauri/target/release/fugazchat-desktop)"
echo "=================================================="

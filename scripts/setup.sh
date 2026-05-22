#!/usr/bin/env bash
set -euo pipefail

echo "================================"
echo "<<< WindChat - Setup >>>"
echo "================================"

echo "[*] Checking Node.js and npm"
node --version || { echo "Node not found"; exit 1; }
npm --version || { echo "npm not found"; exit 1; }

echo "[*] Installing root dependencies..."
npm install

echo "[*] Installing server dependencies..."
npm install --workspace=server

echo "[*] Installing client dependencies..."
npm install --workspace=client

echo "[OK] Setup completed!"
echo "Next steps:"
echo "  1. Run: ./scripts/dev.sh"
echo "  2. Open: https://localhost:3000"

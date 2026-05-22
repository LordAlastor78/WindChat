#!/usr/bin/env bash
set -euo pipefail

echo "================================"
echo "<<< WindChat - Dev Launch >>>"
echo "================================"

if [ ! -d node_modules ]; then
  echo "[*] First-time setup detected. Installing dependencies..."
  npm install
  npm install -w server
  npm install -w client
  echo "[OK] Dependencies installed"
fi

echo "[*] Starting WindChat..."
echo "  * WebSocket server: http://localhost:8080"
echo "  * Client: https://localhost:3000"

echo "[*] Starting server in background"
npm run dev -w server &
SERVER_PID=$!
sleep 2

echo "[*] Starting client"
npm run dev -w client &
CLIENT_PID=$!

echo "[OK] WindChat dev mode started. To stop: kill $SERVER_PID $CLIENT_PID or use Ctrl+C."

wait

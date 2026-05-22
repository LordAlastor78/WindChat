#!/usr/bin/env bash
set -euo pipefail

echo "WindChat - Basic run helper (Linux)"
echo "1) Start local dev (server + client)"
echo "2) Kill node processes"
echo "0) Exit"

read -p "Choose: " opt
case "$opt" in
  1)
    echo "Starting server and client (background)..."
    npm run dev -w server &
    npm run dev -w client &
    echo "Started; use 'ps aux | grep node' to inspect processes."
    ;;
  2)
    pkill node || true
    echo "Killed node processes (if any)."
    ;;
  0)
    echo "Exit." ;;
  *)
    echo "No-op." ;;
esac

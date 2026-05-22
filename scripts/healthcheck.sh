#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "WindChat Local Health Check"
echo "========================================="

echo "==> Build server"
npm -w server run build

echo "==> Start server"
node server/dist/index.js &
SERVER_PID=$!

echo "==> Wait for port 8080"
max_attempts=20
attempt=0
ready=false
while [ $attempt -lt $max_attempts ]; do
  attempt=$((attempt+1))
  sleep 0.5
  if (echo > /dev/tcp/127.0.0.1/8080) >/dev/null 2>&1; then
    ready=true
    break
  fi
done
if [ "$ready" != "true" ]; then
  echo "[FAIL] Server did not open port 8080 in time."
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi
echo "[OK] TCP 127.0.0.1:8080 reachable"

echo "==> HTTP check"
status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080 || true)
if [ "$status" != "200" ]; then
  echo "[FAIL] HTTP status $status"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi
echo "[OK] HTTP status 200"

echo "==> WebSocket join handshake check (2 clients)"
(cd server && node -e "const WebSocket=require('ws'); const room='room-test-'+Date.now(); const url='ws://127.0.0.1:8080'; const c1=new WebSocket(url); const c2=new WebSocket(url); let peerJoinedCount=0; let done=false; const finish=(ok,msg)=>{ if(done) return; done=true; console.log(ok?('WS_CHECK_OK: '+msg):('WS_CHECK_FAIL: '+msg)); try{c1.close();}catch{} try{c2.close();}catch{} setTimeout(()=>process.exit(ok?0:1),100); }; const pk='B'.repeat(88); c1.on('open',()=>c1.send(JSON.stringify({type:'join',roomId:room,publicKey:pk,displayName:'alice'}))); c2.on('open',()=>c2.send(JSON.stringify({type:'join',roomId:room,publicKey:pk,displayName:'bob'}))); [c1,c2].forEach(c=>c.on('message',(raw)=>{ try{ const m=JSON.parse(raw.toString()); if(m.type==='peer_joined'){ peerJoinedCount++; if(peerJoinedCount>=2) finish(true,'both clients received peer_joined'); } }catch(e){ finish(false,'invalid json from server'); } })); [c1,c2].forEach(c=>c.on('error',(e)=>finish(false,'socket error: '+e.message))); setTimeout(()=>finish(false,'timeout waiting peer_joined'),5000);")

rc=$?
if [ $rc -ne 0 ]; then
  echo "[FAIL] WebSocket check"
  kill $SERVER_PID 2>/dev/null || true
  exit $rc
fi

echo "==> Build client"
npm -w client run build

echo "==> Run client tests"
npm -w client run test:run

echo "[OK] Health check completed successfully"

if kill $SERVER_PID 2>/dev/null; then
  echo "[INFO] Server process stopped (PID $SERVER_PID)"
fi

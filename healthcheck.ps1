# WindChat - Local Health Check
# Verifies: server build, TCP/HTTP/WebSocket connectivity, client build and tests.
# Usage: .\healthcheck.ps1

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "\n==> $Message" -ForegroundColor Cyan
}

function Assert-LastExitCode {
    param([string]$StepName)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] $StepName (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

$serverProcess = $null

try {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "WindChat Local Health Check" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan

    Write-Step "Build server"
    npm -w server run build
    Assert-LastExitCode "Server build"

    Write-Step "Start server process"
    $serverProcess = Start-Process -FilePath "node" -ArgumentList "server/dist/index.js" -PassThru

    Write-Step "Wait for port 8080"
    $maxAttempts = 20
    $attempt = 0
    $ready = $false
    while ($attempt -lt $maxAttempts) {
        $attempt++
        Start-Sleep -Milliseconds 500
        $tcp = Test-NetConnection -ComputerName "127.0.0.1" -Port 8080 -WarningAction SilentlyContinue
        if ($tcp.TcpTestSucceeded) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        Write-Host "[FAIL] Server did not open port 8080 in time." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] TCP 127.0.0.1:8080 reachable" -ForegroundColor Green

    Write-Step "HTTP check"
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080" -TimeoutSec 10
    if ($response.StatusCode -ne 200) {
        Write-Host "[FAIL] HTTP status $($response.StatusCode)" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] HTTP status 200" -ForegroundColor Green

    Write-Step "WebSocket join handshake check (2 clients)"
    Push-Location server
    node -e "const WebSocket=require('ws'); const room='room-test-'+Date.now(); const url='ws://127.0.0.1:8080'; const c1=new WebSocket(url); const c2=new WebSocket(url); let peerJoinedCount=0; let done=false; const finish=(ok,msg)=>{ if(done) return; done=true; console.log(ok?('WS_CHECK_OK: '+msg):('WS_CHECK_FAIL: '+msg)); try{c1.close();}catch{} try{c2.close();}catch{} setTimeout(()=>process.exit(ok?0:1),100); }; const pk='B'.repeat(88); c1.on('open',()=>c1.send(JSON.stringify({type:'join',roomId:room,publicKey:pk,displayName:'alice'}))); c2.on('open',()=>c2.send(JSON.stringify({type:'join',roomId:room,publicKey:pk,displayName:'bob'}))); [c1,c2].forEach(c=>c.on('message',(raw)=>{ try{ const m=JSON.parse(raw.toString()); if(m.type==='peer_joined'){ peerJoinedCount++; if(peerJoinedCount>=2) finish(true,'both clients received peer_joined'); } }catch(e){ finish(false,'invalid json from server'); } })); [c1,c2].forEach(c=>c.on('error',(e)=>finish(false,'socket error: '+e.message))); setTimeout(()=>finish(false,'timeout waiting peer_joined'),5000);"
    Assert-LastExitCode "WebSocket check"
    Pop-Location

    Write-Step "Build client"
    npm -w client run build
    Assert-LastExitCode "Client build"

    Write-Step "Run client tests"
    npm -w client run test:run
    Assert-LastExitCode "Client tests"

    Write-Host "\n========================================" -ForegroundColor Cyan
    Write-Host "[OK] Health check completed successfully" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
}
catch {
    Write-Host "\n[FAIL] Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        try {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
            Write-Host "[INFO] Server process stopped (PID $($serverProcess.Id))" -ForegroundColor Yellow
        }
        catch {
            Write-Host "[WARN] Could not stop server process automatically." -ForegroundColor Yellow
        }
    }
}

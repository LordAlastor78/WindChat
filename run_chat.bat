@echo off
REM ============================================================
REM WindChat - Servidor de prueba local (1 clic)
REM Arranca el relay Rust (en :8080) y un server web que sirve
REM client/dist y proxya el WebSocket al relay (en :4183).
REM Luego abre el chat en el navegador.
REM
REM Requisitos: relay-rust/target/release/relay-rust.exe  (ya buildado)
REM               client/dist/                              (ya buildado)
REM ============================================================
SETLOCAL
cd /d "%~dp0"

echo [*] Matando instancias previas en 8080 / 4183 (si las hay)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4183 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 >nul

echo [*] Arrancando relay Rust en :8080 ...
start "WindChat-Relay" cmd /k "cd relay-rust && target\release\relay-rust.exe"
timeout /t 2 >nul

echo [*] Arrancando server web en :4183 (proxy WS -> :8080) ...
start "WindChat-Web" cmd /k "node tools\e2e_server.cjs"
timeout /t 2 >nul

echo [*] Abriendo chat en el navegador...
start "" "http://localhost:4183/chat.html"

echo.
echo ============================================================
echo  WindChat listo.
echo  - Chat:      http://localhost:4183/chat.html
echo  - Relay:     ws://localhost:8080  (proxyado por el server)
echo.
echo  PARA PROBAR E2EE: abre OTRA pestana/navegador en la misma
echo  URL, une DOS usuarios a la MISMA sala, y compara el SAS
echo  (safety number) en ambos: si coincide, no hay MITM.
echo.
echo  Cerrar: mata las ventanas "WindChat-Relay" y "WindChat-Web".
echo ============================================================
echo.
echo (Esta ventana puede cerrarse; los servidores siguen vivos en sus propias ventanas)
pause
ENDLOCAL

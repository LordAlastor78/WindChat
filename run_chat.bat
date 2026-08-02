@echo off
REM ============================================================
REM WindChat - Servidor de prueba local (2o plano, sin ventanas)
REM - Mata relay/server de WindChat previos (queda SOLO UNO).
REM - Arranca el server web (:4183) OCULTO; el server lanza el
REM   relay Rust (:8080) como hijo. Para cerrar todo, usa el
REM   boton "Salir" del chat, o ejecuta stop_chat.bat.
REM
REM Requisitos: relay-rust/target/release/relay-rust.exe (buildado)
REM               client/dist/                         (buildado)
REM ============================================================
SETLOCAL ENABLEEXTENSIONS
cd /d "%~dp0"

echo [*] Cerrando instancias previas de WindChat (8080 / 4183)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4183 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 >nul

echo [*] Arrancando server web (:4183, en 2o plano)...
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Set-Location '%~dp0'; node '.\tools\e2e_server.cjs'"
timeout /t 2 >nul

echo [*] Abriendo chat...
start "" "http://localhost:4183/chat.html"

echo.
echo ============================================================
echo  WindChat corriendo en 2o plano (sin ventanas).
echo  - Chat:  http://localhost:4183/chat.html
echo  - Relay: ws://localhost:8080 (lanzado por el server)
echo.
echo  PARA PROBAR E2EE: abre OTRA pestana en la misma URL, une
echo  DOS usuarios a la MISMA sala y compara el SAS (safety number):
echo  si coincide, no hay MITM.
echo.
echo  CERRAR: boton "Salir" en el chat, o  stop_chat.bat.
echo ============================================================
ENDLOCAL

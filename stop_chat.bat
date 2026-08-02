@echo off
REM ============================================================
REM WindChat - Detener servidores de prueba (2o plano)
REM Mata el relay Rust (:8080) y el server web (:4183).
REM ============================================================
SETLOCAL
echo [*] Cerrando WindChat (relay :8080 / server :4183)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4183 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 >nul
echo [OK] WindChat detenido.
ENDLOCAL

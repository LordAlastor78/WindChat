@echo off
REM ============================================================
REM WindChat - Detener servidores de prueba (2o plano)
REM Mata relay Rust (:8080), server web (:4183) y launcher share-link (:4300).
REM ============================================================
SETLOCAL
echo [*] Cerrando WindChat (relay :8080 / server :4183 / launcher :4300)...
REM findstr sin espacio final (mas robusto) y cubren 0.0.0.0 + 127.0.0.1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4183" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4300" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 >nul
echo [OK] WindChat detenido (limpio sin zombies).
ENDLOCAL

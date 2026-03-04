# WindChat - Control & Manager Script
# Menu para controlar servidor, cliente y procesos
# Uso: .\run.ps1

function Show-Menu {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host "<<< WindChat - Control Menu >>>" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[1] Iniciar ambos (servidor + cliente)" -ForegroundColor Yellow
    Write-Host "[2] Matar todos los procesos Node" -ForegroundColor Red
    Write-Host "[3] Ver procesos en ejecucion" -ForegroundColor Cyan
    Write-Host "[4] Limpiar puertos y reiniciar" -ForegroundColor Magenta
    Write-Host "[5] Solo servidor (localhost:8080)" -ForegroundColor Green
    Write-Host "[6] Solo cliente (localhost:3000)" -ForegroundColor Green
    Write-Host "[0] Salir" -ForegroundColor Gray
    Write-Host ""
}

function Kill-NodeProcesses {
    Write-Host "[*] Buscando procesos Node.js..." -ForegroundColor Yellow
    
    $nodeProcs = Get-Process node -ErrorAction SilentlyContinue
    
    if ($nodeProcs) {
        Write-Host "[+] Se encontraron $(($nodeProcs | Measure-Object).Count) procesos Node.js" -ForegroundColor Cyan
        
        foreach ($proc in $nodeProcs) {
            Write-Host "  - Matando PID $($proc.Id): $($proc.ProcessName)" -ForegroundColor Red
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        
        Write-Host "[OK] Procesos eliminados" -ForegroundColor Green
    } else {
        Write-Host "[*] No hay procesos Node.js en ejecucion" -ForegroundColor Cyan
    }
    
    Write-Host ""
}

function Show-RunningProcesses {
    Write-Host "[*] Procesos Node.js en ejecucion:" -ForegroundColor Yellow
    Write-Host ""
    
    $nodeProcs = Get-Process node -ErrorAction SilentlyContinue
    
    if ($nodeProcs) {
        $nodeProcs | Select-Object Id, ProcessName, Handles, Memory | Format-Table -AutoSize
    } else {
        Write-Host "  - Ninguno" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "[*] Puertos en uso:" -ForegroundColor Yellow
    Write-Host ""
    
    $ports = netstat -ano -p tcp 2>$null | Select-String "3000|8080|3001" -ErrorAction SilentlyContinue
    
    if ($ports) {
        foreach ($port in $ports) {
            Write-Host "  $port" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  - Puertos 3000/8080/3001 libres" -ForegroundColor Green
    }
    
    Write-Host ""
}

function Clean-PortsAndStart {
    Write-Host "[*] Limpiando puertos..." -ForegroundColor Yellow
    
    Kill-NodeProcesses
    
    Start-Sleep -Seconds 2
    
    Start-Dev
}

function Start-Dev {
    Write-Host "[*] Iniciando WindChat..." -ForegroundColor Green
    Write-Host ""
    Write-Host "  * Abre: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "  * Servidor: http://localhost:8080" -ForegroundColor Cyan
    Write-Host ""
    
    # Lanzar servidor en background
    Write-Host "[*] Iniciando servidor..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:server"
    
    Start-Sleep -Seconds 3
    
    # Lanzar cliente
    Write-Host "[*] Iniciando cliente..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:client"
    
    Write-Host "[OK] Procesos iniciados" -ForegroundColor Green
    Write-Host ""
}

function Start-ServerOnly {
    Write-Host "[*] Iniciando solo servidor..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:server"
    Write-Host "[OK] Servidor en localhost:8080" -ForegroundColor Green
    Write-Host ""
}

function Start-ClientOnly {
    Write-Host "[*] Iniciando solo cliente..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm run dev:client"
    Write-Host "[OK] Cliente en localhost:3000" -ForegroundColor Green
    Write-Host ""
}

# ===== MAIN LOOP =====

while ($true) {
    Show-Menu
    
    $choice = Read-Host "[?] Elige opcion"
    
    switch ($choice) {
        "1" {
            Write-Host "[*] Matando procesos previos..." -ForegroundColor Yellow
            Kill-NodeProcesses
            Start-Sleep -Seconds 2
            Start-Dev
        }
        "2" {
            Kill-NodeProcesses
        }
        "3" {
            Show-RunningProcesses
        }
        "4" {
            Clean-PortsAndStart
        }
        "5" {
            Start-ServerOnly
        }
        "6" {
            Start-ClientOnly
        }
        "0" {
            Write-Host "[*] Saliendo..." -ForegroundColor Yellow
            exit 0
        }
        default {
            Write-Host "[ERROR] Opcion no valida" -ForegroundColor Red
        }
    }
}

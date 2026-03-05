# WindChat - Control & Manager Script
# Menu para controlar lanzar servidor, cliente y procesos
# Uso: .\run.ps1

# ===== FUNCION DE DIAGNOSTICO AVANZADO CLOUDFLARE QUICK TUNNEL =====
function Invoke-CloudflaredQuickTunnelDiagnostic {
    <#
    .SYNOPSIS
        Script de diagnostico completo y profesional para Cloudflare Quick Tunnel.
        Realiza 7 fases de analisis para identificar por que falla la conexion.
    #>

    param(
        [string]$LogPath = "cloudflare_quick_tunnel_full_diagnostic.log",
        [string]$LocalServerUrl = "http://127.0.0.1:8080"
    )

    # Inicializacion
    $startTime = Get-Date
    $diagnosticData = @{
        Attempts = 0
        Successes = 0
        Failures = 0
        Errors = @()
        Times = @()
        EnvironmentInfo = @{}
        ConnectivityTests = @{}
        LocalServerStatus = $false
        QuickTunnelResult = @{
            Success = $false
            URL = ""
        }
        DiagnosisConclusion = ""
    }

    # Funcion auxiliar: escribir con timestamp en consola Y archivo
    function Log-Message {
        param(
            [string]$Message,
            [string]$Level = "INFO",
            [System.ConsoleColor]$Color = "White"
        )
        
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
        $logEntry = "[$timestamp] [$Level] $Message"
        
        Write-Host $logEntry -ForegroundColor $Color
        Add-Content -Path $LogPath -Value $logEntry -ErrorAction SilentlyContinue
    }

    function Log-Section {
        param([string]$Title)
        $separator = "=" * 80
        Log-Message $separator "SECTION" "Cyan"
        Log-Message $Title "SECTION" "Cyan"
        Log-Message $separator "SECTION" "Cyan"
    }

    # Limpiar log anterior
    if (Test-Path $LogPath) {
        Remove-Item $LogPath -Force -ErrorAction SilentlyContinue
    }

    Log-Section "INICIO DE DIAGNOSTICO CLOUDFLARE QUICK TUNNEL"
    Log-Message "Ruta de log: $LogPath" "INFO" "Gray"
    Log-Message "Servidor local: $LocalServerUrl" "INFO" "Gray"
    Log-Message ""

    try {
        # ===== FASE 1: INFORMACION DEL ENTORNO =====
        Log-Section "FASE 1 --- INFORMACION DEL ENTORNO"

        # Version de Windows
        $osVersion = [System.Environment]::OSVersion
        Log-Message "Sistema Operativo: $osVersion" "INFO" "Yellow"
        $diagnosticData.EnvironmentInfo.OS = $osVersion.ToString()

        # Version de PowerShell
        $psVersion = $PSVersionTable.PSVersion
        Log-Message "PowerShell: $psVersion" "INFO" "Yellow"
        $diagnosticData.EnvironmentInfo.PowerShell = $psVersion.ToString()

        # Version de cloudflared
        Log-Message "Ejecutando: cloudflared --version" "DEBUG" "Gray"
        $cloudflaredVersion = & cloudflared --version 2>&1
        Log-Message "Resultado: $cloudflaredVersion" "INFO" "Yellow"
        $diagnosticData.EnvironmentInfo.Cloudflared = $cloudflaredVersion

        # IP publica
        Log-Message "Obteniendo IP publica desde https://api.ipify.org..." "DEBUG" "Gray"
        try {
            $ipifyResponse = Invoke-WebRequest -UseBasicParsing -Uri "https://api.ipify.org?format=json" -TimeoutSec 10 -ErrorAction Stop 2>&1
            $publicIp = ($ipifyResponse.Content | ConvertFrom-Json).ip
            Log-Message "IP publica: $publicIp" "INFO" "Yellow"
            $diagnosticData.EnvironmentInfo.PublicIP = $publicIp
        } catch {
            Log-Message "No se pudo obtener IP publica: $($_.Exception.Message)" "WARN" "Yellow"
            $diagnosticData.EnvironmentInfo.PublicIP = "N/A"
        }

        # Configuracion DNS
        Log-Message "Configuracion DNS:" "DEBUG" "Gray"
        $dnsConfig = Get-DnsClientServerAddress -ErrorAction SilentlyContinue
        if ($dnsConfig) {
            $dnsServers = $dnsConfig | Where-Object { $_.ServerAddresses.Count -gt 0 } | ForEach-Object { $_.ServerAddresses -join ", " } | Select-Object -First 3
            foreach ($dns in $dnsServers) {
                Log-Message "  - $dns" "INFO" "Yellow"
            }
            $diagnosticData.EnvironmentInfo.DNS = $dnsServers
        } else {
            Log-Message "  No se pudo obtener configuracion DNS" "WARN" "Yellow"
        }

        # Proxy Windows
        Log-Message "Verificando proxy de Windows (netsh winhttp show proxy)..." "DEBUG" "Gray"
        $proxyInfo = & netsh winhttp show proxy 2>&1
        $proxyInfoText = $proxyInfo | Out-String
        $proxyInfoText.Split([Environment]::NewLine) | Where-Object { $_.Trim() -ne "" } | ForEach-Object {
            Log-Message "  $_" "INFO" "Yellow"
        }
        $diagnosticData.EnvironmentInfo.Proxy = $proxyInfoText.Trim()

        Log-Message ""

        # ===== FASE 2: VERIFICACION DE CONECTIVIDAD CON CLOUDFLARE =====
        Log-Section "FASE 2 --- VERIFICACION DE CONECTIVIDAD CON CLOUDFLARE"

        # Test de conectividad a api.trycloudflare.com
        Log-Message "Test 1: Conectividad TCP a api.trycloudflare.com:443" "DEBUG" "Gray"
        $tcpTest1Start = Get-Date
        try {
            $tcpTest1 = Test-NetConnection -ComputerName "api.trycloudflare.com" -Port 443 -ErrorAction Stop -WarningAction SilentlyContinue
            $tcpTest1Duration = ((Get-Date) - $tcpTest1Start).TotalMilliseconds
            
            if ($tcpTest1.TcpTestSucceeded) {
                Log-Message "  [OK] TCP conexion exitosa ($([int]$tcpTest1Duration)ms)" "OK" "Green"
                $diagnosticData.ConnectivityTests.TcpTriCloudflare = @{
                    Status = "OK"
                    Duration = $tcpTest1Duration
                }
            } else {
                Log-Message "  [FAIL] TCP conexion fallida" "ERROR" "Red"
                $diagnosticData.ConnectivityTests.TcpTriCloudflare = @{ Status = "FAILED" }
                $diagnosticData.Failures++
            }
        } catch {
            Log-Message "  [FAIL] Exception: $($_.Exception.Message)" "ERROR" "Red"
            $diagnosticData.ConnectivityTests.TcpTriCloudflare = @{ Status = "EXCEPTION"; Error = $_.Exception.Message }
        }

        # Test de conectividad a api.cloudflare.com
        Log-Message "Test 2: Conectividad TCP a api.cloudflare.com:443" "DEBUG" "Gray"
        $tcpTest2Start = Get-Date
        try {
            $tcpTest2 = Test-NetConnection -ComputerName "api.cloudflare.com" -Port 443 -ErrorAction Stop -WarningAction SilentlyContinue
            $tcpTest2Duration = ((Get-Date) - $tcpTest2Start).TotalMilliseconds
            
            if ($tcpTest2.TcpTestSucceeded) {
                Log-Message "  [OK] TCP conexion exitosa ($([int]$tcpTest2Duration)ms)" "OK" "Green"
                $diagnosticData.ConnectivityTests.TcpApiCloudflare = @{
                    Status = "OK"
                    Duration = $tcpTest2Duration
                }
            } else {
                Log-Message "  [FAIL] TCP conexion fallida" "ERROR" "Red"
                $diagnosticData.ConnectivityTests.TcpApiCloudflare = @{ Status = "FAILED" }
            }
        } catch {
            Log-Message "  [FAIL] Exception: $($_.Exception.Message)" "ERROR" "Red"
            $diagnosticData.ConnectivityTests.TcpApiCloudflare = @{ Status = "EXCEPTION"; Error = $_.Exception.Message }
        }

        # Test HTTP directo a api.trycloudflare.com
        Log-Message "Test 3: Peticion HTTP GET a https://api.trycloudflare.com" "DEBUG" "Gray"
        $httpTest1Start = Get-Date
        try {
            $httpTest1 = Invoke-WebRequest -UseBasicParsing -Uri "https://api.trycloudflare.com" -TimeoutSec 15 -ErrorAction Stop 2>&1
            $httpTest1Duration = ((Get-Date) - $httpTest1Start).TotalMilliseconds
            
            Log-Message "  [OK] HTTP $([int]$httpTest1Duration)ms - Status: $($httpTest1.StatusCode)" "OK" "Green"
            $diagnosticData.ConnectivityTests.HttpApiTriCloudflare = @{
                Status = "OK"
                Duration = $httpTest1Duration
                HttpCode = $httpTest1.StatusCode
            }
        } catch {
            $httpTest1Duration = ((Get-Date) - $httpTest1Start).TotalMilliseconds
            $errorMsg = $_.Exception.Message
            
            if ($errorMsg -match "timeout|timed out") {
                Log-Message "  [FAIL] TIMEOUT despues de $([int]$httpTest1Duration)ms" "ERROR" "Red"
                $diagnosticData.Errors += "HTTP_TIMEOUT"
            } elseif ($errorMsg -match "TLS|SSL") {
                Log-Message "  [FAIL] ERROR TLS/SSL despues de $([int]$httpTest1Duration)ms: $errorMsg" "ERROR" "Red"
                $diagnosticData.Errors += "TLS_ERROR"
            } elseif ($errorMsg -match "Unable to resolve") {
                Log-Message "  [FAIL] ERROR DNS: no se puede resolver dominio" "ERROR" "Red"
                $diagnosticData.Errors += "DNS_ERROR"
            } else {
                Log-Message "  [FAIL] ERROR HTTP despues de $([int]$httpTest1Duration)ms: $errorMsg" "ERROR" "Red"
                $diagnosticData.Errors += "HTTP_ERROR"
            }
            
            $diagnosticData.ConnectivityTests.HttpApiTriCloudflare = @{
                Status = "FAILED"
                Duration = $httpTest1Duration
                Error = $errorMsg
            }
            $diagnosticData.Failures++
        }

        Log-Message ""

        # ===== FASE 3: VERIFICACION DE FIREWALL LOCAL =====
        Log-Section "FASE 3 --- VERIFICACION DE FIREWALL LOCAL"

        # Estado del Firewall
        Log-Message "Estado del Firewall de Windows Defender..." "DEBUG" "Gray"
        try {
            $fwProfile = Get-NetFirewallProfile -ErrorAction SilentlyContinue
            if ($fwProfile) {
                $fwProfile | ForEach-Object {
                    $status = if ($_.Enabled) { "[ACTIVO]" } else { "[INACTIVO]" }
                    Log-Message "  $($_.Name) $status" "INFO" "Yellow"
                }
            }
        } catch {
            Log-Message "  No se pudo obtener estado del firewall: $($_.Exception.Message)" "WARN" "Yellow"
        }

        # Verificar si cloudflared esta permitido
        Log-Message "Verificando si cloudflared esta en excepciones del firewall..." "DEBUG" "Gray"
        try {
            $cloudflaredRules = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match "cloudflared" }
            if ($cloudflaredRules) {
                Log-Message "  [OK] cloudflared tiene reglas de firewall" "OK" "Green"
            } else {
                Log-Message "  [!] cloudflared no tiene reglas explicitas (podria ser bloqueado)" "WARN" "Yellow"
            }
        } catch {
            Log-Message "  No se pudo consultar reglas: $($_.Exception.Message)" "WARN" "Yellow"
        }

        # Verificar puerto 8080
        Log-Message "Verificando si el puerto 8080 esta en uso (netstat -ano)..." "DEBUG" "Gray"
        $netstatOutput = & netstat -ano 2>&1 | Select-String "8080"
        if ($netstatOutput) {
            $netstatOutput | ForEach-Object {
                Log-Message "  $_" "INFO" "Yellow"
            }
        } else {
            Log-Message "  Puerto 8080 no esta escuchando." "WARN" "Yellow"
        }

        Log-Message ""

        # ===== FASE 4: VERIFICAR SERVIDOR LOCAL EN 8080 =====
        Log-Section "FASE 4 --- VERIFICACION DEL SERVIDOR LOCAL EN 8080"

        Log-Message "Intentando conectar a $LocalServerUrl..." "DEBUG" "Gray"
        $localServerStart = Get-Date
        try {
            $localServerResponse = Invoke-WebRequest -UseBasicParsing -Uri $LocalServerUrl -TimeoutSec 5 -ErrorAction Stop 2>&1
            $localServerDuration = ((Get-Date) - $localServerStart).TotalMilliseconds
            
            Log-Message "  [OK] Servidor local responde ($([int]$localServerDuration)ms)" "OK" "Green"
            Log-Message "  Status Code: $($localServerResponse.StatusCode)" "INFO" "Green"
            $diagnosticData.LocalServerStatus = $true
        } catch {
            $localServerDuration = ((Get-Date) - $localServerStart).TotalMilliseconds
            Log-Message "  [FAIL] Servidor local NO responde ($([int]$localServerDuration)ms)" "ERROR" "Red"
            Log-Message "  Error: $($_.Exception.Message)" "ERROR" "Red"
            $diagnosticData.LocalServerStatus = $false
            $diagnosticData.Errors += "LOCAL_SERVER_DOWN"
        }

        Log-Message ""

        # ===== FASE 5: EJECUCION CONTROLADA DE QUICK TUNNEL =====
        Log-Section "FASE 5 --- EJECUCION CONTROLADA DE QUICK TUNNEL (3 INTENTOS)"

        $maxAttempts = 3
        $attemptDelaySeconds = 10
        $quickTunnelSuccess = $false
        $lastError = ""

        for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
            Log-Message ""
            Log-Message "====================================================" "DEBUG" "Cyan"
            Log-Message "INTENTO $attempt de $maxAttempts" "DEBUG" "Cyan"
            Log-Message "====================================================" "DEBUG" "Cyan"
            
            $diagnosticData.Attempts++

            $attemptStartTime = Get-Date
            Log-Message "Comando: cloudflared tunnel --protocol http2 --url $LocalServerUrl --loglevel debug" "DEBUG" "Gray"
            Log-Message "Hora inicio: $(Get-Date -Format 'HH:mm:ss.fff')" "DEBUG" "Gray"

            try {
                # Crear archivos temporales para capturar output
                $outputFile = [System.IO.Path]::GetTempFileName()
                $errorFile = [System.IO.Path]::GetTempFileName()

                # Ejecutar cloudflared con redirreccion
                $process = Start-Process -FilePath "cloudflared" `
                    -ArgumentList "tunnel", "--protocol", "http2", "--url", $LocalServerUrl, "--loglevel", "debug" `
                    -NoNewWindow `
                    -RedirectStandardOutput $outputFile `
                    -RedirectStandardError $errorFile `
                    -PassThru

                # cloudflared NO TERMINA cuando el tunnel funciona (se queda corriendo)
                # Monitorear la salida cada segundo durante max 15 segundos
                $monitorTimeout = 15
                $tunnelDetected = $false
                $tunnelUrl = ""
                
                for ($i = 0; $i -lt $monitorTimeout; $i++) {
                    Start-Sleep -Seconds 1
                    
                    # Leer salida parcial
                    $stdOut = Get-Content $outputFile -Raw -ErrorAction SilentlyContinue
                    $stdErr = Get-Content $errorFile -Raw -ErrorAction SilentlyContinue
                    
                    # Buscar mensaje de exito en stderr (cloudflared usa stderr para logs)
                    if ($stdErr -match "Your quick Tunnel has been created" -or $stdErr -match "https://[a-z0-9\-]+\.trycloudflare\.com") {
                        $tunnelDetected = $true
                        $tunnelUrl = [regex]::Match($stdErr, "https://[a-z0-9\-]+\.trycloudflare\.com").Value
                        break
                    }
                    
                    # Detectar errores fatales
                    if ($stdErr -match "failed to request quick Tunnel" -or $stdErr -match "context deadline exceeded") {
                        break
                    }
                    
                    # Si el proceso termino (error fatal), salir del loop
                    if ($process.HasExited) {
                        break
                    }
                }
                
                # Matar el proceso si sigue corriendo
                if (-not $process.HasExited) {
                    $process.Kill()
                    Start-Sleep -Milliseconds 500
                }
                
                $attemptDuration = ((Get-Date) - $attemptStartTime).TotalMilliseconds
                
                # Leer salida completa final
                $stdOut = Get-Content $outputFile -Raw -ErrorAction SilentlyContinue
                $stdErr = Get-Content $errorFile -Raw -ErrorAction SilentlyContinue

                Log-Message "Hora fin: $(Get-Date -Format 'HH:mm:ss.fff')" "DEBUG" "Gray"
                Log-Message "Duracion: $([int]$attemptDuration)ms" "DEBUG" "Gray"

                if ($stdOut) {
                    Log-Message "STDOUT:" "DEBUG" "Gray"
                    $stdOut.Split([Environment]::NewLine) | Where-Object { $_.Trim() -ne "" } | Select-Object -First 5 | ForEach-Object {
                        Log-Message "  $_" "INFO" "Gray"
                    }
                }

                if ($stdErr) {
                    Log-Message "STDERR:" "DEBUG" "Gray"
                    $stdErr.Split([Environment]::NewLine) | Where-Object { $_.Trim() -ne "" } | Select-Object -First 20 | ForEach-Object {
                        Log-Message "  $_" "INFO" "Gray"
                    }
                }

                # Evaluar resultado
                if ($tunnelDetected -and $tunnelUrl) {
                    Log-Message "  [OK] TUNNEL CREADO EXITOSAMENTE!" "OK" "Green"
                    Log-Message "  URL: $tunnelUrl" "OK" "Green"
                    Log-Message "  Conexion registrada correctamente" "OK" "Green"
                    $quickTunnelSuccess = $true
                    $diagnosticData.Successes++
                    $diagnosticData.Times += $attemptDuration
                    $diagnosticData.QuickTunnelResult.URL = $tunnelUrl
                    $diagnosticData.QuickTunnelResult.Success = $true
                    $lastError = ""
                    break
                } else {
                    Log-Message "  [FAIL] INTENTO $attempt FALLO" "ERROR" "Red"
                    $lastError = if ($stdErr) { $stdErr } elseif ($stdOut) { $stdOut } else { "No tunnel created" }
                    $diagnosticData.Failures++
                    $diagnosticData.Times += $attemptDuration
                    
                    if ($lastError -match "context deadline exceeded") {
                        $diagnosticData.Errors += "API_TIMEOUT"
                    } elseif ($lastError -match "failed to request") {
                        $diagnosticData.Errors += "API_REQUEST_FAILED"
                    }
                }

                # Limpiar archivos temporales
                Remove-Item $outputFile, $errorFile -ErrorAction SilentlyContinue
            } catch {
                $attemptDuration = ((Get-Date) - $attemptStartTime).TotalMilliseconds
                Log-Message "  [FAIL] EXCEPCION EN INTENTO $attempt : $($_.Exception.Message)" "ERROR" "Red"
                $lastError = $_.Exception.Message
                $diagnosticData.Failures++
                $diagnosticData.Times += $attemptDuration
            }

            # Pausa entre intentos (excepto despues del ultimo)
            if ($attempt -lt $maxAttempts -and -not $quickTunnelSuccess) {
                Log-Message "Esperando $attemptDelaySeconds segundos antes del siguiente intento..." "DEBUG" "Yellow"
                Start-Sleep -Seconds $attemptDelaySeconds
            }
        }

        Log-Message ""

        # ===== FASE 6: ANALISIS AUTOMATICO DE ERRORES =====
        Log-Section "FASE 6 --- ANALISIS AUTOMATICO DE ERRORES"

        if ($quickTunnelSuccess) {
            Log-Message "[OK] Quick Tunnel se creo exitosamente!" "OK" "Green"
            Log-Message "" "INFO" "White"
            Log-Message "DETALLES DE LA CONEXION:" "INFO" "Cyan"
            Log-Message "  -> Tunnel registrado en edge de Cloudflare" "OK" "Green"
            Log-Message "  -> Protocolo: http2" "INFO" "White"
            Log-Message "  -> URL publica: $($diagnosticData.QuickTunnelResult.URL)" "OK" "Green"
            Log-Message "  -> Servidor origen: http://127.0.0.1:8080" "INFO" "White"
            Log-Message "" "INFO" "White"
            $diagnosticData.DiagnosisConclusion = "EXITO: Quick Tunnel funcionando correctamente"
        } else {
            Log-Message "[FAIL] Quick Tunnel fallo en todos los intentos" "ERROR" "Red"
            
            # Analizar tipo de error
            $analysisResult = ""
            
            if ($lastError -match "context deadline exceeded|Client\.Timeout exceeded") {
                $analysisResult = "TIMEOUT DE CONTEXTO"
                Log-Message "  -> Causa probable: Timeout de conexion a API" "INFO" "Yellow"
                Log-Message "  -> Posibles razones:" "INFO" "Yellow"
                Log-Message "     1. Rate limiting de Quick Tunnel" "INFO" "Yellow"
                Log-Message "     2. Bloqueo de firewall/proxy" "INFO" "Yellow"
                Log-Message "     3. Latencia alta de red" "INFO" "Yellow"
                Log-Message "     4. ISP bloqueando Cloudflare" "INFO" "Yellow"
            }
            
            if ($lastError -match "TLS|SSL|handshake") {
                $analysisResult = "ERROR TLS/SSL"
                Log-Message "  -> Causa probable: Error en negociacion TLS" "INFO" "Yellow"
                Log-Message "  -> Posibles razones:" "INFO" "Yellow"
                Log-Message "     1. Inspeccion SSL de firewall/antivirus" "INFO" "Yellow"
                Log-Message "     2. Proxy corporate intermedio" "INFO" "Yellow"
                Log-Message "     3. MITM (Man-in-the-Middle) attack" "INFO" "Yellow"
                Log-Message "     4. Certificado no valido (proxy)" "INFO" "Yellow"
            }
            
            if ($lastError -match "Unable to resolve|Name.*did not resolve|Name.*unknown") {
                $analysisResult = "ERROR DNS"
                Log-Message "  -> Causa probable: No se puede resolver api.trycloudflare.com" "INFO" "Yellow"
                Log-Message "  -> Posibles razones:" "INFO" "Yellow"
                Log-Message "     1. Servidor DNS bloqueando Cloudflare" "INFO" "Yellow"
                Log-Message "     2. ISP bloqueando resolucion DNS" "INFO" "Yellow"
                Log-Message "     3. Configuracion de red incompleta" "INFO" "Yellow"
            }
            
            if ($lastError -match "connection refused|Connection refused") {
                $analysisResult = "CONEXION RECHAZADA"
                Log-Message "  -> Causa probable: Servidor rechaza conexion" "INFO" "Yellow"
                Log-Message "  -> Posibles razones:" "INFO" "Yellow"
                Log-Message "     1. Firewall bloqueando puerto 443" "INFO" "Yellow"
                Log-Message "     2. API de Cloudflare offline" "INFO" "Yellow"
            }
            
            if (-not $diagnosticData.LocalServerStatus) {
                $analysisResult = "SERVIDOR LOCAL NO DISPONIBLE"
                Log-Message "  -> El servidor en puerto 8080 no responde" "INFO" "Yellow"
                Log-Message "  -> Cloudflared no puede conectarse al origen" "INFO" "Yellow"
            }
            
            if (-not $analysisResult) {
                $analysisResult = "ERROR DESCONOCIDO"
                Log-Message "  -> No se puede determinar causa exacta" "INFO" "Yellow"
                Log-Message "  -> Ultimo error: $lastError" "INFO" "Yellow"
            }
            
            $diagnosticData.DiagnosisConclusion = $analysisResult
        }

        Log-Message ""

        # ===== FASE 7: RESUMEN FINAL =====
        Log-Section "FASE 7 --- RESUMEN FINAL Y RECOMENDACIONES"

        $avgTime = if ($diagnosticData.Times.Count -gt 0) { 
            $avg = ($diagnosticData.Times | Measure-Object -Average).Average
            "{0:F2}" -f $avg
        } else { 
            "N/A" 
        }

        Log-Message ""
        Log-Message "ESTADISTICAS:" "INFO" "Cyan"
        Log-Message "  Total intentos: $($diagnosticData.Attempts)" "INFO" "White"
        Log-Message "  Exitosos: $($diagnosticData.Successes)" "INFO" "White"
        Log-Message "  Fallidos: $($diagnosticData.Failures)" "INFO" "White"
        
        if ($diagnosticData.Successes -gt 0) {
            $successTime = "{0:F2}" -f ($diagnosticData.Times | Select-Object -First 1)
            Log-Message "  Tiempo creacion del tunnel: $successTime ms (~$([int]($successTime/1000))s)" "INFO" "Green"
        } else {
            Log-Message "  Tiempo promedio de fallo: $avgTime ms" "INFO" "White"
        }
        Log-Message ""

        Log-Message "ESTADO DEL ENTORNO:" "INFO" "Cyan"
        $serverStatus = if ($diagnosticData.LocalServerStatus) { "[OK] ACTIVO" } else { "[FAIL] INACTIVO" }
        Log-Message "  Servidor local 8080: $serverStatus" "INFO" "White"
        $tcpStatus = if ($diagnosticData.ConnectivityTests.TcpTriCloudflare.Status -eq "OK") { "[OK]" } else { "[FAIL]" }
        Log-Message "  Conectividad TCP a Cloudflare: $tcpStatus" "INFO" "White"
        $httpStatus = if ($diagnosticData.ConnectivityTests.HttpApiTriCloudflare.Status -eq "OK") { "[OK]" } else { "[FAIL]" }
        Log-Message "  HTTP a api.trycloudflare.com: $httpStatus" "INFO" "White"
        Log-Message ""

        Log-Message "DIAGNOSTICO FINAL:" "INFO" "Cyan"
        Log-Message "  $($diagnosticData.DiagnosisConclusion)" "INFO" "White"
        Log-Message ""

        Log-Message "RECOMENDACIONES:" "INFO" "Cyan"
        
        if ($quickTunnelSuccess) {
            Log-Message "  [OK] Tu conexion esta funcionando correctamente!" "OK" "Green"
            Log-Message "  Puedes usar Cloudflare Quick Tunnel sin problemas." "INFO" "Green"
            Log-Message "" 
            if ($diagnosticData.QuickTunnelResult.URL) {
                Log-Message "  URL del ultimo tunnel creado:" "INFO" "Cyan"
                Log-Message "    $($diagnosticData.QuickTunnelResult.URL)" "OK" "Green"
                Log-Message ""
                Log-Message "  Para usar el modo Cloudflare:" "INFO" "Cyan"
                Log-Message "    1. Ejecuta opcion [7] en el menu principal" "INFO" "White"
                Log-Message "    2. Espera 5-10 segundos a que se cree el tunnel" "INFO" "White"
                Log-Message "    3. Copia la URL https://xxx.trycloudflare.com" "INFO" "White"
                Log-Message "    4. Abre: https://xxx.trycloudflare.com/chat.html" "INFO" "White"
            }
        } else {
            if ($diagnosticData.Errors -contains "HTTP_TIMEOUT" -or $diagnosticData.Errors -contains "PROCESS_TIMEOUT") {
                Log-Message "  1. Desactiva temporalmente tu VPN/Proxy" "INFO" "Yellow"
                Log-Message "  2. Agrega excepciones en tu firewall para cloudflared.exe" "INFO" "Yellow"
                Log-Message "  3. Intenta desde una red diferente (WiFi, datos)" "INFO" "Yellow"
                Log-Message "  4. Verifica si tu ISP bloquea Cloudflare" "INFO" "Yellow"
            }
            
            if ($diagnosticData.Errors -contains "TLS_ERROR") {
                Log-Message "  1. Tu firewall/antivirus esta inspeccionando HTTPS" "INFO" "Yellow"
                Log-Message "  2. Desactiva inspeccion SSL temporalmente en tu proxy/firewall" "INFO" "Yellow"
                Log-Message "  3. Si usas VPN, prueba desactivarla" "INFO" "Yellow"
            }
            
            if ($diagnosticData.Errors -contains "DNS_ERROR") {
                Log-Message "  1. Cambia tu DNS a Public DNS (8.8.8.8, 1.1.1.1)" "INFO" "Yellow"
                Log-Message "  2. Usa: netsh interface ip set dns name='Ethernet' static 8.8.8.8" "INFO" "Yellow"
                Log-Message "  3. O: netsh interface ip set dns name='WiFi' static 1.1.1.1" "INFO" "Yellow"
            }
            
            if ($diagnosticData.Errors -contains "LOCAL_SERVER_DOWN") {
                Log-Message "  1. Asegurate de ejecutar el servidor Node.js primero" "INFO" "Yellow"
                Log-Message "  2. Ejecuta 'npm run dev:server' en otra consola" "INFO" "Yellow"
                Log-Message "  3. Verifica que no hay errores en startup del servidor" "INFO" "Yellow"
            }
            
            if (-not ($diagnosticData.Errors -contains "DNS_ERROR" -or $diagnosticData.Errors -contains "LOCAL_SERVER_DOWN" -or $diagnosticData.Errors -contains "TLS_ERROR")) {
                Log-Message "  1. Desactiva temporalmente tu VPN/Proxy" "INFO" "Yellow"
                Log-Message "  2. Agrega excepciones en tu firewall para cloudflared.exe" "INFO" "Yellow"
                Log-Message "  3. Intenta desde una red diferente (WiFi, datos)" "INFO" "Yellow"
                Log-Message "  4. Verifica si tu ISP bloquea Cloudflare" "INFO" "Yellow"
            }
            
            Log-Message "" "INFO" "White"
            Log-Message "  ACCION INMEDIATA:" "INFO" "Red"
            Log-Message "  -> Revisa el archivo de log completo para mas detalles" "INFO" "Red"
            $logResolved = Resolve-Path $LogPath -ErrorAction SilentlyContinue
            Log-Message "  -> Ruta: $logResolved" "INFO" "Red"
        }

        Log-Message ""
        Log-Message "================================================================================" "DEBUG" "Cyan"
        Log-Message "FIN DE DIAGNOSTICO - Archivo log guardado en: $LogPath" "DEBUG" "Cyan"
        Log-Message "================================================================================" "DEBUG" "Cyan"
        Log-Message ""

    } catch {
        Log-Message "[EXCEPCION GENERAL] $($_.Exception.Message)" "ERROR" "Red"
        Log-Message "$($_.ScriptStackTrace)" "ERROR" "Red"
    }
}

# ===== FIN FUNCION DIAGNOSTICO =====

function Show-Menu {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host "<<< WindChat - Control Menu >>>" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[1] Modo pruebas local (servidor + cliente)" -ForegroundColor Yellow
    Write-Host "[2] Matar todos los procesos Node" -ForegroundColor Red
    Write-Host "[3] Ver procesos en ejecucion" -ForegroundColor Cyan
    Write-Host "[4] Limpiar puertos y reiniciar" -ForegroundColor Magenta
    Write-Host "[5] Solo servidor (localhost:8080)" -ForegroundColor Green
    Write-Host "[6] Solo cliente (localhost:3000)" -ForegroundColor Green
    Write-Host "[7] Modo Cloudflare (server + client + tunnel)" -ForegroundColor Blue
    Write-Host "[8] Solo Cloudflare (abrir/cerrar tunnel)" -ForegroundColor Blue
    Write-Host "[9] Diagnostico Cloudflare Quick Tunnel (DEBUG)" -ForegroundColor Magenta
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
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:server"
    
    Start-Sleep -Seconds 3
    
    # Lanzar cliente
    Write-Host "[*] Iniciando cliente..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:client"
    
    Write-Host "[OK] Procesos iniciados" -ForegroundColor Green
    Write-Host ""
}

function Start-CloudflareMode {
    Write-Host "[*] Iniciando WindChat en modo Cloudflare..." -ForegroundColor Blue
    Write-Host ""

    $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflaredCmd) {
        Write-Host "[ERROR] cloudflared no esta instalado o no esta en PATH" -ForegroundColor Red
        Write-Host "[!] Instala cloudflared y vuelve a intentar" -ForegroundColor Yellow
        Write-Host ""
        return
    }

    Write-Host "  * Arquitectura: Servidor HIBRIDO (HTTP + WebSocket)" -ForegroundColor Cyan
    Write-Host "  * Puerto local: 8080" -ForegroundColor Cyan
    Write-Host "  * Se abriran 2 consolas: servidor + tunnel" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "[*] Compilando cliente..." -ForegroundColor Yellow
    $buildOutput = npm run build -w client 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Fallo al compilar cliente" -ForegroundColor Red
        Write-Host $buildOutput
        return
    }
    Write-Host "[OK] Cliente compilado en client/dist/" -ForegroundColor Green
    Write-Host ""

    Write-Host "[*] Iniciando servidor hibrido (HTTP + WebSocket)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:server"

    Start-Sleep -Seconds 5

    Write-Host "[*] Iniciando tunnel Cloudflare (puerto 8080)..." -ForegroundColor Blue
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '================================' -ForegroundColor Cyan; Write-Host '>>> WINDCHAT TUNNEL PUBLICO <<<' -ForegroundColor Yellow; Write-Host '================================' -ForegroundColor Cyan; Write-Host ''; Write-Host 'Copia la URL https://... y abrela' -ForegroundColor Yellow; Write-Host 'Esa es tu URL publica para compartir' -ForegroundColor Green; Write-Host ''; cloudflared tunnel --protocol http2 --url http://127.0.0.1:8080; if (`$LASTEXITCODE -ne 0) { Write-Host ''; Write-Host '[ERROR] El tunnel se cerro con error. Revisa red/firewall/VPN.' -ForegroundColor Red; Read-Host 'Pulsa Enter para cerrar esta ventana' }"

    Write-Host ""
    Write-Host "[OK] Modo Cloudflare completo iniciado" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== INSTRUCCIONES ===" -ForegroundColor Cyan
    Write-Host "1. Busca ventana 'WINDCHAT TUNNEL PUBLICO'" -ForegroundColor Yellow
    Write-Host "2. Copia la URL: https://xxx.trycloudflare.com" -ForegroundColor Yellow
    Write-Host "3. Abre: https://xxx.trycloudflare.com/chat.html" -ForegroundColor Yellow
    Write-Host "4. Comparte esa URL con otra persona" -ForegroundColor Yellow
    Write-Host "5. Ambos usan el MISMO roomID" -ForegroundColor Yellow
    Write-Host "" 
    Write-Host "[!] WebSocket se conecta automaticamente a la misma URL" -ForegroundColor Green
    Write-Host ""

    $publicUrl = Read-Host "[?] Pega la URL publica (https://...trycloudflare.com) para health check automatico (Enter para omitir)"
    if ($publicUrl) {
        Test-PublicTunnelHealth -PublicUrl $publicUrl
    } else {
        Write-Host "[*] Health check omitido por usuario" -ForegroundColor Gray
    }
    Write-Host ""
}

function Test-PublicTunnelHealth {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PublicUrl
    )

    $trimmedUrl = $PublicUrl.Trim().TrimEnd("/")
    if ($trimmedUrl -notmatch "^https?://") {
        Write-Host "[ERROR] URL invalida. Debe empezar por http:// o https://" -ForegroundColor Red
        return
    }

    $chatUrl = "$trimmedUrl/chat.html"
    $wsUrl = $trimmedUrl -replace "^https", "wss" -replace "^http", "ws"

    Write-Host ""
    Write-Host "[*] Ejecutando health check del tunnel publico..." -ForegroundColor Cyan
    Write-Host "  HTTP: $chatUrl" -ForegroundColor Gray
    Write-Host "  WSS : $wsUrl" -ForegroundColor Gray

    $httpOk = $false
    $wssOk = $false

    foreach ($attempt in 1..6) {
        Write-Host "[*] Intento $attempt/6..." -ForegroundColor Yellow

        try {
            $httpResponse = Invoke-WebRequest -UseBasicParsing -Uri $chatUrl -TimeoutSec 8
            if ($httpResponse.StatusCode -eq 200) {
                $httpOk = $true
                Write-Host "  [OK] HTTP /chat.html responde 200" -ForegroundColor Green
            }
        } catch {
            Write-Host "  [..] HTTP aun no disponible" -ForegroundColor DarkYellow
        }

        try {
            Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
            $client = [System.Net.WebSockets.ClientWebSocket]::new()
            $cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(8))
            $client.ConnectAsync([Uri]$wsUrl, $cts.Token).GetAwaiter().GetResult() | Out-Null
            if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $wssOk = $true
                Write-Host "  [OK] WebSocket WSS abre correctamente" -ForegroundColor Green
            }
            try { $client.Abort() } catch {}
            try { $client.Dispose() } catch {}
        } catch {
            Write-Host "  [..] WSS aun no disponible" -ForegroundColor DarkYellow
        }

        if ($httpOk -and $wssOk) {
            break
        }

        Start-Sleep -Seconds 2
    }

    Write-Host ""
    if ($httpOk -and $wssOk) {
        Write-Host "[OK] HEALTH CHECK SUPERADO" -ForegroundColor Green
        Write-Host "[OK] Puedes compartir la URL con confianza" -ForegroundColor Green
    } else {
        Write-Host "[WARN] HEALTH CHECK PARCIAL/FAIL" -ForegroundColor Yellow
        if (-not $httpOk) {
            Write-Host "  - HTTP /chat.html no estable" -ForegroundColor Yellow
        }
        if (-not $wssOk) {
            Write-Host "  - WSS no conecto" -ForegroundColor Yellow
        }
        Write-Host "[TIP] Espera 10-20s y vuelve a ejecutar opcion [8]" -ForegroundColor Cyan
    }
}

function Get-CloudflareProcesses {
    return Get-Process cloudflared -ErrorAction SilentlyContinue
}

function Stop-CloudflareOnly {
    $cloudflareProcs = Get-CloudflareProcesses
    if ($cloudflareProcs) {
        Write-Host "[*] Cerrando procesos cloudflared..." -ForegroundColor Yellow
        foreach ($proc in $cloudflareProcs) {
            Write-Host "  - Matando PID $($proc.Id): $($proc.ProcessName)" -ForegroundColor Red
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[OK] Tunnel Cloudflare detenido" -ForegroundColor Green
    } else {
        Write-Host "[*] No hay tunnel Cloudflare activo" -ForegroundColor Cyan
    }
    Write-Host ""
}

function Toggle-CloudflareOnly {
    $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflaredCmd) {
        Write-Host "[ERROR] cloudflared no esta instalado o no esta en PATH" -ForegroundColor Red
        Write-Host ""
        return
    }

    $existing = Get-CloudflareProcesses
    if ($existing) {
        Stop-CloudflareOnly
        return
    }

    Write-Host "[*] Iniciando solo tunnel Cloudflare..." -ForegroundColor Blue
    Write-Host "  * URL local origen: http://127.0.0.1:8080" -ForegroundColor Cyan
    Write-Host "  * Asegurate de tener servidor hibrido activo con opcion [5] o [7]" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cloudflared tunnel --protocol http2 --url http://127.0.0.1:8080; if (`$LASTEXITCODE -ne 0) { Write-Host ''; Write-Host '[ERROR] El tunnel se cerro con error. Revisa red/firewall/VPN.' -ForegroundColor Red; Read-Host 'Pulsa Enter para cerrar esta ventana' }"
    Write-Host "[OK] Tunnel Cloudflare iniciado (revisa la consola nueva para URL)" -ForegroundColor Green
    Write-Host ""
}

function Get-ActiveClientPort {
    foreach ($port in @(3000, 3001)) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return $port
            }
        } catch {
            # Probar siguiente puerto
        }
    }

    Write-Host "[!] No se detecto cliente en 3000/3001. Usando 3000 por defecto." -ForegroundColor Yellow
    return 3000
}

function Start-ServerOnly {
    Write-Host "[*] Iniciando solo servidor..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:server"
    Write-Host "[OK] Servidor en localhost:8080" -ForegroundColor Green
    Write-Host ""
}

function Start-ClientOnly {
    Write-Host "[*] Iniciando solo cliente..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:client"
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
        "7" {
            Write-Host "[*] Matando procesos previos..." -ForegroundColor Yellow
            Kill-NodeProcesses
            Start-Sleep -Seconds 2
            Start-CloudflareMode
        }
        "8" {
            Toggle-CloudflareOnly
        }
        "9" {
            Write-Host ""
            Invoke-CloudflaredQuickTunnelDiagnostic
            Read-Host "[?] Pulsa Enter para continuar"
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

# WindChat - Control & Manager Script
# Menu to control server, client, and related processes
# Usage: .\run.ps1

# ===== ADVANCED CLOUDFLARE QUICK TUNNEL DIAGNOSTICS FUNCTION =====
function Invoke-CloudflaredQuickTunnelDiagnostic {
    <#
    .SYNOPSIS
        Complete and professional diagnostic script for Cloudflare Quick Tunnel.
        Runs 7 analysis phases to identify why the connection fails.
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

    # Helper function: write timestamped messages to console and log file
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

    Log-Section "CLOUDFLARE QUICK TUNNEL DIAGNOSTICS START"
    Log-Message "Log path: $LogPath" "INFO" "Gray"
    Log-Message "Local server: $LocalServerUrl" "INFO" "Gray"
    Log-Message ""

    try {
        # ===== FASE 1: INFORMACION DEL ENTORNO =====
        Log-Section "PHASE 1 --- ENVIRONMENT INFORMATION"

        # Windows version
        $osVersion = [System.Environment]::OSVersion
        Log-Message "Operating System: $osVersion" "INFO" "Yellow"
        $diagnosticData.EnvironmentInfo.OS = $osVersion.ToString()

        # PowerShell version
        $psVersion = $PSVersionTable.PSVersion
        Log-Message "PowerShell: $psVersion" "INFO" "Yellow"
        $diagnosticData.EnvironmentInfo.PowerShell = $psVersion.ToString()

        # cloudflared version
        Log-Message "Ejecutando: cloudflared --version" "DEBUG" "Gray"
        $cloudflaredVersion = & cloudflared --version 2>&1
        Log-Message "Resultado: $cloudflaredVersion" "INFO" "Yellow"
        $diagnosticData.EnvironmentInfo.Cloudflared = $cloudflaredVersion

        # Public IP
        Log-Message "Getting public IP desde https://api.ipify.org..." "DEBUG" "Gray"
        try {
            $ipifyResponse = Invoke-WebRequest -UseBasicParsing -Uri "https://api.ipify.org?format=json" -TimeoutSec 10 -ErrorAction Stop 2>&1
            $publicIp = ($ipifyResponse.Content | ConvertFrom-Json).ip
            Log-Message "Public IP: $publicIp" "INFO" "Yellow"
            $diagnosticData.EnvironmentInfo.PublicIP = $publicIp
        } catch {
            Log-Message "Could not get Public IP: $($_.Exception.Message)" "WARN" "Yellow"
            $diagnosticData.EnvironmentInfo.PublicIP = "N/A"
        }

        # DNS configuration
        Log-Message "DNS configuration:" "DEBUG" "Gray"
        $dnsConfig = Get-DnsClientServerAddress -ErrorAction SilentlyContinue
        if ($dnsConfig) {
            $dnsServers = $dnsConfig | Where-Object { $_.ServerAddresses.Count -gt 0 } | ForEach-Object { $_.ServerAddresses -join ", " } | Select-Object -First 3
            foreach ($dns in $dnsServers) {
                Log-Message "  - $dns" "INFO" "Yellow"
            }
            $diagnosticData.EnvironmentInfo.DNS = $dnsServers
        } else {
            Log-Message "  Could not retrieve DNS configuration" "WARN" "Yellow"
        }

        # Proxy Windows
        Log-Message "Checking Windows proxy (netsh winhttp show proxy)..." "DEBUG" "Gray"
        $proxyInfo = & netsh winhttp show proxy 2>&1
        $proxyInfoText = $proxyInfo | Out-String
        $proxyInfoText.Split([Environment]::NewLine) | Where-Object { $_.Trim() -ne "" } | ForEach-Object {
            Log-Message "  $_" "INFO" "Yellow"
        }
        $diagnosticData.EnvironmentInfo.Proxy = $proxyInfoText.Trim()

        Log-Message ""

        # ===== PHASE 2: CLOUDFLARE CONNECTIVITY VERIFICATION =====
        Log-Section "PHASE 2 --- CLOUDFLARE CONNECTIVITY VERIFICATION"

        # Connectivity test to api.trycloudflare.com
        Log-Message "Test 1: TCP connectivity a api.trycloudflare.com:443" "DEBUG" "Gray"
        $tcpTest1Start = Get-Date
        try {
            $tcpTest1 = Test-NetConnection -ComputerName "api.trycloudflare.com" -Port 443 -ErrorAction Stop -WarningAction SilentlyContinue
            $tcpTest1Duration = ((Get-Date) - $tcpTest1Start).TotalMilliseconds
            
            if ($tcpTest1.TcpTestSucceeded) {
                Log-Message "  [OK] TCP connection successful ($([int]$tcpTest1Duration)ms)" "OK" "Green"
                $diagnosticData.ConnectivityTests.TcpTriCloudflare = @{
                    Status = "OK"
                    Duration = $tcpTest1Duration
                }
            } else {
                Log-Message "  [FAIL] TCP connection failed" "ERROR" "Red"
                $diagnosticData.ConnectivityTests.TcpTriCloudflare = @{ Status = "FAILED" }
                $diagnosticData.Failures++
            }
        } catch {
            Log-Message "  [FAIL] Exception: $($_.Exception.Message)" "ERROR" "Red"
            $diagnosticData.ConnectivityTests.TcpTriCloudflare = @{ Status = "EXCEPTION"; Error = $_.Exception.Message }
        }

        # Connectivity test to api.cloudflare.com
        Log-Message "Test 2: TCP connectivity a api.cloudflare.com:443" "DEBUG" "Gray"
        $tcpTest2Start = Get-Date
        try {
            $tcpTest2 = Test-NetConnection -ComputerName "api.cloudflare.com" -Port 443 -ErrorAction Stop -WarningAction SilentlyContinue
            $tcpTest2Duration = ((Get-Date) - $tcpTest2Start).TotalMilliseconds
            
            if ($tcpTest2.TcpTestSucceeded) {
                Log-Message "  [OK] TCP connection successful ($([int]$tcpTest2Duration)ms)" "OK" "Green"
                $diagnosticData.ConnectivityTests.TcpApiCloudflare = @{
                    Status = "OK"
                    Duration = $tcpTest2Duration
                }
            } else {
                Log-Message "  [FAIL] TCP connection failed" "ERROR" "Red"
                $diagnosticData.ConnectivityTests.TcpApiCloudflare = @{ Status = "FAILED" }
            }
        } catch {
            Log-Message "  [FAIL] Exception: $($_.Exception.Message)" "ERROR" "Red"
            $diagnosticData.ConnectivityTests.TcpApiCloudflare = @{ Status = "EXCEPTION"; Error = $_.Exception.Message }
        }

        # Test HTTP directo a api.trycloudflare.com
        Log-Message "Test 3: HTTP GET request a https://api.trycloudflare.com" "DEBUG" "Gray"
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
                Log-Message "  [FAIL] TIMEOUT after $([int]$httpTest1Duration)ms" "ERROR" "Red"
                $diagnosticData.Errors += "HTTP_TIMEOUT"
            } elseif ($errorMsg -match "TLS|SSL") {
                Log-Message "  [FAIL] TLS/SSL ERROR after $([int]$httpTest1Duration)ms: $errorMsg" "ERROR" "Red"
                $diagnosticData.Errors += "TLS_ERROR"
            } elseif ($errorMsg -match "Unable to resolve") {
                Log-Message "  [FAIL] DNS ERROR: domain could not be resolved" "ERROR" "Red"
                $diagnosticData.Errors += "DNS_ERROR"
            } else {
                Log-Message "  [FAIL] ERROR HTTP after $([int]$httpTest1Duration)ms: $errorMsg" "ERROR" "Red"
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

        # ===== PHASE 3: LOCAL FIREWALL VERIFICATION =====
        Log-Section "PHASE 3 --- LOCAL FIREWALL VERIFICATION"

        # Firewall status
        Log-Message "Windows Defender Firewall status..." "DEBUG" "Gray"
        try {
            $fwProfile = Get-NetFirewallProfile -ErrorAction SilentlyContinue
            if ($fwProfile) {
                $fwProfile | ForEach-Object {
                    $status = if ($_.Enabled) { "[ACTIVO]" } else { "[INACTIVO]" }
                    Log-Message "  $($_.Name) $status" "INFO" "Yellow"
                }
            }
        } catch {
            Log-Message "  Could not get firewall status: $($_.Exception.Message)" "WARN" "Yellow"
        }

        # Verificar si cloudflared esta permitido
        Log-Message "Checking whether cloudflared has firewall exceptions..." "DEBUG" "Gray"
        try {
            $cloudflaredRules = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match "cloudflared" }
            if ($cloudflaredRules) {
                Log-Message "  [OK] cloudflared has firewall rules" "OK" "Green"
            } else {
                Log-Message "  [!] cloudflared has no explicit rules (podria ser bloqueado)" "WARN" "Yellow"
            }
        } catch {
            Log-Message "  Could not query rules: $($_.Exception.Message)" "WARN" "Yellow"
        }

        # Check port 8080
        Log-Message "Checking whether port 8080 is in use (netstat -ano)..." "DEBUG" "Gray"
        $netstatOutput = & netstat -ano 2>&1 | Select-String "8080"
        if ($netstatOutput) {
            $netstatOutput | ForEach-Object {
                Log-Message "  $_" "INFO" "Yellow"
            }
        } else {
            Log-Message "  Port 8080 is not listening." "WARN" "Yellow"
        }

        Log-Message ""

        # ===== PHASE 4: VERIFY LOCAL SERVER ON 8080 =====
        Log-Section "PHASE 4 --- LOCAL SERVER VERIFICATION ON 8080"

        Log-Message "Trying to connect to $LocalServerUrl..." "DEBUG" "Gray"
        $localServerStart = Get-Date
        try {
            $localServerResponse = Invoke-WebRequest -UseBasicParsing -Uri $LocalServerUrl -TimeoutSec 5 -ErrorAction Stop 2>&1
            $localServerDuration = ((Get-Date) - $localServerStart).TotalMilliseconds
            
            Log-Message "  [OK] Local server responds ($([int]$localServerDuration)ms)" "OK" "Green"
            Log-Message "  Status Code: $($localServerResponse.StatusCode)" "INFO" "Green"
            $diagnosticData.LocalServerStatus = $true
        } catch {
            $localServerDuration = ((Get-Date) - $localServerStart).TotalMilliseconds
            Log-Message "  [FAIL] Local server does NOT respond ($([int]$localServerDuration)ms)" "ERROR" "Red"
            Log-Message "  Error: $($_.Exception.Message)" "ERROR" "Red"
            $diagnosticData.LocalServerStatus = $false
            $diagnosticData.Errors += "LOCAL_SERVER_DOWN"
        }

        Log-Message ""

        # ===== PHASE 5: CONTROLLED QUICK TUNNEL EXECUTION =====
        Log-Section "PHASE 5 --- CONTROLLED QUICK TUNNEL EXECUTION (3 ATTEMPTS)"

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
                # Create temporary files to capture output
                $outputFile = [System.IO.Path]::GetTempFileName()
                $errorFile = [System.IO.Path]::GetTempFileName()

                # Run cloudflared with redirection
                $process = Start-Process -FilePath "cloudflared" `
                    -ArgumentList "tunnel", "--protocol", "http2", "--url", $LocalServerUrl, "--loglevel", "debug" `
                    -NoNewWindow `
                    -RedirectStandardOutput $outputFile `
                    -RedirectStandardError $errorFile `
                    -PassThru

                # cloudflared DOES NOT EXIT when tunnel works (it keeps running)
                # Monitorear la salida cada segundo durante max 15 segundos
                $monitorTimeout = 15
                $tunnelDetected = $false
                $tunnelUrl = ""
                
                for ($i = 0; $i -lt $monitorTimeout; $i++) {
                    Start-Sleep -Seconds 1
                    
                    # Leer salida parcial
                    $stdOut = Get-Content $outputFile -Raw -ErrorAction SilentlyContinue
                    $stdErr = Get-Content $errorFile -Raw -ErrorAction SilentlyContinue
                    
                    # Look for success message in stderr (cloudflared uses stderr for logs)
                    if ($stdErr -match "Your quick Tunnel has been created" -or $stdErr -match "https://[a-z0-9\-]+\.trycloudflare\.com") {
                        $tunnelDetected = $true
                        $tunnelUrl = [regex]::Match($stdErr, "https://[a-z0-9\-]+\.trycloudflare\.com").Value
                        break
                    }
                    
                    # Detectar errores fatales
                    if ($stdErr -match "failed to request quick tunnel" -or $stdErr -match "context deadline exceeded") {
                        break
                    }
                    
                    # If process ended (fatal error), exit loop
                    if ($process.HasExited) {
                        break
                    }
                }
                
                # Kill process if still running
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
                    Log-Message "  [OK] TUNNEL CREATED SUCCESSFULLY!" "OK" "Green"
                    Log-Message "  URL: $tunnelUrl" "OK" "Green"
                    Log-Message "  Connection registered successfully" "OK" "Green"
                    $quickTunnelSuccess = $true
                    $diagnosticData.Successes++
                    $diagnosticData.Times += $attemptDuration
                    $diagnosticData.QuickTunnelResult.URL = $tunnelUrl
                    $diagnosticData.QuickTunnelResult.Success = $true
                    $lastError = ""
                    break
                } else {
                    Log-Message "  [FAIL] ATTEMPT $attempt FAILED" "ERROR" "Red"
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

            # Pause between attempts (except after the last one)
            if ($attempt -lt $maxAttempts -and -not $quickTunnelSuccess) {
                Log-Message "Waiting $attemptDelaySeconds seconds before next attempt..." "DEBUG" "Yellow"
                Start-Sleep -Seconds $attemptDelaySeconds
            }
        }

        Log-Message ""

        # ===== PHASE 6: AUTOMATIC ERROR ANALYSIS =====
        Log-Section "PHASE 6 --- AUTOMATIC ERROR ANALYSIS"

        if ($quickTunnelSuccess) {
            Log-Message "[OK] Quick Tunnel created successfully!" "OK" "Green"
            Log-Message "" "INFO" "White"
            Log-Message "CONNECTION DETAILS:" "INFO" "Cyan"
            Log-Message "  -> Tunnel registered on Cloudflare edge" "OK" "Green"
            Log-Message "  -> Protocolo: http2" "INFO" "White"
            Log-Message "  -> Public URL: $($diagnosticData.QuickTunnelResult.URL)" "OK" "Green"
            Log-Message "  -> Origin server: http://127.0.0.1:8080" "INFO" "White"
            Log-Message "" "INFO" "White"
            $diagnosticData.DiagnosisConclusion = "SUCCESS: Quick Tunnel working correctly"
        } else {
            Log-Message "[FAIL] Quick Tunnel failed on all attempts" "ERROR" "Red"
            
            # Analyze error type
            $analysisResult = ""
            
            if ($lastError -match "context deadline exceeded|Client\.Timeout exceeded") {
                $analysisResult = "CONTEXT TIMEOUT"
                Log-Message "  -> Likely cause: API connection timeout" "INFO" "Yellow"
                Log-Message "  -> Possible reasons:" "INFO" "Yellow"
                Log-Message "     1. Quick Tunnel rate limiting" "INFO" "Yellow"
                Log-Message "     2. Firewall/proxy blocking" "INFO" "Yellow"
                Log-Message "     3. High network latency" "INFO" "Yellow"
                Log-Message "     4. ISP bloqueando Cloudflare" "INFO" "Yellow"
            }
            
            if ($lastError -match "TLS|SSL|handshake") {
                $analysisResult = "TLS/SSL ERROR"
                Log-Message "  -> Likely cause: TLS negotiation error" "INFO" "Yellow"
                Log-Message "  -> Possible reasons:" "INFO" "Yellow"
                Log-Message "     1. SSL inspection by firewall/antivirus" "INFO" "Yellow"
                Log-Message "     2. Proxy corporate intermedio" "INFO" "Yellow"
                Log-Message "     3. MITM (Man-in-the-Middle) attack" "INFO" "Yellow"
                Log-Message "     4. Certificado no valido (proxy)" "INFO" "Yellow"
            }
            
            if ($lastError -match "Unable to resolve|Name.*did not resolve|Name.*unknown") {
                $analysisResult = "DNS ERROR"
                Log-Message "  -> Likely cause: cannot resolve api.trycloudflare.com" "INFO" "Yellow"
                Log-Message "  -> Possible reasons:" "INFO" "Yellow"
                Log-Message "     1. DNS server is blocking Cloudflare" "INFO" "Yellow"
                Log-Message "     2. ISP bloqueando resolucion DNS" "INFO" "Yellow"
                Log-Message "     3. Incomplete network configuration" "INFO" "Yellow"
            }
            
            if ($lastError -match "connection refused|Connection refused") {
                $analysisResult = "CONNECTION REFUSED"
                Log-Message "  -> Likely cause: server is refusing connection" "INFO" "Yellow"
                Log-Message "  -> Possible reasons:" "INFO" "Yellow"
                Log-Message "     1. Firewall blocking port 443" "INFO" "Yellow"
                Log-Message "     2. Cloudflare API offline" "INFO" "Yellow"
            }
            
            if (-not $diagnosticData.LocalServerStatus) {
                $analysisResult = "LOCAL SERVER NOT AVAILABLE"
                Log-Message "  -> Server on port 8080 is not responding" "INFO" "Yellow"
                Log-Message "  -> Cloudflared cannot connect to origin" "INFO" "Yellow"
            }
            
            if (-not $analysisResult) {
                $analysisResult = "UNKNOWN ERROR"
                Log-Message "  -> Exact cause cannot be determined" "INFO" "Yellow"
                Log-Message "  -> Last error: $lastError" "INFO" "Yellow"
            }
            
            $diagnosticData.DiagnosisConclusion = $analysisResult
        }

        Log-Message ""

        # ===== PHASE 7: FINAL SUMMARY =====
        Log-Section "PHASE 7 --- FINAL SUMMARY AND RECOMMENDATIONS"

        $avgTime = if ($diagnosticData.Times.Count -gt 0) { 
            $avg = ($diagnosticData.Times | Measure-Object -Average).Average
            "{0:F2}" -f $avg
        } else { 
            "N/A" 
        }

        Log-Message ""
        Log-Message "ESTADISTICAS:" "INFO" "Cyan"
        Log-Message "  Total attempts: $($diagnosticData.Attempts)" "INFO" "White"
        Log-Message "  Successful: $($diagnosticData.Successes)" "INFO" "White"
        Log-Message "  Failed: $($diagnosticData.Failures)" "INFO" "White"
        
        if ($diagnosticData.Successes -gt 0) {
            $successTime = "{0:F2}" -f ($diagnosticData.Times | Select-Object -First 1)
            Log-Message "  Tiempo creacion del tunnel: $successTime ms (~$([int]($successTime/1000))s)" "INFO" "Green"
        } else {
            Log-Message "  Average failure time: $avgTime ms" "INFO" "White"
        }
        Log-Message ""

        Log-Message "ESTADO DEL ENTORNO:" "INFO" "Cyan"
        $serverStatus = if ($diagnosticData.LocalServerStatus) { "[OK] ACTIVO" } else { "[FAIL] INACTIVO" }
        Log-Message "  Local server 8080: $serverStatus" "INFO" "White"
        $tcpStatus = if ($diagnosticData.ConnectivityTests.TcpTriCloudflare.Status -eq "OK") { "[OK]" } else { "[FAIL]" }
        Log-Message "  TCP connectivity a Cloudflare: $tcpStatus" "INFO" "White"
        $httpStatus = if ($diagnosticData.ConnectivityTests.HttpApiTriCloudflare.Status -eq "OK") { "[OK]" } else { "[FAIL]" }
        Log-Message "  HTTP a api.trycloudflare.com: $httpStatus" "INFO" "White"
        Log-Message ""

        Log-Message "FINAL DIAGNOSIS:" "INFO" "Cyan"
        Log-Message "  $($diagnosticData.DiagnosisConclusion)" "INFO" "White"
        Log-Message ""

        Log-Message "RECOMMENDATIONS:" "INFO" "Cyan"
        
        if ($quickTunnelSuccess) {
            Log-Message "  [OK] Your connection is working correctly!" "OK" "Green"
            Log-Message "  You can use Cloudflare Quick Tunnel without issues." "INFO" "Green"
            Log-Message "" 
            if ($diagnosticData.QuickTunnelResult.URL) {
                Log-Message "  URL of the last created tunnel:" "INFO" "Cyan"
                Log-Message "    $($diagnosticData.QuickTunnelResult.URL)" "OK" "Green"
                Log-Message ""
                Log-Message "  To use Cloudflare mode:" "INFO" "Cyan"
                Log-Message "    1. Ejecuta option [7] en el menu principal" "INFO" "White"
                Log-Message "    2. Wait 5-10 seconds for the tunnel to be created" "INFO" "White"
                Log-Message "    3. Copia la URL https://xxx.trycloudflare.com" "INFO" "White"
                Log-Message "    4. Abre: https://xxx.trycloudflare.com/chat.html" "INFO" "White"
            }
        } else {
            if ($diagnosticData.Errors -contains "HTTP_TIMEOUT" -or $diagnosticData.Errors -contains "PROCESS_TIMEOUT") {
                Log-Message "  1. Temporarily disable your VPN/Proxy" "INFO" "Yellow"
                Log-Message "  2. Add firewall exceptions for cloudflared.exe" "INFO" "Yellow"
                Log-Message "  3. Intenta desde una red diferente (WiFi, datos)" "INFO" "Yellow"
                Log-Message "  4. Check whether your ISP blocks Cloudflare" "INFO" "Yellow"
            }
            
            if ($diagnosticData.Errors -contains "TLS_ERROR") {
                Log-Message "  1. Your firewall/antivirus is inspecting HTTPS" "INFO" "Yellow"
                Log-Message "  2. Temporarily disable SSL inspection in your proxy/firewall" "INFO" "Yellow"
                Log-Message "  3. Si usas VPN, prueba desactivarla" "INFO" "Yellow"
            }
            
            if ($diagnosticData.Errors -contains "DNS_ERROR") {
                Log-Message "  1. Change your DNS to public DNS (8.8.8.8, 1.1.1.1)" "INFO" "Yellow"
                Log-Message "  2. Usa: netsh interface ip set dns name='Ethernet' static 8.8.8.8" "INFO" "Yellow"
                Log-Message "  3. O: netsh interface ip set dns name='WiFi' static 1.1.1.1" "INFO" "Yellow"
            }
            
            if ($diagnosticData.Errors -contains "LOCAL_SERVER_DOWN") {
                Log-Message "  1. Make sure to start Node.js server first" "INFO" "Yellow"
                Log-Message "  2. Ejecuta 'npm run dev:server' en otra consola" "INFO" "Yellow"
                Log-Message "  3. Verify there are no server startup errors" "INFO" "Yellow"
            }
            
            if (-not ($diagnosticData.Errors -contains "DNS_ERROR" -or $diagnosticData.Errors -contains "LOCAL_SERVER_DOWN" -or $diagnosticData.Errors -contains "TLS_ERROR")) {
                Log-Message "  1. Temporarily disable your VPN/Proxy" "INFO" "Yellow"
                Log-Message "  2. Add firewall exceptions for cloudflared.exe" "INFO" "Yellow"
                Log-Message "  3. Intenta desde una red diferente (WiFi, datos)" "INFO" "Yellow"
                Log-Message "  4. Check whether your ISP blocks Cloudflare" "INFO" "Yellow"
            }
            
            Log-Message "" "INFO" "White"
            Log-Message "  ACCION INMEDIATA:" "INFO" "Red"
            Log-Message "  -> Review the full log file for more details" "INFO" "Red"
            $logResolved = Resolve-Path $LogPath -ErrorAction SilentlyContinue
            Log-Message "  -> Path: $logResolved" "INFO" "Red"
        }

        Log-Message ""
        Log-Message "================================================================================" "DEBUG" "Cyan"
        Log-Message "END OF DIAGNOSTICS - Log file saved at: $LogPath" "DEBUG" "Cyan"
        Log-Message "================================================================================" "DEBUG" "Cyan"
        Log-Message ""

    } catch {
        Log-Message "[GENERAL EXCEPTION] $($_.Exception.Message)" "ERROR" "Red"
        Log-Message "$($_.ScriptStackTrace)" "ERROR" "Red"
    }
}

# ===== END DIAGNOSTICS FUNCTION =====

function Show-Menu {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host "<<< WindChat - Control Menu >>>" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[1] Local test mode (server + client)" -ForegroundColor Yellow
    Write-Host "[2] Kill all Node processes" -ForegroundColor Red
    Write-Host "[3] Show running processes" -ForegroundColor Cyan
    Write-Host "[4] Clean ports and restart" -ForegroundColor Magenta
    Write-Host "[5] Server only (localhost:8080)" -ForegroundColor Green
    Write-Host "[6] Client only (localhost:3000)" -ForegroundColor Green
    Write-Host "[7] Cloudflare mode (server + client + tunnel)" -ForegroundColor Blue
    Write-Host "[8] Cloudflare only (open/close tunnel)" -ForegroundColor Blue
    Write-Host "[9] Cloudflare Quick Tunnel diagnostics (DEBUG)" -ForegroundColor Magenta
    Write-Host "[10] Secure local mode (HTTPS + WSS)" -ForegroundColor DarkGreen
    Write-Host "[0] Exit" -ForegroundColor Gray
    Write-Host ""
}

function Kill-NodeProcesses {
    Write-Host "[*] Searching for Node.js processes..." -ForegroundColor Yellow
    
    $nodeProcs = Get-Process node -ErrorAction SilentlyContinue
    
    if ($nodeProcs) {
        Write-Host "[+] Found $(($nodeProcs | Measure-Object).Count) Node.js processes" -ForegroundColor Cyan
        
        foreach ($proc in $nodeProcs) {
            Write-Host "  - Killing PID $($proc.Id): $($proc.ProcessName)" -ForegroundColor Red
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        
        Write-Host "[OK] Processes terminated" -ForegroundColor Green
    } else {
        Write-Host "[*] No Node.js processes are running" -ForegroundColor Cyan
    }
    
    Write-Host ""
}

function Show-RunningProcesses {
    Write-Host "[*] Running Node.js processes:" -ForegroundColor Yellow
    Write-Host ""
    
    $nodeProcs = Get-Process node -ErrorAction SilentlyContinue
    
    if ($nodeProcs) {
        $nodeProcs | Select-Object Id, ProcessName, Handles, Memory | Format-Table -AutoSize
    } else {
        Write-Host "  - Ninguno" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "[*] Ports in use:" -ForegroundColor Yellow
    Write-Host ""
    
    $ports = netstat -ano -p tcp 2>$null | Select-String "3000|8080|3001" -ErrorAction SilentlyContinue
    
    if ($ports) {
        foreach ($port in $ports) {
            Write-Host "  $port" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  - Ports 3000/8080/3001 are free" -ForegroundColor Green
    }
    
    Write-Host ""
}

function Clean-PortsAndStart {
    Write-Host "[*] Cleaning ports..." -ForegroundColor Yellow
    
    Kill-NodeProcesses
    
    Start-Sleep -Seconds 2
    
    Start-Dev
}

function Start-Dev {
    Write-Host "[*] Starting WindChat..." -ForegroundColor Green
    Write-Host ""
    Write-Host "  * Open: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "  * Server: http://localhost:8080" -ForegroundColor Cyan
    Write-Host ""
    
    # Start server in background
    Write-Host "[*] Starting server..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:server"
    
    Start-Sleep -Seconds 3
    
    # Start client
    Write-Host "[*] Starting client..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:client"
    
    Write-Host "[OK] Processes started" -ForegroundColor Green
    Write-Host ""
}

function Get-LocalTlsConfig {
    $keyPath = $env:HTTPS_KEY_PATH
    $certPath = $env:HTTPS_CERT_PATH
    $caPath = $env:HTTPS_CA_PATH
    $passphrase = $env:HTTPS_PASSPHRASE

    if ($keyPath -and $certPath -and (Test-Path $keyPath) -and (Test-Path $certPath)) {
        return [pscustomobject]@{
            Enabled = $true
            KeyPath = (Resolve-Path $keyPath).Path
            CertPath = (Resolve-Path $certPath).Path
            CaPath = if ($caPath -and (Test-Path $caPath)) { (Resolve-Path $caPath).Path } else { $null }
            Passphrase = $passphrase
            Source = "environment"
        }
    }

    $candidatePairs = @(
        @{ Key = Join-Path $PWD "certs\localhost-key.pem"; Cert = Join-Path $PWD "certs\localhost-cert.pem" },
        @{ Key = Join-Path $PWD "localhost-key.pem"; Cert = Join-Path $PWD "localhost-cert.pem" },
        @{ Key = Join-Path $PWD ".certs\localhost-key.pem"; Cert = Join-Path $PWD ".certs\localhost-cert.pem" }
    )

    foreach ($pair in $candidatePairs) {
        if ((Test-Path $pair.Key) -and (Test-Path $pair.Cert)) {
            return [pscustomobject]@{
                Enabled = $true
                KeyPath = (Resolve-Path $pair.Key).Path
                CertPath = (Resolve-Path $pair.Cert).Path
                CaPath = $null
                Passphrase = $null
                Source = "local-files"
            }
        }
    }

    return [pscustomobject]@{
        Enabled = $false
        KeyPath = $null
        CertPath = $null
        CaPath = $null
        Passphrase = $null
        Source = "missing"
    }
}

function Start-SecureLocalMode {
    Write-Host "[*] Starting WindChat in secure local mode (HTTPS + WSS)..." -ForegroundColor Green
    Write-Host ""

    $tlsConfig = Get-LocalTlsConfig
    if (-not $tlsConfig.Enabled) {
        Write-Host "[ERROR] No local TLS certificates were found." -ForegroundColor Red
        Write-Host "[!] Provide HTTPS_KEY_PATH and HTTPS_CERT_PATH or place certs/localhost-key.pem and certs/localhost-cert.pem" -ForegroundColor Yellow
        Write-Host "[!] Tip: generate them with mkcert for localhost, 127.0.0.1 and ::1" -ForegroundColor Yellow
        Write-Host ""
        return
    }

    Write-Host "  * TLS source: $($tlsConfig.Source)" -ForegroundColor Cyan
    Write-Host "  * Server will use HTTPS + WSS" -ForegroundColor Cyan
    Write-Host "  * Client will use HTTPS dev server" -ForegroundColor Cyan
    Write-Host "  * Cert: $($tlsConfig.CertPath)" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "[*] Killing previous processes..." -ForegroundColor Yellow
    Kill-NodeProcesses
    Start-Sleep -Seconds 2

    $serverCommand = @(
        "Set-Location '$PWD'",
        "`$env:LOCAL_HTTPS='true'",
        "`$env:HTTPS_KEY_PATH='$($tlsConfig.KeyPath)'",
        "`$env:HTTPS_CERT_PATH='$($tlsConfig.CertPath)'"
    )
    if ($tlsConfig.CaPath) {
        $serverCommand += "`$env:HTTPS_CA_PATH='$($tlsConfig.CaPath)'"
    }
    if ($tlsConfig.Passphrase) {
        $serverCommand += "`$env:HTTPS_PASSPHRASE='$($tlsConfig.Passphrase)'"
    }
    $serverCommand += "npm run dev:server"

    Write-Host "[*] Starting secure server..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", ($serverCommand -join '; ')

    Start-Sleep -Seconds 4

    $clientCommand = @(
        "Set-Location '$PWD'",
        "`$env:DEV_HTTPS='true'",
        "npm run dev:client"
    )

    Write-Host "[*] Starting HTTPS client..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", ($clientCommand -join '; ')

    Write-Host "[OK] Secure local mode started" -ForegroundColor Green
    Write-Host ""
    Write-Host "  * Open: https://localhost:3000" -ForegroundColor Cyan
    Write-Host "  * Server: https://localhost:8080" -ForegroundColor Cyan
    Write-Host "  * WebSocket: wss://localhost:8080" -ForegroundColor Cyan
    Write-Host ""
}

function Start-CloudflareMode {
    Write-Host "[*] Starting WindChat in Cloudflare mode..." -ForegroundColor Blue
    Write-Host ""

    $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflaredCmd) {
        Write-Host "[ERROR] cloudflared is not installed or not in PATH" -ForegroundColor Red
        Write-Host "[!] Install cloudflared and try again" -ForegroundColor Yellow
        Write-Host ""
        return
    }

    Write-Host "  * Architecture: HYBRID server (HTTP + WebSocket)" -ForegroundColor Cyan
    Write-Host "  * Local port: 8080" -ForegroundColor Cyan
    Write-Host "  * Two consoles will open: server + tunnel" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "[*] Building client..." -ForegroundColor Yellow
    $buildOutput = npm run build -w client 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Client build failed" -ForegroundColor Red
        Write-Host $buildOutput
        return
    }
    Write-Host "[OK] Client built in client/dist/" -ForegroundColor Green
    Write-Host ""

    Write-Host "[*] Starting hybrid server (HTTP + WebSocket)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:server"

    Start-Sleep -Seconds 5

    Write-Host "[*] Starting Cloudflare tunnel (port 8080)..." -ForegroundColor Blue
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host '================================' -ForegroundColor Cyan; Write-Host '>>> WINDCHAT PUBLIC TUNNEL <<<' -ForegroundColor Yellow; Write-Host '================================' -ForegroundColor Cyan; Write-Host ''; Write-Host 'Copy the https://... URL and open it' -ForegroundColor Yellow; Write-Host 'That is your public URL to share' -ForegroundColor Green; Write-Host ''; cloudflared tunnel --protocol http2 --url http://127.0.0.1:8080; if (`$LASTEXITCODE -ne 0) { Write-Host ''; Write-Host '[ERROR] Tunnel closed with error. Check network/firewall/VPN.' -ForegroundColor Red; Read-Host 'Press Enter to close this window' }"

    Write-Host ""
    Write-Host "[OK] Full Cloudflare mode started" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== INSTRUCTIONS ===" -ForegroundColor Cyan
    Write-Host "1. Find the 'WINDCHAT PUBLIC TUNNEL' window" -ForegroundColor Yellow
    Write-Host "2. Copy the URL: https://xxx.trycloudflare.com" -ForegroundColor Yellow
    Write-Host "3. Open: https://xxx.trycloudflare.com/chat.html" -ForegroundColor Yellow
    Write-Host "4. Share that URL with another person" -ForegroundColor Yellow
    Write-Host "5. Both users must use the SAME room ID" -ForegroundColor Yellow
    Write-Host "" 
    Write-Host "[!] WebSocket connects automatically to the same URL" -ForegroundColor Green
    Write-Host ""

    $publicUrl = Read-Host "[?] Paste public URL (https://...trycloudflare.com) for automatic health check (press Enter to skip)"
    if ($publicUrl) {
        Test-PublicTunnelHealth -PublicUrl $publicUrl
    } else {
        Write-Host "[*] Health check skipped by user" -ForegroundColor Gray
    }
    Write-Host ""
}

function Test-PublicTunnelHealth {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PublicUrl
    )

    $trimmedUrl = $PublicUrl.Trim().TrimEnd("/")
    
    # Detectar y corregir URL duplicada (https://.../ https://...)
    if ($trimmedUrl -match "(https?://[^/]+)(?:/\1)") {
        Write-Host "[!] Duplicate URL detected, fixing..." -ForegroundColor Yellow
        $trimmedUrl = $matches[1]
    }
    
    # If it contains two URLs, extract only the first valid one
    $urlMatches = [regex]::Matches($trimmedUrl, "https?://[^/]+")
    if ($urlMatches.Count -gt 1) {
        Write-Host "[!] Multiple URLs detected, using the first one..." -ForegroundColor Yellow
        $trimmedUrl = $urlMatches[0].Value
    }
    
    if ($trimmedUrl -notmatch "^https?://") {
        Write-Host "[ERROR] Invalid URL. It must start with http:// or https://" -ForegroundColor Red
        return
    }

    $chatUrl = "$trimmedUrl/chat.html"
    $wsUrl = $trimmedUrl -replace "^https", "wss" -replace "^http", "ws"

    Write-Host ""
    Write-Host "[*] Running public tunnel health check..." -ForegroundColor Cyan
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
                Write-Host "  [OK] HTTP /chat.html returned 200" -ForegroundColor Green
            }
        } catch {
            Write-Host "  [..] HTTP not available yet" -ForegroundColor DarkYellow
        }

        try {
            Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
            $client = [System.Net.WebSockets.ClientWebSocket]::new()
            $cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(8))
            $client.ConnectAsync([Uri]$wsUrl, $cts.Token).GetAwaiter().GetResult() | Out-Null
            if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $wssOk = $true
                Write-Host "  [OK] WebSocket WSS opened successfully" -ForegroundColor Green
            }
            try { $client.Abort() } catch {}
            try { $client.Dispose() } catch {}
        } catch {
            Write-Host "  [..] WSS not available yet" -ForegroundColor DarkYellow
        }

        if ($httpOk -and $wssOk) {
            break
        }

        Start-Sleep -Seconds 2
    }

    Write-Host ""
    if ($httpOk -and $wssOk) {
        Write-Host "[OK] HEALTH CHECK PASSED" -ForegroundColor Green
        Write-Host "[OK] You can share the URL with confidence" -ForegroundColor Green
    } else {
        Write-Host "[WARN] HEALTH CHECK PARTIAL/FAILED" -ForegroundColor Yellow
        if (-not $httpOk) {
            Write-Host "  - HTTP /chat.html unstable" -ForegroundColor Yellow
        }
        if (-not $wssOk) {
            Write-Host "  - WSS did not connect" -ForegroundColor Yellow
        }
        Write-Host "[TIP] Wait 10-20s and run option [8] again" -ForegroundColor Cyan
    }
}

function Get-CloudflareProcesses {
    return Get-Process cloudflared -ErrorAction SilentlyContinue
}

function Stop-CloudflareOnly {
    $cloudflareProcs = Get-CloudflareProcesses
    if ($cloudflareProcs) {
        Write-Host "[*] Stopping cloudflared processes..." -ForegroundColor Yellow
        foreach ($proc in $cloudflareProcs) {
            Write-Host "  - Killing PID $($proc.Id): $($proc.ProcessName)" -ForegroundColor Red
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[OK] Cloudflare tunnel stopped" -ForegroundColor Green
    } else {
        Write-Host "[*] No active Cloudflare tunnel" -ForegroundColor Cyan
    }
    Write-Host ""
}

function Toggle-CloudflareOnly {
    $cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflaredCmd) {
        Write-Host "[ERROR] cloudflared is not installed or not in PATH" -ForegroundColor Red
        Write-Host ""
        return
    }

    $existing = Get-CloudflareProcesses
    if ($existing) {
        Stop-CloudflareOnly
        return
    }

    Write-Host "[*] Starting Cloudflare tunnel only..." -ForegroundColor Blue
    Write-Host "  * Local origin URL: http://127.0.0.1:8080" -ForegroundColor Cyan
    Write-Host "  * Make sure hybrid server is active with option [5] or [7]" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cloudflared tunnel --protocol http2 --url http://127.0.0.1:8080; if (`$LASTEXITCODE -ne 0) { Write-Host ''; Write-Host '[ERROR] Tunnel closed with error. Check network/firewall/VPN.' -ForegroundColor Red; Read-Host 'Press Enter to close this window' }"
    Write-Host "[OK] Cloudflare tunnel started (check new console for URL)" -ForegroundColor Green
    Write-Host ""
}

function Stop-ManagedProcessesOnExit {
    Write-Host "[*] Stopping managed processes before exit..." -ForegroundColor Yellow

    # 1) Always stop cloudflared to avoid orphan tunnels
    Stop-CloudflareOnly

    # 2) Ask whether to stop Node processes as well (server/client)
    $stopNode = Read-Host "[?] Also stop Node processes (server/client)? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($stopNode) -or $stopNode.Trim().ToLower() -eq "y") {
        Kill-NodeProcesses
    } else {
        Write-Host "[*] Keeping Node processes running" -ForegroundColor Cyan
        Write-Host ""
    }
}

function Get-ActiveClientPort {
    foreach ($port in @(3000, 3001)) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return $port
            }
        } catch {
            # Try next port
        }
    }

    Write-Host "[!] No client detected on 3000/3001. Using 3000 by default." -ForegroundColor Yellow
    return 3000
}

function Start-ServerOnly {
    Write-Host "[*] Starting server only..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:server"
    Write-Host "[OK] Server on localhost:8080" -ForegroundColor Green
    Write-Host ""
}

function Start-ClientOnly {
    Write-Host "[*] Starting client only..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; npm run dev:client"
    Write-Host "[OK] Client on localhost:3000" -ForegroundColor Green
    Write-Host ""
}

# ===== MAIN LOOP =====

while ($true) {
    Show-Menu
    
    $choice = Read-Host "[?] Choose an option"
    
    switch ($choice) {
        "1" {
            Write-Host "[*] Killing previous processes..." -ForegroundColor Yellow
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
            Write-Host "[*] Killing previous processes..." -ForegroundColor Yellow
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
            Read-Host "[?] Press Enter to continue"
        }
        "10" {
            Start-SecureLocalMode
        }
        "0" {
            Stop-ManagedProcessesOnExit
            Write-Host "[*] Exiting..." -ForegroundColor Yellow
            exit 0
        }
        default {
            Write-Host "[ERROR] Invalid option" -ForegroundColor Red
        }
    }
}

# WindChat Scripts Reference

Complete guide for setup, development, build, and local health checks.

## PowerShell Scripts (Windows)

### 1. .\setup.ps1 - First-time installation
Use when cloning the project for the first time.

```powershell
.\setup.ps1
```

What it does:
- Verifies Node.js and npm
- Installs root dependencies
- Installs server dependencies
- Installs client dependencies

### 2. .\dev.ps1 - Daily development launcher
Use for regular local development.

```powershell
.\dev.ps1
```

What it does:
- Installs dependencies if missing
- Opens one terminal for server (port 8080)
- Opens one terminal for client (port 3000)
- Prints quick usage instructions

### 3. .\build.ps1 - Production build
Use before deployment.

```powershell
.\build.ps1
```

What it does:
- Builds TypeScript server
- Builds Vite client
- Generates server/dist and client/dist

### 4. .\healthcheck.ps1 - Full local verification
Use when you want one command to validate connectivity and tests.

```powershell
.\healthcheck.ps1
```

What it checks:
- Server build
- Temporary server startup
- TCP connectivity on 127.0.0.1:8080
- HTTP 200 on /
- Real WebSocket handshake with 2 simulated clients
- Client build
- Client tests (vitest run)
- Automatic server teardown at the end

npm shortcut:

```bash
npm run healthcheck
```

## npm Scripts (Cross-platform)

### Server
```bash
npm run dev:server
npm run build:server
npm run start
```

### Client
```bash
npm run dev:client
npm run build:client
npm run client
```

### Monorepo
```bash
npm run dev
npm run build
npm run setup
npm run test
npm run healthcheck
```

## Typical Workflow

```powershell
# First time only
.\setup.ps1

# Daily development
.\dev.ps1

# Validate local health
npm run healthcheck

# Build for deployment
.\build.ps1
```

## Quick Troubleshooting

### Script execution policy issue
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Port 8080 already in use
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue).OwningProcess | Stop-Process -Force -ErrorAction SilentlyContinue
```

### npm not recognized
Install Node.js from https://nodejs.org (v20+ recommended).

### Missing dependencies
```bash
npm install
npm install --workspace=server
npm install --workspace=client
```

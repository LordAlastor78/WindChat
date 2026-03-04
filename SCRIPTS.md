# 📋 WindChat Scripts - Guía completa

Todos los scripts disponibles para desarrollar, testear y deployar WindChat.

---

## 🚀 Scripts PowerShell (Windows)

### 1. `.\setup.ps1` — Instalación inicial
**Cuándo usarlo:** Primera vez que clonas el proyecto

```powershell
.\setup.ps1
```

Qué hace:
- ✅ Verifica Node.js + npm
- ✅ Instala dependencias root
- ✅ Instala dependencias servidor
- ✅ Instala dependencias cliente

**Salida esperada:**
```
✅ Setup completado!
Próximos pasos:
  1. Ejecuta: .\dev.ps1
  2. Abre: https://localhost:3000
```

---

### 2. `.\dev.ps1` — Desarrollo completo
**Cuándo usarlo:** Todos los días para desarrollar

```powershell
.\dev.ps1
```

Qué hace:
- ✅ Verifica si están instaladas dependencias (sino instala)
- ✅ Lanza servidor en Terminal 1 (puerto 8080)
- ✅ Lanza cliente en Terminal 2 (puerto 3000)
- ✅ Muestra instrucciones

**Salida esperada:**
```
🔌 Iniciando servidor...
🖥️  Iniciando cliente...
✅ WindChat en desarrollo. Abre las ventanas que se abrieron...
```

Automáticamente se abren 2 ventanas PowerShell.

---

### 3. `.\build.ps1` — Build para producción
**Cuándo usarlo:** Antes de deployar

```powershell
.\build.ps1
```

Qué hace:
- ✅ Compila TypeScript servidor → JavaScript
- ✅ Bundlea cliente con Vite
- ✅ Genera `server/dist/` + `client/dist/`

**Salida esperada:**
```
✅ ¡Build completado!
Archivos generados:
  • server/dist/index.js → Deploy en servidor
  • client/dist/ → Deploy en CDN/webserver
```

---

## 📦 Scripts npm (cualquier OS)

### Terminal 1: Servidor
```bash
npm run dev:server          # Dev con hot reload
npm run build:server        # Build TypeScript
npm run start               # Alias para dev:server
```

### Terminal 2: Cliente
```bash
npm run dev:client          # Dev con Vite
npm run build:client        # Build cliente
npm run client              # Alias para dev:client
```

### Ambos
```bash
npm run dev                 # Dev ambos
npm run build               # Build ambos
npm run setup               # Setup limpio (instalar deps)
npm run test                # Build + start servidor
```

---

## 🔄 Flujo típico de desarrollo

```powershell
# Día 1: Setup inicial
.\setup.ps1

# Día 2+: Desarrollo diario
.\dev.ps1

# Test en navegador
# Abre: https://localhost:3000

# Cuando termines: Ctrl+C en ambas terminales
```

---

## 📦 Flujo compilación → Deploy

```powershell
# 1. Compilar
.\build.ps1

# 2. Servidor
cd server
node dist/index.js

# 3. En otra terminal: Exponer con CF Tunnel
cloudflared tunnel --url http://localhost:8080

# 4. Verás URL pública
# https://abc123-tunnel.trycloudflare.com

# 5. Deploy cliente en esa URL (nginx, etc.)
```

---

## 🆘 Troubleshooting

### "Cannot find script setup.ps1"
Tu PowerShell quizá tenga policy restrictiva.

```powershell
# Permite ejecución de scripts locales
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "Port 8080 already in use"
```powershell
# Mata proceso en puerto 8080
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue).OwningProcess | Stop-Process -Force -ErrorAction SilentlyContinue
```

### "npm: The term 'npm' is not recognized"
Node.js no está instalado. Descarga desde <https://nodejs.org> (v20+)

### "Cannot find module 'ws'"
```bash
npm install
npm install --workspace=server
npm install --workspace=client
```

---

## 📊 Matriz de uso

| Tarea | Script | Terminal | Tiempo |
|-------|--------|----------|--------|
| Primer setup | `.\setup.ps1` | 1 | 2 min |
| Dev diario | `.\dev.ps1` | 1 | <1 seg |
| Build prod | `.\build.ps1` | 1 | 10 seg |
| Solo servidor | `npm run dev:server` | 1 | <1 seg |
| Solo cliente | `npm run dev:client` | 1 | <1 seg |
| Deploy cloud | `.\build.ps1` + cf tunnel | 2 | 1 min |

---

## 💡 Pro tips

- **Hot reload:** Los cambios se ven automáticament (no necesitas restart)
- **Console logs:** Abre F12 en navegador para ver crypto logs
- **Múltiples salas:** Cada tab/navegador puede estar en sala diferente
- **Tema:** Click botón 🌙 para cambiar claro/oscuro
- **Dev tools:** DevTools → Network → WS filter para ver WebSocket

---

## 🎯 Comandos memorables

```powershell
.\dev.ps1                   # ¡Esta es tu mejor amiga!
.\setup.ps1                 # Solo primera vez
.\build.ps1                 # Antes de deployar
```

```bash
npm run dev                 # Setup manual completo
Ctrl+C                      # Detener servidor/cliente
```

---

**Fin.** Cualquier issue, revisa [README.md](README.md) sección "🐛 Debugging"

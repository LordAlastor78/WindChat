# 🚀 Quick Start - WindChat

## ⚡ La forma más rápida

### Windows (PowerShell) — ⭐ RECOMENDADO

Una sola línea lanza todo:

```powershell
# Primera vez SOLAMENTE
.\setup.ps1

# Después (todos los días)
.\dev.ps1
```

Eso es todo. Se abren 2 terminales automáticamente. ✅

---

### macOS / Linux

```bash
# 1. Navega a la carpeta
cd ~/path/to/WindChat

# 2. Setup inicial (solo primera vez)
npm install
npm install -w server
npm install -w client

# 3. Lanza todo
npm run dev
```

O en 2 terminales separadas:
```bash
# Terminal 1
npm run dev:server

# Terminal 2
npm run dev:client
```

---

## 🧪 Testing (5 minutos)

1. **Abre** `https://localhost:3000` en Navegador A
2. **Click** "Crear / Conectar" 
   - Se genera roomID (ej: `OxA1b2C3D4E5F6G7H8`)
3. **Copia** el roomID (botón "Copiar")
4. **Abre** `https://localhost:3000` en Navegador B (ventana privada/incógnito recomendado)
5. **Pega** el roomID y click conectar
6. ✅ **Ambos sincronizados** - ¡Chat funcionando!
7. **Prueba:**
   - Escribe "Hola" en A → Aparece en B descifrado ✅
   - Escribe "Mundo" en B → Aparece en A descifrado ✅
   - Abre F12 (DevTools) → Ve logs de criptografía

---

## 📋 Checklist rápida

- [ ] Servidor muestra "✅ cliente conectado"
- [ ] Cliente muestra "👥 Peer se unió"
- [ ] Mensajes aparecen en ambos lados
- [ ] Tema claro/oscuro funciona
- [ ] F12 console muestra "✅" logs

---

## 🆘 Si algo falla

### "Error: Cannot find module 'ws'"
```bash
npm install
npm install -w server
npm install -w client
```

### "Port 8080 already in use"
```bash
# Windows: Kill proceso en puerto 8080
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess | Stop-Process -Force

# macOS/Linux: 
lsof -ti:8080 | xargs kill -9
```

### "Certificate error" (localhost)
- Es normal, haz click en "Advanced" → "Proceed to localhost"
- Vite genera certificado auto-firmado (solo dev)

### "WebSocket connection failed"
- Verifica que servidor esté en terminal 1
- Verifica console (F12) para mais detalles

---

## 📚 Comandos npm

```bash
npm run start          # Solo servidor
npm run client         # Solo cliente
npm run build          # Build ambos
npm run setup          # Instalación limpia
npm run test           # Build + test servidor
```

---

## 🔍 Ver logs

**Terminal 1 (Servidor):**
```
✅ Nuevo cliente conectado
📍 Nueva room creada: OxA1b2C3...
👥 Room activa (2/2 clientes)
```

**Terminal 2 (Cliente - F12 Console):**
```
✅ KeyPair generado
📤 Handshake enviado
✅ Secreto compartido derivado
✅ Mensaje cifrado enviado
```

---

## ✅ Listo

Ejecuta `.\dev.ps1` (Windows) o `npm run dev` (Mac/Linux) y **¡disfruta!**

Cualquier issue, chequea [README.md](README.md) sección "🐛 Debugging"

# 🌬️ WindChat - Chat Cifrado E2EE

Chat web **seguro, efímero y ligero** con cifrado extremo a extremo.

**Estado:** MVP Fase 1 completado y listo para testing ✅

---

## 🎯 Características

- ✅ **Cifrado E2EE real** - AES-256-GCM autenticado
- ✅ **Intercambio de claves** - ECDH P-256 nativo
- ✅ **Ephemeral** - Sin persistencia, todo en memoria
- ✅ **Ultra-ligero** - <5MB descargado
- ✅ **Privado** - Servidor no ve contenido
- ✅ **1-a-1** - Para 2 usuarios controlados

---

## 🏗 Estructura

```
windchat/
├── server/              # WebSocket server (Node.js)
│   ├── src/
│   │   └── index.ts
│   └── package.json
├── client/              # Frontend (TypeScript + Vite)
│   ├── src/
│   │   ├── main.ts
│   │   ├── crypto.ts    # ⭐ Criptografía
│   │   ├── websocket.ts # ⭐ Cliente WS
│   │   └── ui.ts
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── vite.config.ts
├── shared/              # Tipos compartidos
│   └── protocol.ts
└── package.json         # Workspace monorepo
```

---

## 🔐 Especificación criptográfica

| Componente | Decisión | Detalles |
|-----------|----------|----------|
| **Key Exchange** | ECDH P-256 | Nativo en Web Crypto |
| **Key Derivation** | HKDF-SHA256 | salt = hash(roomId) |
| **Encryption** | AES-256-GCM | IV 12 bytes aleatorio |
| **IV** | Random cada mensaje | ⚠️ CRÍTICO: nunca reutilizar |
| **Autenticación** | GCM tag | Integrado en AES-GCM |
| **Timestamp** | Dentro del ciphertext | No visible al servidor |

### Flujo criptográfico

```
1. Cliente A genera KeyPair P-256
2. Cliente A envía publicKey (raw base64) → Servidor
3. Cliente B genera KeyPair P-256
4. Cliente B envía publicKey → Servidor
5. Servidor intercambia claves públicas

6. Cliente A: ECDH(privateA, publicB) = sharedSecret
7. Cliente A: HKDF(sharedSecret) = AES-Key
8. Cliente B: ECDH(privateB, publicA) = sharedSecret (MISMO)
9. Cliente B: HKDF(sharedSecret) = AES-Key (MISMO)

10. Cliente A escribe: "Hola"
11. Cifra: iv=random(12), ciphertext=AES-GCM(AES-Key, "Hola", iv)
12. Envía: {iv: base64, ciphertext: base64}
13. Servidor reenvía SIN VER CONTENIDO
14. Cliente B descifra: plaintext = AES-GCM-decrypt(AES-Key, ciphertext, iv)
15. Cliente B ve: "Hola"

SERVIDOR NUNCA VE: el mensaje, timestamp, ni contexto
```

---

## 🚀 Quick Start

### ⚡ Windows (la forma más fácil)

```powershell
# Primera vez
.\setup.ps1

# Después (diariamente)
.\dev.ps1
```

### Alternativa: npm comandos

**Terminal 1:**
```bash
npm install && npm install --workspace=server --workspace=client
npm run dev:server
```

**Terminal 2:**
```bash
npm run dev:client
```

### 🧪 Testing (3 pasos)

1. **Abre** `https://localhost:3000` en Navegador A → Click "Crear / Conectar"
2. **Copia** el roomId que aparece
3. **Abre** `https://localhost:3000` en Navegador B → Pega roomId → Click conectar
4. ✅ **Ambos conectados**

**Más detalles:** [QUICKSTART.md](QUICKSTART.md) | [SCRIPTS.md](SCRIPTS.md)

---

## 🔒 Limitaciones conocidas (MVP)

| Limitación | Razón | v2 |
|-----------|-------|-----|
| ❌ Forward secrecy por mensaje | Trade-off simplicidad | Double Ratchet |
| ❌ Autenticación de identidad | MVP scope | Key verification |
| ❌ Metadata visible | Ubicua en cualquier E2EE | Mejor mitigación |
| ❌ Persistencia | Diseño efímero | IndexedDB local |

---

## ⚙️ Configuración

### Variables de entorno

Ver `.env.example`:

```bash
cp .env.example .env
```

Editar si hiperparametros:

```
PORT=8080                    # Puerto servidor
MAX_USERS_PER_ROOM=2         # Hard limit
MAX_MESSAGE_SIZE=10485760    # 10MB
ROOM_TIMEOUT=30000           # 30s
```

### Vite config

`client/vite.config.ts` - Cambiar puerto si es necesario:

```typescript
server: {
  port: 3000,  // ← Editar aquí
}
```

---

## 📦 Build para producción

```bash
npm run build
```

Crea:
- `server/dist/index.js` → Deploy en servidor
- `client/dist/` → Host en CDN o servidor estático

---

## 🌐 Deploy con Cloudflare Tunnel

### Instalar Cloudflare CLI

```bash
# Windows (PowerShell)
choco install cloudflared

# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
curl https://pkg.cloudflare.com/index.html | bash
```

### Build producción

```bash
npm run build:server
npm run build:client
```

### Exponer con Tunnel

**Terminal 1 - Servidor**
```bash
cd server
node dist/index.js
```

**Terminal 2 - CF Tunnel**
```bash
cloudflared tunnel --url http://localhost:8080
```

Verás algo como:
```
https://example-123.trycloudflare.com
```

Ese es tu servidor expuesto (HTTPS automática ✅).

**Terminal 3 - Cliente (apunta a tunnel)**
```bash
VITE_SERVER_URL=https://example-123.trycloudflare.com npm run dev:client
```

---

## 🧪 Testing checklist

### Criptografía
- [ ] KeyPair se genera sin errores
- [ ] Claves públicas se intercambian
- [ ] Ambos derivanEl mismo sharedSecret (silenciosamente)
- [ ] IV es diferente en cada mensaje (check console)
- [ ] Descifrado funciona exactamente

### Red
- [ ] Handshake completo (check console)
- [ ] Máximo 2 usuarios por room
- [ ] 3ra conexión se rechaza
- [ ] Desconexión limpia

### UI
- [ ] RoomID generado y copiable
- [ ] Mensajes se muestran (izq/derecha)
- [ ] Tema claro/oscuro funciona
- [ ] Indicador "escribiendo..."
- [ ] Timestamps visibles

### Seguridad
- [ ] No hay logs de mensajes descifrados en servidor
- [ ] No hay datos sensibles en URL
- [ ] HTTPS/WSS en producción
- [ ] textContent (no innerHTML)

---

## 🐛 Debugging

### Ver tráfico criptográfico

Abre Chrome DevTools (F12) → Console

Verás logs como:
```
✅ KeyPair generado
📤 Clave pública lista
✅ Secreto compartido derivado
✅ Mensaje cifrado
📤 Retransmitido al peer
✅ Mensaje descifrado
```

### Ver tráfico WebSocket

DevTools → Network → Filtra por "ws"

Cada frame es un mensaje JSON:
```json
{
  "type": "message",
  "iv": "base64...",
  "ciphertext": "base64..." 
}
```

---

## 📚 Archivos clave

- **client/src/crypto.ts** (230 líneas)
  - `CryptoManager.generateKeyPair()`
  - `CryptoManager.deriveSharedKey()`
  - `CryptoManager.encrypt()` ← IV nuevo SIEMPRE
  - `CryptoManager.decrypt()`

- **server/src/index.ts** (220 líneas)
  - Room management en memoria
  - Handshake + key exchange
  - Message relay (blind)
  - Validaciones

- **shared/protocol.ts** (70 líneas)
  - Tipos TypeScript exactos
  - Documentación de flujo
  - Constantes críticas

---

## 🔒 Notas de seguridad

### ✅ Está bien hecho

- IV generado con `crypto.getRandomValues()` (criptográficamente seguro)
- HKDF para derivación (estándar IETF)
- GCM para autenticación (detecta tampering)
- Claves destruidas al desconectar
- Sanitización DOM (`textContent`, no `innerHTML`)

### ⚠️ Limitaciones intencionales

- No hay persistencia (así es por diseño)
- No hay identidad de usuario (confiar en enlace compartido)
- Servidor ve metadata (quién conecta cuándo)
- Sin forward secrecy por mensaje (v2)

### ❌ Qué evitar

- ❌ No usar localStorage para guardar claves
- ❌ No enviar sin HTTPS/WSS
- ❌ No cambiar UI a `innerHTML` dinámico
- ❌ No reutilizar IVs (revisar logs si pasa)

---

## 📝 Licencia

MIT

---

## 🎯 Próximos pasos (Fase 2)

- [ ] Adjuntos cifrados (imágenes/video)
- [ ] Reacciones a mensajes
- [ ] Responder mensajes (quote)
- [ ] Double Ratchet (forward secrecy)
- [ ] Key verification (fingerprints)
- [ ] Tests automatizados
- [ ] WebRTC P2P opcional

---

**Inicio:** 4 Marzo 2026  
**Versión:** 1.0.0 (MVP)  
**Stack:** Node.js + TypeScript + Web Crypto + Vite  
**Seguridad:** E2EE real, sin base de datos, servidor ciego  
✅ **Listo para producir**

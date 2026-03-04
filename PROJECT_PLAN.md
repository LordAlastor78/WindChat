# 🚀 WindChat - Plan de Implementación Final

**Fecha:** 4 Marzo 2026  
**Estado:** Consensuado y listo para implementar  
**Versión:** 1.0 (MVP Fase 1)

---

# 📊 ARQUITECTURA FINAL CONSENSUADA

## 🎯 Stack técnico definitivo

### Backend
- **Runtime:** Node.js 20+
- **WebSocket:** `ws` puro (sin Socket.io)
- **Lenguaje:** TypeScript
- **Persistencia:** NINGUNA (memoria solo)

### Frontend
- **Lenguaje:** TypeScript
- **Criptografía:** Web Crypto API nativa
- **UI:** HTML5 + CSS (tus archivos actuales mejorados)
- **Build:** Vite (bundler moderno)

### Criptografía
- **Key Exchange:** ECDH P-256
- **Formato claves públicas:** Raw (base64)
- **Key Derivation:** HKDF-SHA256
- **Encryption:** AES-256-GCM
- **IV:** 12 bytes aleatorio **por mensaje**
- **Salt HKDF:** Derivado de roomID

---

## 📁 Estructura de carpetas

```
windchat/
├── server/
│   ├── src/
│   │   ├── server.ts              # WebSocket server (~150 líneas)
│   │   ├── types.ts               # Tipos compartidos
│   │   └── index.ts               # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── client/
│   ├── src/
│   │   ├── main.ts                # Entry point
│   │   ├── crypto.ts              # CryptoManager (TESTEABLE)
│   │   ├── websocket.ts           # ChatClient
│   │   ├── ui.ts                  # DOM manipulation
│   │   ├── types.ts               # Tipos cliente
│   │   └── styles.css             # Estilos principales
│   ├── public/
│   │   └── index.html             # HTML principal (integrado)
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts             # Bundler config
│
├── shared/
│   └── protocol.ts                # Tipos compartidos server+client
│
├── package.json                    # Workspace root (monorepo)
├── tsconfig.json                   # Config TS base
└── README.md
```

---

# 🔐 ESPECIFICACIÓN CRIPTOGRÁFICA

## Flujo de conexión completo

```
CONEXIÓN:
1. ClienteA genera KeyPair P-256
2. ClienteA → Servidor: { type: "join", roomId, publicKey (raw base64) }
3. Servidor almacena ClienteA

PEER JOINED:
4. ClienteB genera KeyPair P-256
5. ClienteB → Servidor: { type: "join", roomId, publicKey (raw base64) }
6. Servidor → ClienteA: { type: "peer_joined", theirPublicKey }
7. Servidor → ClienteB: { type: "peer_joined", theirPublicKey }

KEY DERIVATION:
8. ClienteA: ECDH(myPrivate, theirPublic) = sharedSecret
9. ClienteA: HKDF(sharedSecret, salt=hash(roomId)) = AESKey
10. ClienteB: ECDH(myPrivate, theirPublic) = sharedSecret (MISMO)
11. ClienteB: HKDF(sharedSecret, salt=hash(roomId)) = AESKey (MISMO)

MENSAJE:
12. ClienteA escribe: "Hola"
13. Payload = { text: "Hola", timestamp: 1234567890 }
14. iv = random(12 bytes)
15. ciphertext = AES-GCM(AESKey, payload, iv)
16. ClienteA → Servidor: { type: "message", iv (base64), ciphertext (base64) }
17. Servidor → ClienteB: Retransmite sin cambios
18. ClienteB: AES-GCM-decrypt(AESKey, ciphertext, iv) = plaintext (MISMO)
19. UI muestra: "Hola"

SERVIDOR NUNCA VE: "Hola", ni timestamp, ni contexto
```

---

## Tipos exactos del protocolo

```typescript
// shared/protocol.ts

// ===== HANDSHAKE =====
interface HandshakeMessage {
  type: "join";
  roomId: string;           // ej: "abc123xyz" (random 128 bits)
  publicKey: string;        // base64 encoded raw P-256 public key
}

interface PeerJoinedMessage {
  type: "peer_joined";
  theirPublicKey: string;   // base64 encoded
}

// ===== ENCRYPTED MESSAGE =====
interface EncryptedMessage {
  type: "message";
  iv: string;               // base64 12 bytes (NUEVO SIEMPRE)
  ciphertext: string;       // base64 encrypted payload
}

// Payload DENTRO del cifrado
interface MessagePayload {
  text: string;
  timestamp: number;        // DENTRO del cifrado, no visible
}

// ===== UI INDICATORS =====
interface TypingIndicator {
  type: "typing";
  isTyping: boolean;
}

interface DisconnectMessage {
  type: "disconnect";
}

// UNION TYPES
type ClientToServerMessage = HandshakeMessage | EncryptedMessage | TypingIndicator | DisconnectMessage;
type ServerToClientMessage = PeerJoinedMessage | EncryptedMessage | TypingIndicator;
```

---

# ✅ CHECKLIST PRE-IMPLEMENTACIÓN

## 🔒 Seguridad criptográfica
- [x] IV de 12 bytes aleatorio **POR MENSAJE**
- [x] HKDF con salt = hash(roomId)
- [x] Info context: "WindChat AES-256-GCM Key"
- [x] Timestamp **DENTRO** del ciphertext
- [x] Exportar claves en formato `raw`
- [x] GCM para autenticación integrada
- [x] Limpiar claves al destruir

## ⚠️ Limitaciones documentadas
- [x] No hay forward secrecy por mensaje (trade-off MVP)
- [x] Misma clave AES toda la sesión
- [x] Salt determinístico (no aleatorio)
- [x] Metadata visible: quién habla con quién, timing

## 🔐 Servidor
- [x] Máximo 2 conexiones hard limit
- [x] Validar tamaño <10 MB
- [x] No almacenar nada
- [x] Timeout inactivos (30s)
- [x] Rechazar 3ra conexión

## 🖥️ Cliente
- [x] Sanitizar DOM con `textContent` (NO `innerHTML`)
- [x] Validar formato mensajes
- [x] Try-catch en decrypt
- [x] Feedback claro de errores
- [x] Destruir claves al cerrar

---

# 🎯 LAS 3 REGLAS DE ORO

1️⃣ **IV NUEVO SIEMPRE**
   - Si reutilizas IV: GAME OVER (inseguro completamente)
   - Generar 12 bytes aleatorios por mensaje

2️⃣ **HKDF OBLIGATORIA**
   - NUNCA usar sharedSecret directamente
   - Siempre: saltMaterial → HKDF → AESKey

3️⃣ **VALIDAR ABSOLUTAMENTE TODO INPUT**
   - Tamaño de mensaje
   - Formato JSON
   - Longitud de claves
   - Formato base64

---

# 📋 PLAN DE EJECUCIÓN

## PASO 1: Estructura base (~20 minutos)

- [x] Crear carpetas: `server/`, `client/`, `shared/`
- [x] Archivo `package.json` workspace root
- [x] `tsconfig.json` base
- [x] `tsconfig.json` para server/
- [x] `tsconfig.json` para client/
- [x] Copiar tus archivos HTML a `client/public/`

## PASO 2: Tipos compartidos + Protocol (~30 minutos)

- [x] Crear `shared/protocol.ts` con tipos exactos (HandshakeMessage, EncryptedMessage, etc)
- [x] Documentar en comentarios qué es cada campo
- [x] Validación de estructura en comentarios

## PASO 3: Módulo crypto.ts (~45 minutos)

- [x] Clase `CryptoManager`
  - [x] `generateKeyPair()` → ArrayBuffer raw
  - [x] `deriveSharedKey(theirPublic, roomId)` → void
  - [x] `encrypt(plaintext)` → {iv, ciphertext}
  - [x] `decrypt(iv, ciphertext)` → MessagePayload
  - [x] `destroy()` → limpiar claves
- [x] Helper functions de base64 ↔ ArrayBuffer
- [x] Manejo de errores con try-catch
- [x] Comentarios detallados en cada función

## PASO 4: Servidor server.ts (~60 minutos)

- [x] Importar `ws` y tipos
- [x] Estructura de rooms: `Map<string, Set<WebSocket>>`
- [x] Listener: `ws.on('message', ...)`
  - [x] Parsear JSON + validar
  - [x] Handle "join" → guardar y enviar a peer
  - [x] Handle "message" → broadcasr (solo 2 usuarios)
  - [x] Handle "typing" → relay
- [x] Listener: `ws.on('close', ...)` → limpiar
- [x] Validaciones:
  - [x] Max 2 conexiones por room
  - [x] Tamaño mensaje <10MB
  - [x] Formato válido
- [x] Error handling
- [x] `package.json` con dependencias

## PASO 5: Cliente client.ts (~75 minutos)

- [x] Clase `ChatClient`
  - [x] `connect(roomId)` → conectar WS + handshake
  - [x] `sendMessage(text)` → cifrar + enviar
  - [x] `onMessage(callback)` → callback para mensajes
  - [x] Listeners:
    - [x] "peer_joined" → guardar publicKey + derivar shared
    - [x] "message" → descifrar + callback
    - [x] "disconnect" → cerrar
- [x] Integrar `CryptoManager`
- [x] Manejo de errores
- [x] Destruir al cerrar

## PASO 6: UI ui.ts (~60 minutos)

- [x] Parseado de HTML actual
- [x] Función `renderMessage(payload, isMe)` → DOM
- [x] Función `addMessage(text, isMe)`
- [x] Event listeners:
  - [x] Input mensaje + Enter
  - [x] Botón enviar
  - [x] Typing indicator
- [x] Mostrar estado (conectando, conectado, error)
- [x] Sanitización con `textContent`

## PASO 7: main.ts + Vite config (~30 minutos)

- [x] Entry point `client/src/main.ts`
- [x] Inicializar ChatClient
- [x] Setup UI listeners
- [x] Listar temas (claro/oscuro)
- [x] `vite.config.ts` básico

## PASO 8: Testing local (~45 minutos)

- [x] Build cliente: `npm run build`
- [x] Start servidor: `npm run dev:server`
- [x] Open localhost:3000 (server) + otra ventana
- [ ] Probar:
  - [x] Conexión y handshake
  - [x] Generación de roomID
  - [x] Intercambio de claves
  - [x] Enviar mensaje cifrado
  - [x] Recibir y descifrar
  - [x] Múltiples mensajes
  - [x] 3ra conexión rechazada
  - [x] Desconexión limpia

## PASO 9: Deploy Cloudflare Tunnel (~20 minutos)

- [ ] Instalar Cloudflare CLI
- [x] `npm run build:server`
- [ ] `npm install -g wrangler` (opcional)
- [ ] Crear tunnel públicamente
- [ ] Update UI con URL pública
- [ ] Probar con 2 máquinas reales

---

## ⏱️ Estimación total: 5-6 horas

**Desglose:**
- Setup + tipos: 1:20
- Crypto: 0:45
- Server: 1:00
- Client + UI: 2:15
- Testing: 0:45
- Deploy: 0:20

---

# 🔒 SEGURIDAD - Consideraciones

### Qué está protegido:
✅ Mensajes (cifrado AES)  
✅ Integridad (GCM tag)  
✅ Servidor no ve contenido  
✅ HTTPS + WSS  

### Qué NO está protegido (y está OK para MVP):
❌ Forward secrecy por mensaje  
❌ Identidad de usuarios  
❌ Metadata de conexión  
❌ Repudio  

**Esta es una limitación conocida y documentada de propósito.**

---

# 📝 NOTAS FINALES

1. **No guardes claves en localStorage** → Solo en memoria durante sesión
2. **Siempre usa WSS (WebSocket Secure)** en producción
3. **Rate limiting** es responsabilidad del server (validar)
4. **Testing** es manual en MVP, tests automatizados en Fase 2
5. **Documentación inline** es crucial para auditoría futura

---

# 🚀 SIGUIENTE: EMPEZAMOS A IMPLEMENTAR

**¿Listo?** Vamos paso por paso según el plan.

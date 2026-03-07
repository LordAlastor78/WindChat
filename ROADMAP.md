# 🗺️ WindChat - Roadmap de Verificación y Mejoras

**Fecha:** Marzo 2026  
**Versión:** 1.0.0  

---

## 📋 Índice

1. [Bugs Críticos - Estabilidad](#-1-bugs-críticos---estabilidad)
2. [Bugs de Lógica - Media Prioridad](#-2-bugs-de-lógica---media-prioridad)
3. [Mejoras de UI - Alta Prioridad](#-3-mejoras-de-ui---alta-prioridad)
4. [Funcionalidades de Notificaciones](#-4-funcionalidades-de-notificaciones)
5. [Internacionalización (i18n)](#-5-internacionalización-i18n)
6. [Mejoras de Seguridad](#-6-mejoras-de-seguridad)
7. [Mejoras de UX/Usabilidad](#-7-mejoras-de-uxusabilidad)
8. [Funcionalidades Avanzadas](#-8-funcionalidades-avanzadas)
9. [Testing y Validación](#-9-testing-y-validación)
10. [Optimizaciones de Rendimiento](#-10-optimizaciones-de-rendimiento)

---

## ⚠️ Consideraciones Técnicas Críticas

### 🔐 1. **File Sharing - Control de Flujo (Backpressure)**
**Riesgo:** Enviar archivos grandes (50MB) vía WebSocket puede saturar el buffer del servidor/cliente si no se gestiona bien el flujo.

**Solución Implementar:**
- ✅ En `fileManager.ts`, usar un sistema de "pausa/reanudación" entre chunks
- ✅ Esperar confirmación del servidor antes de enviar siguiente chunk (opcional)
- ✅ Monitorear el `bufferedAmount` del WebSocket:

```typescript
// En sendFile(), verificar buffer antes de cada chunk
async sendChunk(chunk: ArrayBuffer) {
  // Si el buffer del WebSocket > 1MB, esperar
  while (this.ws.bufferedAmount > 1024 * 1024) {
    await this.delay(100); // Esperar 100ms
  }
  
  this.ws.send(chunk);
}
```

**Optimización adicional:**
- Para imágenes, considerar compresión con Canvas (`canvas.toBlob('image/webp', 0.8)`) antes de cifrar
- Esto reduce tamaño ~60% sin pérdida visual significativa
- Trade-off: Añade 100-200ms de procesamiento

---

### 🔄 2. **Reconexión WebSocket - Regeneración de Claves**
**Peligro:** Si se reconecta sin regenerar claves, la integridad del estado se rompe si el servidor reinició.

**Flujo CORRECTO de reconexión:**
```
1. Detectar desconexión (ws.onclose)
2. Destruir claves actuales (crypto.destroy())
3. Limpiar estado local (mensajes en memoria, etc.)
4. Intentar reconectar con backoff exponencial
5. Generar NUEVAS claves ECDH
6. Re-hacer Handshake completo
7. Notificar al usuario que debe compartir room ID de nuevo
```

**Implementación en websocket.ts:**
```typescript
private async reconnect() {
  console.log(`Reconexión intento ${this.reconnectAttempts}...`);
  
  // 1. Destruir estado anterior
  this.crypto.destroy();
  this.messageQueue = [];
  
  // 2. Generar nuevas claves
  await this.crypto.generateKeyPair();
  
  // 3. Reconectar
  this.ws = new WebSocket(this.url);
  this.setupHandlers();
  
  // 4. Re-hacer handshake
  this.ws.onopen = () => {
    this.sendHandshake();
  };
}
```

---

### 🔊 3. **Notificaciones y Sonidos - AudioContext Bloqueado**
**Problema:** Los navegadores modernos (Chrome, Firefox, Safari) bloquean audio automático hasta que el usuario interactúe con la página.

**Error común:**
```
DOMException: play() failed because user didn't interact with document first.
```

**Solución CORRECTA:**
```typescript
// SoundManager debe inicializar AudioContext DESPUÉS de interacción
export class SoundManager {
  private audioContext: AudioContext | null = null;
  private isInitialized: boolean = false;
  
  // Llamar esto en el primer click/tap del usuario
  async initialize() {
    if (this.isInitialized) return;
    
    this.audioContext = new AudioContext();
    
    // Resume context (necesario en iOS)
    await this.audioContext.resume();
    
    this.isInitialized = true;
    console.log('SoundManager inicializado');
  }
  
  playSendSound() {
    if (!this.isInitialized) {
      console.warn('Audio no inicializado. Click primero.');
      return;
    }
    // ... reproducir sonido
  }
}

// En main.ts
const soundManager = new SoundManager();

// Inicializar en el primer click del usuario
document.body.addEventListener('click', () => {
  soundManager.initialize();
}, { once: true });
```

**UI para usuario:**
```html
<!-- Mostrar banner hasta que el usuario haga click -->
<div id="audioPrompt" class="banner">
  ⚠️ Toca en cualquier lugar para habilitar sonidos
</div>
```

---

### 🌐 4. **PWA Service Workers - Requisito de HTTPS**
**Problema:** Service Workers SOLO funcionan con HTTPS (excepto `localhost`).

**Escenarios:**

| Entorno | Service Worker | Solución |
|---------|---------------|----------|
| `localhost:5173` | ✅ Funciona | - |
| `192.168.x.x:5173` | ❌ HTTP no soportado | Usar túnel con HTTPS |
| Cloudflare Quick Tunnel | ⚠️ A veces funciona | Probar manualmente |
| Vercel/Netlify | ✅ HTTPS automático | Recomendado |
| Dominio propio | ✅ Con certificado SSL | Let's Encrypt gratis |

**Limitación de Cloudflare Tunnel:**
- El Quick Tunnel (`cloudflared tunnel --url http://localhost:5173`) proporciona HTTPS, PERO:
  - La URL cambia cada vez (`https://random-words.trycloudflare.com`)
  - Service Workers se invalidan si el dominio cambia
  - El scope del SW queda vinculado al dominio anterior

**Solución para desarrollo:**
```bash
# Opción 1: mkcert (certificado local confiable)
npm install -g mkcert
mkcert -install
mkcert localhost 192.168.1.x

# Luego en vite.config.ts:
import fs from 'fs';

export default {
  server: {
    https: {
      key: fs.readFileSync('./localhost-key.pem'),
      cert: fs.readFileSync('./localhost.pem')
    }
  }
}
```

```bash
# Opción 2: Cloudflare Tunnel con dominio fijo
cloudflared tunnel --url http://localhost:5173 --hostname windchat.tu-dominio.com
# Requiere tener dominio configurado en Cloudflare
```

**Solución para producción:**
- Desplegar en Vercel/Netlify/Cloudflare Pages (HTTPS automático)
- O configurar Nginx con Let's Encrypt:

```nginx
server {
  listen 443 ssl http2;
  server_name windchat.tudominio.com;
  
  ssl_certificate /etc/letsencrypt/live/tudominio.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;
  
  location / {
    proxy_pass http://localhost:5173;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade"; # Para WebSocket
  }
}
```

**Verificación:**
```javascript
// Detectar si Service Worker está disponible
if ('serviceWorker' in navigator) {
  if (location.protocol === 'https:' || location.hostname === 'localhost') {
    navigator.serviceWorker.register('/service-worker.js');
  } else {
    console.warn('⚠️ Service Worker requiere HTTPS');
  }
}
```

---

## 🔴 1. Bugs Críticos - Estabilidad

### 1.1 **Manejo de Reconexión WebSocket** ⚠️ CRÍTICO
**Estado:** ❌ Falta implementar  
**Prioridad:** CRÍTICA  
**Archivo:** `client/src/websocket.ts`

**Problema:**
- Existe una variable `reconnectAttempts` pero no se usa
- No hay lógica de reconexión automática
- Si el WebSocket se cae, el usuario pierde la conexión permanentemente

**⚠️ ADVERTENCIA CRÍTICA:**
> **NO simplemente reconectar con las mismas claves**. Si el servidor reinició la sala, las claves AES derivadas anteriormente son inválidas. Esto rompe la integridad del estado.

**Flujo CORRECTO:**
```typescript
private async handleReconnection() {
  console.log(`Intento de reconexión ${this.reconnectAttempts + 1}/5`);
  
  // 1. Destruir claves actuales
  this.crypto.destroy();
  this.messageQueue = [];
  
  // 2. Backoff exponencial
  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
  await this.sleep(delay);
  
  // 3. Generar NUEVAS claves ECDH
  await this.crypto.generateKeyPair();
  
  // 4. Reconectar WebSocket
  this.ws = new WebSocket(this.url);
  this.setupHandlers();
  
  // 5. Re-hacer handshake completo
  this.ws.onopen = () => {
    console.log('✅ Reconectado. Enviando nuevo handshake...');
    this.sendHandshake();
    this.reconnectAttempts = 0;
  };
  
  // 6. Notificar al usuario
  this.onStatusChange?.('reconnecting');
}
```

**Mostrar indicador visual:**
```typescript
// Mostrar indicador visual al usuario
this.callbacks.onReconnecting?.(this.reconnectAttempts);

// UI: Banner amarillo "Reconectando... (intento 2/5)"
```

---

### 1.2 **Race Condition en `handleChatLogin()`**
**Estado:** ⚠️ Bug existente  
**Prioridad:** ALTA  
**Archivo:** `client/src/main.ts` línea 75-95

**Problema:**
- La variable `isConnecting` se resetea en catch, pero si falla el `connectToChat()`, el manejo es incompleto
- Si falla la conexión WebSocket (no el try/catch sino dentro de `connect()`), el flag no se resetea

**Solución:**
```typescript
// Asegurar que SIEMPRE se resetee isConnecting
- Usar finally block
- Manejar errores de conexión WS con callback onError
```

---

### 1.3 **Falta Validación de Claves Públicas**
**Estado:** ❌ Falta validar  
**Prioridad:** ALTA  
**Archivo:** `client/src/crypto.ts` línea 61-80

**Problema:**
- Cuando se recibe `theirPublicKeyRaw` de otro usuario, no se valida su tamaño
- Una clave P-256 raw debe ser EXACTAMENTE 65 bytes (0x04 + 32 + 32)
- Si es inválida, el importKey falla con error críptico

**Solución:**
```typescript
// Validar antes de importar:
if (theirPublicKeyRaw.byteLength !== 65) {
  throw new Error("Invalid P-256 public key size");
}
```

---

### 1.4 **Memory Leak en Room Timeout**
**Estado:** ⚠️ Posible leak  
**Prioridad:** MEDIA  
**Archivo:** `server/src/index.ts` línea 222-230

**Problema:**
- Si un cliente se desconecta ANTES del timeout, el timeout sigue activo
- La room puede quedar huérfana en el Map

**Solución:**
```typescript
// En handleDisconnect(), limpiar timeout si la room queda vacía
if (room.clients.size === 0) {
  if (room.timeout) clearTimeout(room.timeout);
  rooms.delete(client.roomId);
}
```

---

### 1.5 **Error Silencioso en Cifrado/Descifrado**
**Estado:** ⚠️ Usuario no se entera  
**Prioridad:** MEDIA  
**Archivo:** `client/src/crypto.ts` líneas 120-150

**Problema:**
- Si `encrypt()` o `decrypt()` falla, se lanza error pero no se notifica a UI
- El usuario no sabe que su mensaje no se envió

**Solución:**
```typescript
// Capturar errores en websocket.ts y llamar onError callback
// Mostrar notificación visual en UI
```

---

## 🟡 2. Bugs de Lógica - Media Prioridad

### 2.1 **Doble Validación de Base64**
**Estado:** ⚠️ Posible fallo  
**Archivo:** `server/src/index.ts` línea 113

**Problema:**
- `isValidBase64()` valida con regex pero no captura padding inválido
- Ejemplo: "A" es 1 byte, pero debería ser múltiplo de 4

**Solución:**
```typescript
// Mejorar regex o usar try/catch con Buffer.from(str, 'base64')
```

---

### 2.2 **Typing Indicator sin Timeout**
**Estado:** ⚠️ UX pobre  
**Archivo:** `client/src/main.ts` línea 195-205

**Problema:**
- Si el usuario detiene de escribir, el indicador "escribiendo..." no desaparece del otro lado
- Timeout de 800ms solo es local

**Solución:**
```typescript
// Enviar typing:false tras 2 segundos de inactividad
// Manejar en server para broadcast
```

---

### 2.3 **No se Limpia CryptoManager al Desconectar**
**Estado:** ⚠️ Posible leak  
**Archivo:** `client/src/main.ts`

**Problema:**
- Al desconectar, `chatClient` no llama a `crypto.destroy()`
- Las claves quedan en memoria

**Solución:**
```typescript
// En onDisconnected callback, llamar chatClient.destroy() explícitamente
```

---

### 2.4 **Falta Timeout en Espera de Peer**
**Estado:** ⚠️ Usuario puede esperar infinitamente  
**Prioridad:** MEDIA

**Problema:**
- Si un usuario crea una room y nadie se une, espera para siempre
- No hay timeout de "esperando usuario..."

**Solución:**
```typescript
// Implementar timeout de 5 minutos
// Mostrar mensaje: "Nadie se unió, puedes cerrar la ventana"
```

---

## 🟢 3. Mejoras de UI - Alta Prioridad

### 3.1 **Mensajes Largos No Se Ajustan Correctamente** ⭐
**Estado:** ❌ Bug visual  
**Prioridad:** ALTA  
**Archivo:** `client/chat.html` línea 103-120

**Problema:**
- Los mensajes largos no tienen `word-wrap` ni `word-break`
- Se desbordan horizontalmente

**Solución:**
```css
.message {
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap; /* Respetar saltos de línea */
}
```

---

### 3.2 **Implementar Menú Contextual (Click Derecho / Long Press)** ⭐⭐⭐
**Estado:** ❌ Falta funcionalidad  
**Prioridad:** MUY ALTA  
**Archivos:** Crear `client/src/contextMenu.ts` + actualizar `protocol.ts`

**Funcionalidad Desktop:**
1. Click derecho sobre mensaje → `event.preventDefault()`
2. Mostrar menú flotante posicionado cerca del cursor
3. Cerrar al hacer click fuera o presionar Escape

**Funcionalidad Móvil:**
1. Detectar `touchstart` y iniciar timer de 800ms
2. Si `touchend` antes de 800ms → no hacer nada
3. Si llega a 800ms → vibrar (`navigator.vibrate([50])`) y mostrar menú
4. Prevenir scroll accidental con `touch-action: none` temporal

**Opciones del menú:**
1. **🎭 Reaccionar**: 👍 ❤️ 😂 😮 😢 (emoji grid horizontal)
2. **↩️ Responder**: Quote del mensaje original
3. **📋 Copiar texto**: `navigator.clipboard.writeText()`
4. **🗑️ Eliminar**: Solo si `message.isMe === true`

**Implementación técnica:**
```typescript
// client/src/contextMenu.ts
export class MessageContextMenu {
  private menu: HTMLElement;
  private currentMessageId: string | null = null;
  
  constructor(private onAction: (action: MenuAction) => void) {
    this.createMenuElement();
    this.attachGlobalListeners();
  }
  
  show(messageElement: HTMLElement, messageId: string, isOwnMessage: boolean) {
    // Posicionar menú, filtrar opciones según isOwnMessage
  }
  
  hide() {
    this.menu.classList.remove('visible');
  }
}

// CSS para el Header del chat, encima del área de mensajes

**Diseño UI:**
```html
<!-- Nueva sección en chat.html -->
<div class="chat-info-bar">
  <div class="user-info">
    <label class="info-label">👤 Tu nombre:</label>
    <input 
      type="text" 
      id="displayNameInput" 
      class="inline-input"
      placeholder="Anónimo"
      maxlength="20"
      spellcheck="false"
    />
  </div>
  <div class="room-info">
    <label class="info-label">🆔 Room:</label>
    <span id="roomIdDisplay" class="room-id-text">abc123xyz</span>
    <button id="copyRoomBtn" class="icon-btn-small" title="Copiar Room ID">📋</button>
  </div>
</div>
```

**CSS:**
```css
.chat-info-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 1.5rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  gap: 1rem;
  flex-wrap: wrap;
}

.user-info, .room-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.info-label {
  font-size: 0.85rem;
  opacity: 0.8;
  font-weight: 500;
}

.inline-input {
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-primary);
  font-family: 'Fira Code', monospace;
  font-size: 0.9rem;
  width: 150px;
  transition: border-color 0.2s;
}

.inline-input:focus {
  outline: none;
  border-color: var(--accent);
}

.room-id-text {
  font-family: 'Fira Code', monospace;
  background: var(--card-bg);
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  font-size: 0.85rem;
  user-select: all;
}

.icon-btn-small {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.3rem;
  border-radius: 6px;
  transition: background 0.2s;
}

.icon-btn-small:hover {
  background: var(--border-color);
}
```

**Funcionalidad:**
```typescript
// client/src/userManager.ts
export class UserManager {
  private displayName: string = '';
  private storageKey = 'windchat_display_name';
  
  constructor() {
    this.loadFromStorage();
  }
  
  private loadFromStorage() {
    this.displayName = localStorage.getItem(this.storageKey) || 'Anónimo';
  }
  
  getDisplayName(): string {
    return this.displayName;
  }
  
  setDisplayName(name: string) {
    const sanitized = name.trim().substring(0, 20) || 'Anónimo';
    this.displayName = sanitized;
    localStorage.setItem(this.storageKey, sanitized);
  }
}

// En main.ts, al conectar:
const userManager = new UserManager();
const displayName = userManager.getDisplayName();

// Event listener para el input
displayNameInput.addEventListener('blur', () => {
  userManager.setDisplayName(displayNameInput.value);
});

displayNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    displayNameInput.blur();
  }
});
```

**Protocolo extendido:**
```typescript
// shared/protocol.ts
interface HandshakeMessage {
  type: "join";
  roomId: string;
  publicKey: string;
  displayName: string;    // NUEVO - obligatorio (mínimo "Anónimo")
}

interface PeerJoinedMessage {
  type: "peer_joined";
  theirPublicKey: string;
  theirDisplayName: string;  // NUEVO
}

// MessagePayload debe incluir displayName
interface MessagePayload {
  id: string;
  text: string;
  timestamp: number;
  displayName: string;    // NUEVO - nombre del remitente
}
```

**Visualización en mensajes:**
```html
<!-- Mensaje del otro usuario -->
<div class="message other">
  <span class="message-sender">Juan</span>
  <span class="message-text">Hola mundo</span>
  <span class="timestamp">10:30</span>
</div>

<!-- Mensaje propio (opcional mostrar nombre) -->
<div class="message me">
  <span class="message-text">Hola</span>
  <span class="timestamp">10:31</span>
</div>
```

**CSS para nombre del remitente:**
```css
.message-sender {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.7;
  margin-bottom: 0.2rem;
}

.message.me .message-sender {
  display: none; /* No mostrar en mensajes propios */

.emoji-grid {
  display: flex;
  gap: 0.3rem;
}
```

**Protocolo extendido:**
```typescript
// shared/protocol.ts
interface ReactionMessage {
  type: "reaction";
  messageId: string;      // UUID del mensaje original
  emoji: string;          // "👍" | "❤️" | "😂" | "😮" | "😢"
  timestamp: number;
}

interface ReplyMessage {
  type: "reply";
  replyTo: string;        // UUID del mensaje citado
  replyText: string;      // Snippet del mensaje original (primeros 50 chars)
  text: string;           // Nuevo mensaje
  timestamp: number;
}

interface DeleteMessage {
  type: "delete";
  messageId: string;      // UUID del mensaje a borrar
  timestamp: number;
}

// Añadir UUID a MessagePayload
interface MessagePayload {
  id: string;             // NUEVO: UUID generado con crypto.randomUUID()
  text: string;
  timestamp: number;
  senderId?: string;      // NUEVO: Para distinguir mensajes propios
  replyTo?: {             // NUEVO: Si es una respuesta
    id: string;
    text: string;
    sender: string;
  };
}
```

**Visualización de reacciones:**
```html
<!-- En cada mensaje -->
<div class="message me">
  <span class="message-text">Hola mundo</span>
  <div class="message-reactions">
    <span class="reaction">👍 2</span>
    <span class="reaction">❤️ 1</span>
  </div>
  <span class="timestamp">10:30</span>
</div>
```

**Visualización de respuesta:**
```html
<div class="message other">
  <div class="reply-preview">
    <span class="reply-sender">Juan:</span>
    <span class="reply-text">Hola mundo</span>
  </div>
  <span class="message-text">¡Hola! ¿Cómo estás?</span>
  <span class="timestamp">10:32</span>
</div>
```

---

### 3.3 **Campo de Nombre de Usuario** ⭐⭐
**Estado:** ❌ Falta funcionalidad  
**Prioridad:** ALTA  
**Ubicación:** Encima del RoomID

**Diseño:**
```
┌─────────────────────────────────┐
│ WindChat               Tema 🌙  │
├─────────────────────────────────┤
│ 👤 Nombre: [__________] ✏️      │
│ 🆔 Room: abc123xyz     📋       │
├─────────────────────────────────┤
│ [Mensajes]                       │
```

**Funcionalidad:**
- Input editable inline
- Guardar en localStorage
- Enviar en handshake extendido
- Mostrar encima de cada mensaje: **"Juan: Hola!"**

**Protocolo extendido:**
```typescript
interface HandshakeMessage {
  type: "join";
  roomId: string;
  publicKey: string;
  displayName?: string; // NUEVO
}
```

---

### 3.4 **Botón de Enviar Más Grande** ⭐
**Estado:** ⚠️ UX mejorable  
**Prioridad:** MEDIA  
**Archivo:** `client/chat.html` línea 145-150

**Cambio:**
```css
.icon-btn {
  font-size: 1.5rem; /* Era 1.2rem */
  padding: 0.5rem;
  background: var(--accent);
  border-radius: 50%;
  color: white;
  transition: transform 0.2s;
}

.icon-btn:hover {
  transform: scale(1.1);
}
```

---

### 3.5 **Chat en Pantalla Completa** ⭐⭐
**Estado:** ⚠️ Espacio desperdiciado  
**Prioridad:** ALTA  
**Archivo:** `client/chat.html` línea 56-59

**Problema:**
- `.app` tiene `max-width: 1100px` y queda centrado
- Fondo visible a los lados → desperdicia espacio

**Solución:**
```css
.app {
  width: 100%;
  max-width: 100%; /* Eliminar restricción */
  height: 100vh;
}

/* Para desktop, mantener legible con padding interno */
@media (min-width: 768px) {
  .messages {
    max-width: 900px;
    margin: 0 auto;
  }
}
```

---

### 3.6 **Indicador Visual de Mensaje Propio vs. Ajeno**
**Estado:** ⚠️ Mejorable  
**Prioridad:** BAJA

**Mejora:**
- Agregar checkmarks ✓✓ en mensajes propios
- Esquinas redondeadas asimétricas (como WhatsApp)

```css
.message.me {
  border-bottom-right-radius: 4px;
}

.message.other {
  border-bottom-left-radius: 4px;
}
```

---

## 🔔 4. Funcionalidades de Notificaciones

### 4.1 **Notificaciones del Navegador** ⭐⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** ALTA  
**Archivo:** Crear `client/src/notifications.ts`

**Funcionalidad:**
- Solicitar permiso al usuario: `Notification.requestPermission()`
- Mostrar notificación cuando llega mensaje y la pestaña no está activa
- Incluir snippet del mensaje (primeros 50 chars)
- Click en notificación → enfocar la pestaña

**Implementación:**
```typescript
// client/src/notifications.ts
export class NotificationManager {
  private enabled: boolean = false;
  
  async requestPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
      console.warn("Browser doesn't support notifications");
      return false;
    }
    
    if (Notification.permission === "granted") {
      this.enabled = true;
      return true;
    }
    
    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      this.enabled = permission === "granted";
      return this.enabled;
    }
    
    return false;
  }
  
  showMessageNotification(senderName: string, messagePreview: string) {
    if (!this.enabled || document.visibilityState === "visible") {
      return; // No mostrar si la pestaña está activa
    }
    
    const notification = new Notification(`💬 ${senderName}`, {
      body: messagePreview.substring(0, 50) + (messagePreview.length > 50 ? "..." : ""),
      icon: "/favicon.ico",
      badge: "/badge.png",
      tag: "windchat-message", // Reemplaza notificaciones anteriores
      requireInteraction: false,
      silent: false
    });
    
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    
    // Auto-cerrar después de 5 segundos
    setTimeout(() => notification.close(), 5000);
  }
}

// En main.ts
const notificationManager = new NotificationManager();

// Mostrar botón de activar notificaciones
const enableNotifBtn = document.getElementById('enableNotifications');
enableNotifBtn?.addEventListener('click', async () => {
  const granted = await notificationManager.requestPermission();
  if (granted) {
    showToast('✅ Notificaciones activadas');
  } else {
    showToast('❌ Notificaciones denegadas');
  }
});

// Al recibir mensaje
onMessageReceived: (text, timestamp, displayName) => {
  renderMessage({ text, timestamp, displayName, isMe: false });
  notificationManager.showMessageNotification(displayName, text);
  soundManager.playReceiveSound(); // Ver 4.2
}
```

**UI para activar:**
```html
<!-- Añadir en chat-info-bar -->
<button id="enableNotifications" class="icon-btn-small" title="Activar notificaciones">
  🔔
</button>
```

---

### 4.2 **Sonidos de Notificación** ⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** MEDIA  
**Archivo:** Crear `client/src/soundManager.ts` + añadir archivos `.mp3`

**Funcionalidad:**
- Sonido al enviar mensaje (click suave)
- Sonido al recibir mensaje (notificación)
- Opción de silenciar en UI
- Guardar preferencia en localStorage

**⚠️ IMPORTANTE - Bloqueo de AudioContext:**
> Los navegadores modernos bloquean `play()` hasta que el usuario interactúe con la página. Debes inicializar AudioContext en el **primer click/tap del usuario**.

**Implementación CORRECTA:**
```typescript
// client/src/soundManager.ts
export class SoundManager {
  private enabled: boolean = true;
  private audioContext: AudioContext | null = null;
  private isInitialized: boolean = false;
  private sendSound: HTMLAudioElement;
  private receiveSound: HTMLAudioElement;
  
  constructor() {
    this.loadPreference();
    this.sendSound = new Audio('/sounds/send.mp3');
    this.receiveSound = new Audio('/sounds/receive.mp3');
    
    // Volumen bajo (0.0 - 1.0)
    this.sendSound.volume = 0.3;
    this.receiveSound.volume = 0.4;
  }
  
  /**
   * ⚠️ Debe llamarse en el PRIMER click del usuario
   * De lo contrario, los navegadores bloquean el audio
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume(); // Necesario en iOS
      this.isInitialized = true;
      console.log('✅ SoundManager inicializado');
    } catch (err) {
      console.error('❌ Error inicializando audio:', err);
    }
  }
  
  private loadPreference() {
    const saved = localStorage.getItem('windchat_sounds_enabled');
    this.enabled = saved !== 'false'; // Por defecto activado
  }
  
  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('windchat_sounds_enabled', String(this.enabled));
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  playSendSound() {
    if (!this.isInitialized) {
      console.warn('⚠️ Audio no inicializado. Usuario debe hacer click primero.');
      return;
    }
    
    if (this.enabled) {
      this.sendSound.currentTime = 0;
      this.sendSound.play().catch(e => console.warn('Sound play failed:', e));
    }
  }
  
  playReceiveSound() {
    if (!this.isInitialized) return;
    
    if (this.enabled) {
      this.receiveSound.currentTime = 0;
      this.receiveSound.play().catch(e => console.warn('Sound play failed:', e));
    }
  }
}

// En main.ts
const soundManager = new SoundManager();

// ⚠️ Inicializar en el PRIMER click del usuario
document.body.addEventListener('click', () => {
  soundManager.initialize();
}, { once: true });

// Mostrar banner temporal
const audioPrompt = document.createElement('div');
audioPrompt.className = 'audio-prompt-banner';
audioPrompt.innerHTML = '⚠️ Toca en cualquier lugar para habilitar sonidos';
audioPrompt.addEventListener('click', () => {
  soundManager.initialize();
  audioPrompt.remove();
});
document.body.appendChild(audioPrompt);

// Botón de toggle
soundToggleBtn.addEventListener('click', () => {
  soundManager.toggle();
  updateSoundIcon();
});

// Al enviar mensaje
sendButton.addEventListener('click', () => {
  sendMessage();
  soundManager.playSendSound();
});

// Al recibir mensaje
onMessageReceived: (text, timestamp, displayName) => {
  renderMessage(...);
  soundManager.playReceiveSound();
}
```

**Archivos de sonido necesarios:**
- `public/sounds/send.mp3` - Sonido corto "whoosh" o "pop" (< 0.2s)
- `public/sounds/receive.mp3` - Sonido notification (< 0.3s)

**Alternativa sin archivos:** Usar Web Audio API para generar tonos
```typescript
function playTone(frequency: number, duration: number) {
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

// Enviar: tono ascendente
playSendSound() {
  playTone(800, 0.1);
}

// Recibir: tono descendente
playReceiveSound() {
  playTone(600, 0.15);
}
```

**UI para toggle:**
```html
<button id="soundToggle" class="icon-btn-small">
  <span id="soundIcon">🔊</span>
</button>
```

---

### 4.3 **Indicador Visual de Conexión** ⭐
**Estado:** ⚠️ Muy básico  
**Prioridad:** ALTA  
**Archivo:** `client/chat.html` + `main.ts`

**Problema actual:**
- No hay indicador visual persistente del estado de conexión
- El usuario no sabe si está conectado, desconectado, o reconectando

**Solución:**
```html
<!-- Añadir en header -->
<div class="connection-status" id="connectionStatus">
  <span class="status-dot"></span>
  <span class="status-text">Conectado</span>
</div>
```

**CSS:**
```css
.connection-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  padding: 0.4rem 0.8rem;
  border-radius: 20px;
  background: var(--card-bg);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-color);
  animation: pulse 2s infinite;
}

.status-dot.connected { --status-color: #10b981; }
.status-dot.connecting { --status-color: #f59e0b; }
.status-dot.disconnected { --status-color: #ef4444; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.connection-status.connected { background: rgba(16, 185, 129, 0.1); }
.connection-status.connecting { background: rgba(245, 158, 11, 0.1); }
.connection-status.disconnected { background: rgba(239, 68, 68, 0.1); }
```

**Actualización dinámica:**
```typescript
function updateConnectionStatus(status: 'connected' | 'connecting' | 'disconnected') {
  const statusElement = document.getElementById('connectionStatus');
  const dot = statusElement.querySelector('.status-dot');
  const text = statusElement.querySelector('.status-text');
  
  // Remover clases anteriores
  statusElement.classList.remove('connected', 'connecting', 'disconnected');
  dot.classList.remove('connected', 'connecting', 'disconnected');
  
  // Añadir nueva clase
  statusElement.classList.add(status);
  dot.classList.add(status);
  
  // Actualizar texto
  const labels = {
    connected: t('connected'),       // "Conectado" / "Connected"
    connecting: t('reconnecting'),   // "Reconectando..." / "Reconnecting..."
    disconnected: t('disconnected')  // "Desconectado" / "Disconnected"
  };
  text.textContent = labels[status];
}

// En callbacks de WebSocket
chatClient = new ChatClient({
  onConnected: () => updateConnectionStatus('connected'),
  onDisconnected: () => updateConnectionStatus('disconnected'),
  onReconnecting: () => updateConnectionStatus('connecting') // NUEVO callback
});
```

---

### 4.4 **Badge de Mensajes No Leídos** ⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** MEDIA  
**Archivo:** `client/src/main.ts`

**Funcionalidad:**
- Contar mensajes no leídos cuando la pestaña no está activa
- Mostrar en título: `(3) WindChat`
- Mostrar badge en favicon (opcional, más complejo)
- Resetear al volver a la pestaña

**Implementación:**
```typescript
class UnreadCounter {
  private count: number = 0;
  private originalTitle: string = document.title;
  
  increment() {
    if (document.visibilityState !== 'visible') {
      this.count++;
      this.updateTitle();
    }
  }
  
  reset() {
    this.count = 0;
    this.updateTitle();
  }
  
  private updateTitle() {
    if (this.count > 0) {
      document.title = `(${this.count}) ${this.originalTitle}`;
    } else {
      document.title = this.originalTitle;
    }
  }
}

const unreadCounter = new UnreadCounter();

// Al recibir mensaje
onMessageReceived: (text, timestamp, displayName) => {
  renderMessage(...);
  unreadCounter.increment();
}

// Al volver a la pestaña
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    unreadCounter.reset();
  }
});
```

---

## 🌍 5. Internacionalización (i18n)

### 5.1 **Completar Todas las Traducciones** ⭐⭐
**Estado:** ⚠️ Parcialmente implementado  
**Prioridad:** ALTA  
**Archivo:** `client/src/i18n.ts`

**Traducciones faltantes a agregar:**
```typescript
const translations: Record<Lang, Record<string, string>> = {
  es: {
    // Existentes... (mantener los actuales)
    
    // Context Menu (NUEVO)
    contextMenuReact: 'Reaccionar',
    contextMenuReply: 'Responder',
    contextMenuCopy: 'Copiar texto',
    contextMenuDelete: 'Eliminar',
    
    // User Settings (NUEVO)
    displayNameLabel: '👤 Tu nombre',
    displayNamePlaceholder: 'Anónimo',
    roomIdLabel: '🆔 Room',
    roomIdCopied: '✅ Room ID copiado',
    
    // Connection Status (NUEVO)
    statusConnected: 'Conectado',
    statusConnecting: 'Conectando...',
    statusReconnecting: '🔄 Reconectando...',
    statusDisconnected: 'Desconectado',
    statusWaitingPeer: 'Esperando al otro usuario...',
    
    // Notifications (NUEVO)
    notifPermissionRequest: '🔔 Activar notificaciones de escritorio',
    notifEnabled: '✅ Notificaciones activadas',
    notifDenied: '❌ Notificaciones denegadas',
    newMessage: 'Nuevo mensaje',
    
    // Errors (NUEVO)
    errorConnection: '❌ Error de conexión',
    errorEncryption: '❌ Error de cifrado',
    errorMessageTooLong: '❌ Mensaje demasiado largo (máx 10KB)',
    errorRoomFull: '❌ Sala llena (máximo 2 usuarios)',
    errorInvalidRoom: '❌ Room ID inválido',
    
    // Actions (NUEVO)
    actionSend: 'Enviar',
    actionCopy: 'Copiar',
    actionDelete: 'Eliminar',
    actionCancel: 'Cancelar',
    actionRetry: 'Reintentar',
    
    // Reply/Quote (NUEVO)
    replyingTo: 'Respondiendo a',
    quotedMessage: 'Mensaje citado',
    
    // Settings (NUEVO)
    settingsTitle: 'Configuración',
    settingsSounds: 'Sonidos',
    settingsNotifications: 'Notificaciones',
    settingsTheme: 'Tema',
    settingsLanguage: 'Idioma',
    
    // Time formats (NUEVO)
    justNow: 'Ahora',
    minuteAgo: 'Hace 1 minuto',
    minutesAgo: 'Hace {n} minutos',
    hourAgo: 'Hace 1 hora',
    hoursAgo: 'Hace {n} horas',
    yesterday: 'Ayer',
    daysAgo: 'Hace {n} días',
  },
  en: {
    // ... (traducir todo al inglés)
    contextMenuReact: 'React',
    contextMenuReply: 'Reply',
    contextMenuCopy: 'Copy text',
    contextMenuDelete: 'Delete',
    
    displayNameLabel: '👤 Your name',
    displayNamePlaceholder: 'Anonymous',
    // ... etc
  }
};
```

**Mejorar función `t()` para soportar interpolación:**
```typescript
export function t(key: string, params?: Record<string, any>): string {
  const lang = detectLanguage();
  let text = translations[lang][key] || translations.en[key] || key;
  
  // Interpolación de parámetros: "Hace {n} minutos" → "Hace 5 minutos"
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
  }
  
  return text;
}

// Uso:
t('minutesAgo', { n: 5 }) // "Hace 5 minutos"
```

---

### 5.2 **Selector de Idioma en UI**
**Estado:** ❌ Falta implementar  
**Prioridad:** ALTA  
**Ubicación:** Header, al lado del botón de tema

**Implementación:**
```html
<!-- En chat-header -->
<div class="header-controls">
  <select id="langSelector" class="lang-selector">
    <option value="es">🇪🇸 ES</option>
    <option value="en">🇬🇧 EN</option>
  </select>
  <button class="theme-toggle">🌙</button>
</div>
```

**CSS:**
```css
.header-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lang-selector {
  padding: 0.5rem 0.8rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-primary);
  font-family: 'Fira Code', monospace;
  cursor: pointer;
  font-size: 0.9rem;
}

.lang-selector:focus {
  outline: none;
  border-color: var(--accent);
}
```

**JavaScript:**
```typescript
// Modificar i18n.ts para permitir cambio manual
let currentLang: Lang;

export function setLanguage(lang: Lang) {
  currentLang = lang;
  localStorage.setItem('windchat_language', lang);
  reApplyTranslations(); // Actualizar todos los elementos data-i18n
}

export function getLanguage(): Lang {
  const saved = localStorage.getItem('windchat_language') as Lang;
  if (saved && ['es', 'en'].includes(saved)) {
    return saved;
  }
  return detectLanguage();
}

function reApplyTranslations() {
  // Actualizar todos los elementos con data-i18n="key"
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!;
    const element = el as HTMLElement;
    
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).placeholder) {
      (el as HTMLInputElement).placeholder = t(key);
    } else {
      element.textContent = t(key);
    }
  });
}

// En main.ts
langSelector.value = getLanguage();
langSelector.addEventListener('change', () => {
  setLanguage(langSelector.value as Lang);
  showToast(t('languageChanged'));
});
```

**Marcar elementos traducibles en HTML:**
```html
<input 
  type="text" 
  data-i18n="messageInputPlaceholder"
  placeholder="Escribe un mensaje..." 
/>
```

---

## 🔒 6. Mejoras de Seguridad

### 5.1 **Implementar Content Security Policy (CSP)**
**Estado:** ❌ Sin CSP  
**Prioridad:** ALTA

**Headers a agregar en servidor:**
```http
Content-Security-Policy: 
  default-src 'self'; 
  script-src 'self' 'unsafe-inline'; 
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  connect-src 'self' ws: wss:;
```

---

### 5.2 **Rate Limiting en Servidor**
**Estado:** ❌ Sin límites  
**Prioridad:** MEDIA

**Problema:**
- Un cliente malicioso puede enviar 1000 mensajes/segundo
- Puede colapsar el servidor

**Solución:**
```typescript
// Implementar rate limit: máx 10 mensajes/segundo por cliente
const messageTimestamps = new Map<WebSocket, number[]>();
```

---

### 5.3 **Validar Tamaño de Room ID**
**Estado:** ⚠️ Validación débil  
**Prioridad:** BAJA

**Mejora:**
```typescript
// Rechazar room IDs sospechosos
if (roomId.length < 4 || roomId.length > 128 || /[^\w-]/.test(roomId)) {
  ws.close(1008, "Invalid room ID format");
}
```

---

## 🎨 7. Mejoras de UX/Usabilidad

### 6.1 **Scroll Automático Inteligente**
**Estado:** ⚠️ Mejorable  
**Prioridad:** MEDIA

**Problema:**
- Si el usuario scrollea hacia arriba para leer, un nuevo mensaje le hace scroll forzoso

**Solución:**
```typescript
// Solo auto-scroll si el usuario está al final
function shouldAutoScroll() {
  const threshold = 50; // px
  return (
    messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold
  );
}
```

---

### 6.2 **Indicador de "Nuevo Mensaje"**
**Estado:** ❌ Falta  
**Prioridad:** BAJA

**Funcionalidad:**
- Si el usuario no está al final del chat, mostrar badge: **"↓ Nuevos mensajes (2)"**

---

### 6.3 **Confirmación al Cerrar Pestaña**
**Estado:** ❌ Falta  
**Prioridad:** MEDIA

**Código:**
```typescript
window.addEventListener('beforeunload', (e) => {
  if (chatClient?.isConnected()) {
    e.preventDefault();
    e.returnValue = '¿Seguro que quieres salir del chat?';
  }
});
```

---

### 6.4 **Feedback Visual al Copiar Room ID**
**Estado:** ⚠️ Sin feedback  
**Prioridad:** BAJA

**Mejora:**
```typescript
// Mostrar toast temporal: "✅ Room ID copiado"
async function copyRoomId() {
  await copyToClipboard(currentRoomId);
  showToast('✅ Room ID copiado');
}
```

---

### 6.5 **Historial de Mensajes (Opcional)**
**Estado:** ❌ No existe  
**Prioridad:** BAJA

**Consideración:**
- Guardar mensajes en localStorage (cifrados)
- Permitir exportar chat como .txt

---

## 🚀 8. Funcionalidades Avanzadas

### 8.1 **Timestamps Humanizados** ⭐
**Estado:** ⚠️ Solo muestra hora  
**Prioridad:** MEDIA  
**Archivo:** `client/src/ui.ts` o crear `utils/time.ts`

**Problema:**
- Actualmente solo muestra "10:30" 
- No se distingue entre hoy, ayer, o hace días

**Solución:**
```typescript
// client/src/utils/time.ts
export function formatMessageTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 30) {
    return t('justNow'); // "Ahora"
  } else if (minutes < 1) {
    return t('secondsAgo', { n: seconds });
  } else if (minutes < 60) {
    return minutes === 1 ? t('minuteAgo') : t('minutesAgo', { n: minutes });
  } else if (hours < 24) {
    return hours === 1 ? t('hourAgo') : t('hoursAgo', { n: hours });
  } else if (days === 1) {
    return t('yesterday');
  } else if (days < 7) {
    return t('daysAgo', { n: days });
  } else {
    // Fecha completa
    return new Date(timestamp).toLocaleDateString();
  }
}

export function formatDetailedTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
```

**Uso en UI:**
```typescript
// Mostrar tiempo relativo
timeSpan.textContent = formatMessageTime(message.timestamp);

// Tooltip con tiempo exacto
timeSpan.title = formatDetailedTime(message.timestamp);
```

**Actualización periódica:**
```typescript
// Actualizar cada minuto para mantener precisión
setInterval(() => {
  document.querySelectorAll('.timestamp').forEach(el => {
    const timestamp = parseInt(el.getAttribute('data-timestamp')!);
    el.textContent = formatMessageTime(timestamp);
  });
}, 60000); // 1 minuto
```

---

### 8.2 **Emoji Picker** ⭐⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** MEDIA  
**Archivo:** Crear `client/src/emojiPicker.ts`

**Funcionalidad:**
- Botón 😊 al lado del input de mensaje
- Mostrar panel con emojis populares
- Click en emoji → insertar en input en posición del cursor

**Implementación simple (sin librería):**
```typescript
// client/src/emojiPicker.ts
const POPULAR_EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', 
  '🤔', '😮', '😢', '😭', '😡', '🤯', '😴', '🙄',
  '👍', '👎', '🙏', '👏', '💪', '❤️', '🔥', '✨',
  '🎉', '🎊', '💯', '✅', '❌', '⭐', '🌟', '💡'
];

export class EmojiPicker {
  private panel: HTMLElement;
  private isVisible: boolean = false;
  
  constructor(private inputElement: HTMLInputElement) {
    this.createPanel();
  }
  
  private createPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'emoji-picker-panel';
    
    POPULAR_EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.onclick = () => this.insertEmoji(emoji);
      this.panel.appendChild(btn);
    });
    
    document.body.appendChild(this.panel);
  }
  
  toggle() {
    this.isVisible = !this.isVisible;
    this.panel.classList.toggle('visible', this.isVisible);
  }
  
  hide() {
    this.isVisible = false;
    this.panel.classList.remove('visible');
  }
  
  private insertEmoji(emoji: string) {
    const start = this.inputElement.selectionStart || 0;
    const end = this.inputElement.selectionEnd || 0;
    const text = this.inputElement.value;
    
    this.inputElement.value = text.slice(0, start) + emoji + text.slice(end);
    this.inputElement.selectionStart = this.inputElement.selectionEnd = start + emoji.length;
    this.inputElement.focus();
    this.hide();
  }
}
```

**CSS:**
```css
.emoji-picker-panel {
  position: fixed;
  bottom: 80px;
  right: 20px;
  background: var(--card-bg);
  border-radius: 12px;
  padding: 0.8rem;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0.3rem;
  opacity: 0;
  transform: scale(0.9) translateY(10px);
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 1000;
}

.emoji-picker-panel.visible {
  opacity: 1;
  transform: scale(1) translateY(0);
  pointer-events: all;
}

.emoji-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 6px;
  transition: background 0.2s, transform 0.1s;
}

.emoji-btn:hover {
  background: var(--border-color);
  transform: scale(1.2);
}
```

**Integración:**
```html
<!-- En input-area -->
<div class="input-area">
  <button id="emojiPickerBtn" class="icon-btn-small">😊</button>
  <input type="text" id="messageInput" />
  <button id="sendButton" class="icon-btn">➤</button>
</div>
```

---

### 8.3 **Copiar Mensaje Individual** ⭐
**Estado:** ❌ Falta (solo en menú contextual)  
**Prioridad:** BAJA  
**Archivo:** `client/src/contextMenu.ts`

**Funcionalidad:**
- En menú contextual, opción "📋 Copiar texto"
- Copiar solo el texto del mensaje (sin timestamp, nombre, etc.)
- Mostrar feedback visual "✅ Copiado"

```typescript
async function copyMessageText(messageElement: HTMLElement) {
  const textSpan = messageElement.querySelector('.message-text');
  if (!textSpan) return;
  
  try {
    await navigator.clipboard.writeText(textSpan.textContent || '');
    showToast(t('textCopied'));
  } catch (err) {
    console.error('Copy failed:', err);
    showToast(t('copyFailed'));
  }
}
```

---

### 8.4 **Exportar Chat** ⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** BAJA  
**Archivo:** Crear `client/src/export.ts`

**Funcionalidad:**
- Botón en header: "💾 Exportar"
- Formatos: TXT, JSON, HTML
- Incluir todos los mensajes visibles con timestamps

**Implementación:**
```typescript
// client/src/export.ts
interface ExportMessage {
  displayName: string;
  text: string;
  timestamp: number;
  isMe: boolean;
}

export function exportToTXT(messages: ExportMessage[]): string {
  return messages.map(m => {
    const time = new Date(m.timestamp).toLocaleString();
    return `[${time}] ${m.displayName}: ${m.text}`;
  }).join('\n');
}

export function exportToJSON(messages: ExportMessage[]): string {
  return JSON.stringify(messages, null, 2);
}

export function exportToHTML(messages: ExportMessage[]): string {
  const html = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleString();
    const sender = m.isMe ? 'Tú' : m.displayName;
    return `
      <div class="message ${m.isMe ? 'me' : 'other'}">
        <strong>${sender}</strong> <em>${time}</em><br>
        ${escapeHTML(m.text)}
      </div>
    `;
  }).join('\n');
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WindChat Export</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { margin: 10px 0; padding: 10px; border-radius: 8px; }
    .message.me { background: #38bdf8; color: white; }
    .message.other { background: #e5e7eb; }
  </style>
</head>
<body>
  <h1>WindChat Conversation</h1>
  ${html}
</body>
</html>`;
}

function escapeHTML(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Uso
exportBtn.addEventListener('click', () => {
  const format = prompt('Formato (txt/json/html):', 'txt');
  const timestamp = Date.now();
  
  switch(format) {
    case 'txt':
      downloadFile(exportToTXT(messages), `windchat-${timestamp}.txt`, 'text/plain');
      break;
    case 'json':
      downloadFile(exportToJSON(messages), `windchat-${timestamp}.json`, 'application/json');
      break;
    case 'html':
      downloadFile(exportToHTML(messages), `windchat-${timestamp}.html`, 'text/html');
      break;
  }
});
```

---

### 8.5 **QR Code para Room ID** ⭐⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** MEDIA  
**Archivo:** Usar librería `qrcode` (npm)

**Funcionalidad:**
- Botón "QR" al lado del Room ID
- Generar QR code con la URL completa: `https://windchat.app/chat?room=abc123`
- Modal con QR para escanear desde móvil

**Implementación:**
```typescript
// Instalar: npm install qrcode @types/qrcode

import QRCode from 'qrcode';

async function showQRModal(roomId: string) {
  const url = `${window.location.origin}/chat.html?room=${roomId}`;
  
  const modal = document.createElement('div');
  modal.className = 'qr-modal';
  modal.innerHTML = `
    <div class="qr-modal-content">
      <h3>Escanea para unirte</h3>
      <canvas id="qrCanvas"></canvas>
      <p>${roomId}</p>
      <button id="closeQR">Cerrar</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const canvas = document.getElementById('qrCanvas') as HTMLCanvasElement;
  await QRCode.toCanvas(canvas, url, {
    width: 250,
    margin: 2,
    color: {
      dark: '#0a192f',
      light: '#ffffff'
    }
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal || (e.target as HTMLElement).id === 'closeQR') {
      modal.remove();
    }
  });
}
```

**CSS:**
```css
.qr-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.qr-modal-content {
  background: var(--card-bg);
  padding: 2rem;
  border-radius: 16px;
  text-align: center;
}
```

---

### 8.6 **PWA Support (Progressive Web App)** ⭐⭐⭐
**Estado:** ❌ Falta implementar  
**Prioridad:** ALTA (para móviles)  
**Archivos:** `manifest.json` + `service-worker.js`

**⚠️ REQUISITO CRÍTICO: HTTPS OBLIGATORIO**
> Service Workers **NO funcionan con HTTP** (excepto en `localhost`). Necesitas HTTPS en producción.

**Opciones de despliegue:**

| Entorno | HTTPS | Service Worker | Recomendación |
|---------|-------|----------------|---------------|
| `localhost` | ❌ | ✅ Funciona | Desarrollo local OK |
| `192.168.x.x` (LAN) | ❌ | ❌ No funciona | Usar mkcert para SSL local |
| Cloudflare Quick Tunnel | ✅ | ⚠️ Limitado | URL cambia cada vez |
| Vercel/Netlify | ✅ | ✅ Funciona | **RECOMENDADO** |
| Cloudflare Pages | ✅ | ✅ Funciona | **RECOMENDADO** |
| Dominio propio + Let's Encrypt | ✅ | ✅ Funciona | Producción |

**Limitación de Cloudflare Tunnel:**
```bash
# Quick Tunnel genera URL aleatoria cada vez
cloudflared tunnel --url http://localhost:5173
# Output: https://random-words-1234.trycloudflare.com

# Problema: Service Worker se invalida al cambiar dominio
# El scope del SW queda vinculado al dominio anterior
```

**Solución para desarrollo (HTTPS local):**
```bash
# Opción 1: mkcert (certificado local confiable)
npm install -g mkcert
mkcert -install
mkcert localhost 192.168.1.100

# Genera: localhost.pem y localhost-key.pem
```

```typescript
// vite.config.ts
import fs from 'fs';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    https: {
      key: fs.readFileSync('./localhost-key.pem'),
      cert: fs.readFileSync('./localhost.pem')
    },
    host: '0.0.0.0' // Acceder desde LAN
  }
});

// Ahora: https://localhost:5173 (✅ Service Worker funciona)
```

**Solución para producción:**
```bash
# Opción 1: Vercel (GRATIS)
npm i -g vercel
vercel deploy
# HTTPS automático: https://windchat.vercel.app

# Opción 2: Cloudflare Pages
npm run build
wrangler pages publish dist
# HTTPS automático: https://windchat.pages.dev

# Opción 3: Nginx + Let's Encrypt
sudo certbot --nginx -d windchat.tudominio.com
```

**Verificación en código:**
```javascript
// Registrar Service Worker solo si HTTPS está disponible
if ('serviceWorker' in navigator) {
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
  
  if (isSecure) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('✅ SW registrado'));
  } else {
    console.warn('⚠️ Service Worker requiere HTTPS. Despliega en Vercel/Netlify.');
  }
}
```

**Beneficios:**
- Instalar como app en móvil
- Funcionar offline (caché de assets)
- Icono en pantalla principal

**Implementación:**

**1. Crear `manifest.json`:**
```json
{
  "name": "WindChat",
  "short_name": "WindChat",
  "description": "Chat cifrado extremo a extremo",
  "start_url": "/chat.html",
  "display": "standalone",
  "background_color": "#0b1120",
  "theme_color": "#38bdf8",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/mobile.png",
      "sizes": "540x720",
      "type": "image/png"
    }
  ]
}
```

**2. Crear `service-worker.js`:**
```javascript
const CACHE_NAME = 'windchat-v1';
const ASSETS = [
  '/',
  '/chat.html',
  '/src/main.ts',
  '/src/ui.ts',
  '/src/websocket.ts',
  '/src/crypto.ts',
  '/src/i18n.ts',
  '/src/protocol.ts'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
```

**3. Registrar en `main.ts`:**
```typescript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('✅ Service Worker registered'))
    .catch(err => console.error('❌ SW registration failed:', err));
}
```

**4. Añadir en `<head>` de HTML:**
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#38bdf8">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

---

## ✅ 9. Testing y Validación

### 7.1 **Tests Unitarios para CryptoManager**
**Estado:** ❌ Sin tests  
**Prioridad:** ALTA

**Casos a cubrir:**
```typescript
describe('CryptoManager', () => {
  it('debería generar keypair P-256 válido');
  it('debería derivar shared key igual en ambos lados');
  it('debería cifrar y descifrar correctamente');
  it('debería rechazar IV duplicado');
  it('debería fallar con clave incorrecta');
});
```

---

### 7.2 **Tests de Integración WebSocket**
**Estado:** ❌ Sin tests  
**Prioridad:** MEDIA

**Escenarios:**
```typescript
describe('WebSocket Integration', () => {
  it('debería conectar 2 clientes a la misma room');
  it('debería rechazar 3er cliente');
  it('debería intercambiar mensajes cifrados');
  it('debería manejar desconexión abrupta');
});
```

---

### 7.3 **Tests E2E con Playwright**
**Estado:** ❌ Sin tests  
**Prioridad:** BAJA

**Flujo:**
1. Abrir 2 navegadores
2. Conectar a misma room
3. Enviar mensaje desde A → verificar recepción en B
4. Verificar cifrado (servidor no ve plaintext)

---

### 7.4 **Validación de Seguridad**
**Estado:** ⚠️ Requiere auditoría  
**Prioridad:** ALTA

**Checklist:**
- [ ] XSS: verificar que NO se use `.innerHTML`
- [ ] CSRF: no aplica (stateless)
- [ ] DoS: rate limiting
- [ ] Man-in-the-Middle: forzar HTTPS en producción
- [ ] Key Reuse: verificar que IV es aleatorio SIEMPRE

---

## 📁 10. File Sharing E2EE (Cifrado)

### 10.1 **Arquitectura General de Transferencia de Archivos** ⭐⭐⭐
**Estado:** ❌ Falta implementar completamente  
**Prioridad:** MUY ALTA  
**Archivos:** Crear `client/src/fileManager.ts` + actualizar `protocol.ts`

**Características principales:**
- ✅ Cifrado E2EE con AES-256-GCM (igual que mensajes)
- ✅ Chunking para archivos grandes (> 256KB)
- ✅ Preview para imágenes en el chat
- ✅ Download directo para videos y archivos
- ✅ **Modo "Ver una vez"** para imágenes sensibles
- ✅ Drag & drop + selección manual
- ✅ Validación de tipo y tamaño

**Limitaciones técnicas:**
```typescript
const FILE_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024,        // 50 MB máximo
  CHUNK_SIZE: 256 * 1024,                  // 256 KB por chunk
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,       // 10 MB para imágenes
  MAX_VIDEO_SIZE: 50 * 1024 * 1024,       // 50 MB para videos
  
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],
  ALLOWED_FILE_TYPES: '*', // Cualquier archivo
};
```

**⚠️ CONTROL DE FLUJO (Backpressure):**
> **Problema:** Enviar 50MB de chunks puede saturar el buffer del WebSocket.
> **Solución:** Verificar `ws.bufferedAmount` antes de enviar cada chunk.

```typescript
// Control de flujo para evitar saturar el buffer
async sendChunk(chunk: ArrayBuffer) {
  // Esperar si el buffer del WebSocket está lleno (> 1MB)
  while (this.ws.bufferedAmount > 1024 * 1024) {
    await this.delay(100); // Pausa 100ms
  }
  
  // Cifrar y enviar chunk
  const encryptedChunk = await this.crypto.encrypt(chunk);
  this.ws.send(JSON.stringify({
    type: 'file_chunk',
    data: encryptedChunk
  }));
}
```

**Optimización adicional para imágenes:**
```typescript
// Comprimir imágenes antes de cifrar (ahorra ~60% de ancho de banda)
async compressImage(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  
  // Convertir a WebP con 80% de calidad
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob!), 'image/webp', 0.8);
  });
}
```

---

### 10.2 **Protocolo Extendido para Archivos**
**Archivo:** `shared/protocol.ts`

```typescript
// ===== FILE TRANSFER MESSAGES =====

/**
 * Metadatos del archivo (enviado primero, cifrado)
 */
interface FileMetadata {
  id: string;              // UUID del archivo
  name: string;            // Nombre original
  mimeType: string;        // 'image/jpeg', 'video/mp4', 'application/pdf'
  size: number;            // Bytes totales
  totalChunks: number;     // Número de chunks
  timestamp: number;
  viewOnce?: boolean;      // true = se borra tras visualizar
  thumbnail?: string;      // base64 de thumbnail (solo imágenes, max 50KB)
}

/**
 * Mensaje de inicio de transferencia
 */
interface FileStartMessage {
  type: "file_start";
  fileId: string;
  encryptedMetadata: EncryptedData;  // FileMetadata cifrado
}

/**
 * Chunk individual de archivo
 */
interface FileChunkMessage {
  type: "file_chunk";
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  encryptedData: string;   // base64 del chunk cifrado
}

/**
 * Confirmación de recepción completa
 */
interface FileCompleteMessage {
  type: "file_complete";
  fileId: string;
}

/**
 * Notificación de archivo "visto" (para modo view-once)
 */
interface FileViewedMessage {
  type: "file_viewed";
  fileId: string;
}

// Añadir a las uniones existentes
export type ClientToServerMessage = 
  | HandshakeMessage 
  | EncryptedMessage 
  | TypingIndicator 
  | DisconnectMessage
  | FileStartMessage
  | FileChunkMessage
  | FileCompleteMessage
  | FileViewedMessage;

export type ServerToClientMessage = 
  | PeerJoinedMessage 
  | PeerDisconnectedMessage
  | EncryptedMessage 
  | TypingIndicator
  | FileStartMessage
  | FileChunkMessage
  | FileCompleteMessage
  | FileViewedMessage;
```

---

### 10.3 **FileManager - Clase Principal**
**Archivo:** `client/src/fileManager.ts`

```typescript
import CryptoManager from './crypto';
import { FileMetadata, FileStartMessage, FileChunkMessage } from './protocol';

export interface FileTransferCallbacks {
  onProgress?: (fileId: string, progress: number) => void;
  onComplete?: (fileId: string, blob: Blob, metadata: FileMetadata) => void;
  onError?: (fileId: string, error: string) => void;
}

export class FileManager {
  private crypto: CryptoManager;
  private activeTransfers = new Map<string, FileTransfer>();
  private callbacks: FileTransferCallbacks;
  
  constructor(crypto: CryptoManager, callbacks: FileTransferCallbacks) {
    this.crypto = crypto;
    this.callbacks = callbacks;
  }
  
  /**
   * Preparar archivo para envío
   * 1. Validar tipo y tamaño
   * 2. Generar thumbnail si es imagen
   * 3. Dividir en chunks
   * 4. Cifrar cada chunk
   */
  async prepareFile(file: File, viewOnce: boolean = false): Promise<PreparedFile> {
    // Validar tamaño
    if (file.size > FILE_LIMITS.MAX_FILE_SIZE) {
      throw new Error(`Archivo demasiado grande (máx ${FILE_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }
    
    // Determinar categoría
    const category = this.categorizeFile(file.type);
    
    // Generar ID único
    const fileId = crypto.randomUUID();
    
    // Generar thumbnail si es imagen
    let thumbnail: string | undefined;
    if (category === 'image') {
      thumbnail = await this.generateThumbnail(file);
    }
    
    // Leer archivo completo
    const arrayBuffer = await file.arrayBuffer();
    
    // Dividir en chunks
    const chunks: ArrayBuffer[] = [];
    let offset = 0;
    
    while (offset < arrayBuffer.byteLength) {
      const chunkSize = Math.min(FILE_LIMITS.CHUNK_SIZE, arrayBuffer.byteLength - offset);
      const chunk = arrayBuffer.slice(offset, offset + chunkSize);
      chunks.push(chunk);
      offset += chunkSize;
    }
    
    // Crear metadata
    const metadata: FileMetadata = {
      id: fileId,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      totalChunks: chunks.length,
      timestamp: Date.now(),
      viewOnce,
      thumbnail
    };
    
    return {
      metadata,
      chunks,
      category
    };
  }
  
  /**
   * Enviar archivo por chunks
   */
  async sendFile(
    preparedFile: PreparedFile, 
    sendFn: (msg: any) => void
  ): Promise<void> {
    const { metadata, chunks } = preparedFile;
    
    try {
      // 1. Cifrar metadata
      const metadataJson = JSON.stringify(metadata);
      const encryptedMetadata = await this.crypto.encrypt(metadataJson);
      
      // 2. Enviar mensaje de inicio
      const startMsg: FileStartMessage = {
        type: 'file_start',
        fileId: metadata.id,
        encryptedMetadata
      };
      sendFn(startMsg);
      
      // 3. Enviar chunks cifrados
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Cifrar chunk (convertir ArrayBuffer a string primero)
        const chunkBase64 = this.arrayBufferToBase64(chunk);
        const encryptedChunk = await this.crypto.encrypt(chunkBase64);
        
        const chunkMsg: FileChunkMessage = {
          type: 'file_chunk',
          fileId: metadata.id,
          chunkIndex: i,
          totalChunks: chunks.length,
          encryptedData: encryptedChunk.ciphertext
        };
        
        sendFn(chunkMsg);
        
        // Callback de progreso
        const progress = ((i + 1) / chunks.length) * 100;
        this.callbacks.onProgress?.(metadata.id, progress);
        
        // Pequeño delay para no saturar el WebSocket
        await this.delay(10);
      }
      
      // 4. Confirmar finalización
      sendFn({ type: 'file_complete', fileId: metadata.id });
      
    } catch (err) {
      this.callbacks.onError?.(metadata.id, err.message);
      throw err;
    }
  }
  
  /**
   * Recibir chunk y ensamblar archivo
   */
  async receiveChunk(msg: FileChunkMessage): Promise<void> {
    const { fileId, chunkIndex, totalChunks, encryptedData } = msg;
    
    // Obtener o crear transfer
    let transfer = this.activeTransfers.get(fileId);
    if (!transfer) {
      transfer = {
        chunks: new Array(totalChunks),
        receivedCount: 0,
        metadata: null
      };
      this.activeTransfers.set(fileId, transfer);
    }
    
    // Descifrar chunk
    const decryptedChunk = await this.crypto.decrypt(
      msg.iv || '',  // Asumiendo que viene en el mensaje
      encryptedData
    );
    
    // Convertir string base64 de vuelta a ArrayBuffer
    const chunkBuffer = this.base64ToArrayBuffer(decryptedChunk.text);
    
    // Guardar chunk
    transfer.chunks[chunkIndex] = chunkBuffer;
    transfer.receivedCount++;
    
    // Callback de progreso
    const progress = (transfer.receivedCount / totalChunks) * 100;
    this.callbacks.onProgress?.(fileId, progress);
    
    // Si recibimos todos los chunks, ensamblar
    if (transfer.receivedCount === totalChunks) {
      await this.assembleFile(fileId, transfer);
    }
  }
  
  /**
   * Recibir metadata de archivo
   */
  async receiveMetadata(msg: FileStartMessage): Promise<void> {
    const { fileId, encryptedMetadata } = msg;
    
    // Descifrar metadata
    const decrypted = await this.crypto.decrypt(
      encryptedMetadata.iv,
      encryptedMetadata.ciphertext
    );
    
    const metadata: FileMetadata = JSON.parse(decrypted.text);
    
    // Guardar metadata
    let transfer = this.activeTransfers.get(fileId);
    if (!transfer) {
      transfer = {
        chunks: new Array(metadata.totalChunks),
        receivedCount: 0,
        metadata: null
      };
      this.activeTransfers.set(fileId, transfer);
    }
    
    transfer.metadata = metadata;
  }
  
  /**
   * Ensamblar chunks en archivo completo
   */
  private async assembleFile(fileId: string, transfer: FileTransfer): Promise<void> {
    const { chunks, metadata } = transfer;
    
    if (!metadata) {
      throw new Error('Metadata not received');
    }
    
    // Concatenar todos los chunks
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const assembledBuffer = new Uint8Array(totalSize);
    
    let offset = 0;
    for (const chunk of chunks) {
      assembledBuffer.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    
    // Crear Blob con tipo MIME correcto
    const blob = new Blob([assembledBuffer], { type: metadata.mimeType });
    
    // Callback de completado
    this.callbacks.onComplete?.(fileId, blob, metadata);
    
    // Limpiar
    this.activeTransfers.delete(fileId);
  }
  
  /**
   * Generar thumbnail de imagen (max 50KB)
   */
  private async generateThumbnail(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      
      reader.onload = (e) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          
          // Thumbnail de 200x200 (mantener aspect ratio)
          const maxSize = 200;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convertir a JPEG base64 (calidad 0.7)
          const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
          resolve(thumbnail);
        };
        
        img.onerror = reject;
        img.src = e.target!.result as string;
      };
      
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  /**
   * Categorizar archivo por MIME type
   */
  private categorizeFile(mimeType: string): 'image' | 'video' | 'generic' {
    if (FILE_LIMITS.ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      return 'image';
    }
    if (FILE_LIMITS.ALLOWED_VIDEO_TYPES.includes(mimeType)) {
      return 'video';
    }
    return 'generic';
  }
  
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return btoa(String.fromCharCode(...bytes));
  }
  
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface FileTransfer {
  chunks: ArrayBuffer[];
  receivedCount: number;
  metadata: FileMetadata | null;
}

interface PreparedFile {
  metadata: FileMetadata;
  chunks: ArrayBuffer[];
  category: 'image' | 'video' | 'generic';
}
```

---

### 10.4 **UI Moderna para File Sharing** ⭐⭐⭐
**Archivo:** `client/chat.html` + CSS

**Diseño inspirado en WhatsApp/Telegram:**

```html
<!-- Añadir en input-area -->
<div class="input-area">
  <button id="attachFileBtn" class="icon-btn-small" title="Adjuntar archivo">
    📎
  </button>
  <button id="emojiPickerBtn" class="icon-btn-small">😊</button>
  <input type="text" id="messageInput" placeholder="Escribe un mensaje..." />
  <button id="sendButton" class="icon-btn">➤</button>
</div>

<!-- Input oculto para selección de archivos -->
<input 
  type="file" 
  id="fileInput" 
  style="display: none;" 
  multiple
  accept="image/*,video/*,application/*"
/>

<!-- Modal de confirmación de envío de archivo -->
<div class="file-preview-modal" id="filePreviewModal">
  <div class="modal-backdrop" id="modalBackdrop"></div>
  <div class="modal-content">
    <div class="modal-header">
      <h3 id="modalTitle">Enviar archivo</h3>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    
    <div class="modal-body">
      <!-- Preview de imagen -->
      <div class="file-preview" id="filePreview">
        <img id="previewImage" style="max-width: 100%; display: none;" />
        <video id="previewVideo" style="max-width: 100%; display: none;" controls></video>
        <div id="previewGeneric" class="generic-file-icon" style="display: none;">
          <span class="file-icon">📄</span>
          <span class="file-name" id="previewFileName"></span>
          <span class="file-size" id="previewFileSize"></span>
        </div>
      </div>
      
      <!-- Opciones -->
      <div class="file-options">
        <label class="checkbox-option">
          <input type="checkbox" id="viewOnceCheckbox" />
          <span>👁️ Ver una vez (solo imágenes)</span>
        </label>
        <p class="option-description">
          La imagen se eliminará automáticamente después de ser vista
        </p>
      </div>
    </div>
    
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancelar</button>
      <button class="btn-primary" id="modalSend">
        <span id="sendBtnText">Enviar</span>
        <span id="sendBtnLoader" class="spinner" style="display: none;"></span>
      </button>
    </div>
  </div>
</div>

<!-- Drag & Drop Overlay -->
<div class="drag-drop-overlay" id="dragDropOverlay">
  <div class="drag-drop-content">
    <span class="drag-icon">📎</span>
    <p>Suelta aquí para enviar</p>
  </div>
</div>
```

**CSS para File Sharing:**

```css
/* ===== FILE INPUT AREA ===== */
.input-area {
  display: flex;
  align-items: center;
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  gap: 0.5rem;
}

/* ===== FILE PREVIEW MODAL ===== */
.file-preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: none;
  align-items: center;
  justify-content: center;
}

.file-preview-modal.visible {
  display: flex;
}

.modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.modal-content {
  position: relative;
  background: var(--chat-bg);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  animation: modalSlideIn 0.3s ease;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  font-size: 1.2rem;
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-primary);
  opacity: 0.7;
  transition: opacity 0.2s;
}

.modal-close:hover {
  opacity: 1;
}

.modal-body {
  padding: 1.5rem;
  flex: 1;
  overflow-y: auto;
}

.file-preview {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  margin-bottom: 1.5rem;
}

.file-preview img,
.file-preview video {
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.generic-file-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  padding: 2rem;
}

.file-icon {
  font-size: 4rem;
}

.file-name {
  font-weight: 600;
  font-size: 1rem;
  word-break: break-all;
}

.file-size {
  font-size: 0.9rem;
  opacity: 0.7;
}

.file-options {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 1rem;
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.95rem;
}

.checkbox-option input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.option-description {
  font-size: 0.85rem;
  opacity: 0.7;
  margin: 0.5rem 0 0 1.8rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.8rem;
  padding: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.btn-secondary {
  padding: 0.7rem 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: var(--border-color);
}

.spinner {
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  width: 16px;
  height: 16px;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== DRAG & DROP OVERLAY ===== */
.drag-drop-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(56, 189, 248, 0.1);
  backdrop-filter: blur(8px);
  z-index: 9998;
  display: none;
  align-items: center;
  justify-content: center;
  border: 4px dashed var(--accent);
}

.drag-drop-overlay.visible {
  display: flex;
}

.drag-drop-content {
  text-align: center;
}

.drag-icon {
  font-size: 5rem;
  display: block;
  margin-bottom: 1rem;
}

.drag-drop-content p {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--accent);
}

/* ===== FILE MESSAGES IN CHAT ===== */
.message.file {
  max-width: 300px;
}

.file-message-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.file-image-preview {
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
}

.file-image-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.file-image-preview.view-once::after {
  content: '👁️ Ver una vez';
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
}

.file-image-preview.viewed {
  filter: blur(20px);
  pointer-events: none;
}

.file-image-preview.viewed::after {
  content: 'Ya visto';
  background: rgba(0, 0, 0, 0.9);
}

.file-download-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.file-download-btn:hover {
  background: var(--border-color);
}

.file-info {
  flex: 1;
  text-align: left;
}

.file-info-name {
  font-weight: 600;
  font-size: 0.9rem;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.file-info-size {
  font-size: 0.75rem;
  opacity: 0.7;
}

.file-download-icon {
  font-size: 1.5rem;
}

/* Progress bar para uploads */
.file-upload-progress {
  position: relative;
  height: 4px;
  background: var(--border-color);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 0.5rem;
}

.file-upload-progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
```

---

### 10.5 **Integración con Main.ts**
**Archivo:** `client/src/main.ts`

```typescript
import { FileManager } from './fileManager';

let fileManager: FileManager;

// Inicializar cuando el chat esté conectado
chatClient = new ChatClient({
  onPeerJoined: () => {
    // ... código existente ...
    
    // Inicializar FileManager
    fileManager = new FileManager(chatClient.crypto, {
      onProgress: (fileId, progress) => {
        updateFileProgress(fileId, progress);
      },
      onComplete: (fileId, blob, metadata) => {
        renderFileMessage(blob, metadata, false);
      },
      onError: (fileId, error) => {
        showToast(`Error: ${error}`);
      }
    });
  }
});

// Event listeners para file input
const attachFileBtn = document.getElementById('attachFileBtn');
const fileInput = document.getElementById('fileInput');

attachFileBtn?.addEventListener('click', () => {
  fileInput?.click();
});

fileInput?.addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  
  const file = files[0];
  await showFilePreviewModal(file);
});

// Drag & Drop
const chatContainer = document.getElementById('chatContainer');
const dragDropOverlay = document.getElementById('dragDropOverlay');

chatContainer?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dragDropOverlay?.classList.add('visible');
});

chatContainer?.addEventListener('dragleave', (e) => {
  if (e.target === chatContainer) {
    dragDropOverlay?.classList.remove('visible');
  }
});

chatContainer?.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDropOverlay?.classList.remove('visible');
  
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  
  const file = files[0];
  await showFilePreviewModal(file);
});

// Mostrar modal de preview
async function showFilePreviewModal(file: File) {
  const modal = document.getElementById('filePreviewModal');
  const previewImage = document.getElementById('previewImage') as HTMLImageElement;
  const previewVideo = document.getElementById('previewVideo') as HTMLVideoElement;
  const previewGeneric = document.getElementById('previewGeneric');
  const viewOnceCheckbox = document.getElementById('viewOnceCheckbox') as HTMLInputElement;
  
  // Reset
  previewImage.style.display = 'none';
  previewVideo.style.display = 'none';
  previewGeneric.style.display = 'none';
  viewOnceCheckbox.checked = false;
  viewOnceCheckbox.disabled = true;
  
  // Mostrar preview según tipo
  if (file.type.startsWith('image/')) {
    previewImage.src = URL.createObjectURL(file);
    previewImage.style.display = 'block';
    viewOnceCheckbox.disabled = false;
  } else if (file.type.startsWith('video/')) {
    previewVideo.src = URL.createObjectURL(file);
    previewVideo.style.display = 'block';
  } else {
    previewGeneric.style.display = 'flex';
    document.getElementById('previewFileName')!.textContent = file.name;
    document.getElementById('previewFileSize')!.textContent = formatFileSize(file.size);
  }
  
  modal?.classList.add('visible');
  
  // Configurar botón de enviar
  const modalSend = document.getElementById('modalSend');
  modalSend?.addEventListener('click', async () => {
    await sendFileHandler(file, viewOnceCheckbox.checked);
    modal?.classList.remove('visible');
  }, { once: true });
}

// Enviar archivo
async function sendFileHandler(file: File, viewOnce: boolean) {
  try {
    const prepared = await fileManager.prepareFile(file, viewOnce);
    
    // Mostrar mensaje de "enviando" en UI
    renderFileMessagePlaceholder(prepared.metadata);
    
    // Enviar por chunks
    await fileManager.sendFile(prepared, (msg) => {
      chatClient.ws.send(JSON.stringify(msg));
    });
    
    showToast('✅ Archivo enviado');
  } catch (err) {
    showToast(`❌ Error: ${err.message}`);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
```

---

### 10.6 **Visualización de "Ver Una Vez"** ⭐
**Archivo:** `client/src/viewOnceManager.ts`

```typescript
export class ViewOnceManager {
  private viewedFiles = new Set<string>();
  private storageKey = 'windchat_viewed_files';
  
  constructor() {
    this.loadViewedFiles();
  }
  
  private loadViewedFiles() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      this.viewedFiles = new Set(JSON.parse(saved));
    }
  }
  
  markAsViewed(fileId: string) {
    this.viewedFiles.add(fileId);
    localStorage.setItem(this.storageKey, JSON.stringify([...this.viewedFiles]));
  }
  
  isViewed(fileId: string): boolean {
    return this.viewedFiles.has(fileId);
  }
  
  applyBlur(imageElement: HTMLElement, fileId: string) {
    if (this.isViewed(fileId)) {
      imageElement.classList.add('viewed');
    } else {
      // Al hacer click, marcar como visto y aplicar blur
      imageElement.addEventListener('click', () => {
        this.markAsViewed(fileId);
        imageElement.classList.add('viewed');
        
        // Notificar al remitente que se vio la imagen
        chatClient.ws.send(JSON.stringify({
          type: 'file_viewed',
          fileId
        }));
      }, { once: true });
    }
  }
}
```

---

## ⚡ 11. Optimizaciones de Rendimiento

### 11.1 **Lazy Loading de Mensajes Antiguos**
**Estado:** ⚠️ Todos en memoria  
**Prioridad:** BAJA

**Problema:**
- Si hay 1000 mensajes, todos están en DOM

**Solución:**
```typescript
// Virtualización: solo renderizar 50 mensajes visibles
// Usar IntersectionObserver para cargar más al scrollear
```

---

### 11.2 **Debouncing en Typing Indicator**
**Estado:** ⚠️ Envío excesivo  
**Prioridad:** BAJA

**Mejora:**
```typescript
// Usar debounce de 300ms para evitar spamear typing:true
```

---

### 11.3 **Compresión de Mensajes Largos**
**Estado:** ❌ Sin compresión  
**Prioridad:** BAJA

**Consideración:**
- Si mensaje > 1KB, comprimir con pako (gzip) antes de cifrar

---

### 11.4 **Chunking Progresivo para Archivos Grandes**
**Estado:** ⚠️ Mejora para file sharing  
**Prioridad:** MEDIA

**Problema:**
- Enviar archivo de 50MB puede bloquear UI
- No hay pausa/resume

**Solución:**
```typescript
// Implementar cola de chunks con control de flujo
class ChunkQueue {
  private queue: Chunk[] = [];
  private sending: boolean = false;
  private paused: boolean = false;
  
  async sendNext() {
    if (this.paused || this.queue.length === 0) return;
    
    this.sending = true;
    const chunk = this.queue.shift();
    await sendChunk(chunk);
    
    // Pequeño delay entre chunks
    await this.delay(50);
    this.sendNext();
  }
  
  pause() { this.paused = true; }
  resume() { this.paused = false; this.sendNext(); }
}
```

---

## 🎯 Resumen de Prioridades Actualizado

| Prioridad | Cantidad | Categoría Principal |
|-----------|----------|---------------------|
| 🔴 CRÍTICA | 1 | Reconexión WebSocket |
| 🟠 MUY ALTA | 6 | UI + File Sharing |
| 🟡 ALTA | 14 | UI + Estabilidad + i18n + PWA + Files |
| 🟢 MEDIA | 17 | UX + Lógica + Funcionalidades + Chunking |
| ⚪ BAJA | 14 | Optimizaciones + Nice-to-have |

**TOTAL:** 52 items identificados

---

## 📝 Plan de Implementación Actualizado

### **Fase 1: Estabilidad Crítica** (1-2 días)
1. ✅ Reconexión WebSocket con backoff exponencial
2. ✅ Race condition en login (finally block)
3. ✅ Validación de claves públicas P-256
4. ✅ Memory leak en rooms (limpiar timeouts)
5. ✅ Indicador visual de conexión persistente

**Archivos:** `websocket.ts`, `main.ts`, `server/index.ts`, `chat.html`

---

### **Fase 2: UI Esencial** (3-4 días)
1. ✅ Mensajes largos con word-wrap correcto
2. ✅ Campo de nombre de usuario (header + localStorage + protocolo)
3. ✅ Chat en pantalla completa (eliminar max-width, responsive)
4. ✅ Botón enviar más grande y bonito
5. ✅ CompletarFile Sharing E2EE** (4-5 días) 🆕
1. ✅ FileManager completo (chunking + cifrado)
2. ✅ Drag & Drop + File picker
3. ✅ Tests FileManager (chunking + cifrado)
4. ✅ Rate limiting en servidor
5. ✅ CSP headers
6. ✅ Auditoría de seguridad completa
7. ✅ Validación de protocolos

**Archivos:** Crear `tests/`, `server/rateLimit.ts`, actualizar `server/index.ts`

---

### **Fase 7

### **Fase 6:  traducciones i18n (ES/EN)
6. ✅ Selector de idioma funcional
7. ✅ Notificaciones del navegador
8. ✅ Sonidos de envío/recepción

**Archivos:** `chat.html`, `main.ts`, `protocol.ts`, `i18n.ts`, crear `userManager.ts`, `notifications.ts`, `soundManager.ts`

---

### **Fase 3: Funcionalidad Avanzada** (4-5 días)
1. ✅ Menú contextual completo (desktop + móvil)
2. ✅ Sistema de reacciones emoji (👍❤️😂😮😢)
3. ✅ Responder a mensaje específico (quote)
4. ✅ Eliminar mensaje propio
5. ✅ UUIDs para mensajes
6. ✅ Timestamps humanizados ("Hace 5 min")
7. ✅ Badge de mensajes no leídos en título

**Archivos:** Crear `contex6):**
- [ ] PWA instalable en móviles
- [ ] File sharing E2EE funcional
- [ ] Preview de imágenes en chat
- [ ] Modo "ver una vez" implementado
- [ ] Tests unitarios >70% coverage
- [ ] Rate limiting activo
- [ ] Validación de seguridad pasada

### **Opcionales (Fase 7tir room
3. ✅ Exportar chat (TXT/JSON/HTML)
4. ✅ PWA support (manifest + service worker)
5. ✅ Scroll inteligente
6. ✅ Confirmación al cerrar pestaña
7. ✅ Feedback visual al copiar

**Archivos:** Crear `emojiPicker.ts`, `export.ts`, `manifest.json`, `service-worker.js`, actualizar `ui.ts`

---

### **Fase 5: Seguridad y Testing** (2-3 días)
1. ✅ Tests unitarios CryptoManager (Jest/Vitest)
2. ✅File sharing E2EE** | Funcional | 0% ❌ |
| ** Tests integración WebSocket
3. ✅ Rate limiting en servidor
4. ✅ CSP headers
5. ✅ Auditoría de seguridad completa
6. ✅ Validación de protocolos

**Archivos:** Crear `tests/`, `server/rateLimit.ts`, actualizar `server/index.ts`

---

### **Fase 6: Polish Final** (1-2 días)
1. ✅ Optimizar renderizado (virtualización si necesario)
2. ✅ Debouncing en typing indicator
3. ✅ Documentación de usuario actualizada
4. ✅ README con screenshots
5. ✅ Guía de despliegue mejorada

---

## 🏁 Criterios de Finalización Actualizados

**El roadmap se considera completado cuando:**

### **Obligatorios (Fase 1-3):**
- [x] Todos los bugs CRÍTICOS resueltos
- [ ] Reconexión automática funcional
- [ ] UI cumple 100% con requisitos (menú contextual, nombre usuario, pantalla completa)
- [ ] Reacciones y respuestas funcionando
- [ ] i18n completo (ES + EN) con selector
- [ ] Notificaciones del navegador activas

### **Recomendados (Fase 4-5):**
- [ ] PWA instalable en móviles
- [ ] Tests unitarios >70% coverage en crypto
- [ ] R1.5.0 - File Sharing E2EE** 🆕
- ✅ Enviar cualquier archivo cifrado
- ✅ Preview de imágenes en chat
- ✅ Drag & Drop para archivos
- ✅ Modo "ver una vez" para fotos
- ✅ Download de videos y documentos
- ✅ Progress bars para uploads/downloads
- ✅ Chunking para archivos grandes (50MB)

### **v2.0.0 - Futuro**
- 🎯 Compartir múltiples archivos simultáneos
- 🎯 Compresión de imágenes antes de enviar
- 🎯 Videollamadas P2P (WebRTC)
- 🎯 Grupos de 3+ usuarios
- 🎯 Persistencia de mensajes (opcional)
- 🎯 Búsqueda en historial
- [ ] Exportar chat disponible
- [ ] QR code para compartir
- [ ] Documentación completa

---

## 📊 Métricas de Éxito

| Métrica | Objetivo | Estado Actual |
|---------|----------|---------------|
| **Bugs críticos** | 0 | 5 ❌ |
| **Cobertura tests** | >70% | 0% ❌ |
| **i18n completo** | ES + EN | 40% ⚠️ |
| **Funcionalidades UI** | 100% | 20% ⚠️ |
| **Rendimiento WS** | <100ms latencia | ✅ |
| **Tiempo reconexión** | <5s | N/A ❌ |
| **PWA Lighthouse** | >90 | N/A ❌ |

---

## fileManager.ts       🆕 (File sharing E2EE + chunking)
├── viewOnceManager.ts   🆕 (Gestión de imágenes "ver una vez")
├── utils/
│   └── time.ts          (Formateo humanizado de tiempo)
└── tests/
    ├── crypto.test.ts
    ├── websocket.test.ts
    ├── fileManager.test.ts  🆕
    └── ui.test.ts

server/src/
├── rateLimit.ts         (Rate limiting por IP/cliente)
└── tests/
    └── integration.test.ts

client/public/
├── manifest.json        (PWA manifest)
├── service-worker.js    (Cache offline)
├── sounds/
│   ├── send.mp3
│   └── receive.mp3
└── icons/
    ├── icon-192.png
    └── icon-512.png

shared/
└── protocol.ts          (Extender con tipos de archivo)  🆕
```

---

## 🎨 UI Reference & Inspiración

### **File Sharing UI - WhatsApp Style**

```
┌─────────────────────────────────────┐
│ 📷 [Imagen.jpg]                     │
│ ┌─────────────────────────────────┐ │
│ │                                 │ │
│ │      [Preview de imagen]        │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│ 👁️ Ver una vez                      │
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░ 50%            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 🎥 [Video.mp4]                      │
│ ↓ 15.2 MB • Toca para descargar     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 📄 [Documento.pdf]                  │
│ 📎 2.5 MB • PDF                     │
│ [Descargar]                         │
└─────────────────────────────────────┘
```

### **Drag & Drop Overlay**
```
┌─────────────────────────────────────┐
│                                     │
│           📎                        │
│    Suelta aquí para enviar          │
│                                     │
└─────────────────────────────────────┘
- ✅ QR code para compartir
- ✅ Emoji picker
- ✅ Exportar chat
- ✅ Modo offline (assets)

### **v2.0.0 - Futuro**
- 🎯 Compartir archivos/imágenes
- 🎯 Videollamadas P2P (WebRTC)
- 🎯 Grupos de 3+ usuarios
- 🎯 Persistencia de mensajes (opcional)

---

## 📚 Dependencias Nuevas a Instalar

```json
{
  "dependencies": {
    "qrcode": "^1.5.3"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.2",
    "vitest": "^1.0.0",
    "@vitest/ui": "^1.0.0",
    "playwright": "^1.40.0"
  }
}
```

---

## 🎨 Archivos Nuevos a Crear

```
client/src/
├── contextMenu.ts       (Menú click derecho/long press)
├── userManager.ts       (Gestión nombre usuario)
├── notifications.ts     (Notificaciones navegador)
├── soundManager.ts      (Sonidos de eventos)
├── emojiPicker.ts       (Panel de emojis)
├── export.ts            (Exportar chat TXT/JSON/HTML)
├── utils/
│   └── time.ts          (Formateo humanizado de tiempo)
└── tests/
    ├── crypto.test.ts
    ├── websocket.test.ts
    └── ui.test.ts

server/src/
├── rateLimit.ts         (Rate limiting por IP/cliente)
└── tests/
    └── integration.test.ts

client/public/
├── manifest.json        (PWA manifest)
├── service-worker.js    (Cache offline)
├── sounds/
│   ├── send.mp3
│   └── receive.mp3
└── icons/
    ├── icon-192.png
    └── icon-512.png

shared/
└── protocol.ts          (Extender con nuevos tipos)
```

---

**Mantenido por:** Equipo WindChat  
**Última actualización:** 7 de Marzo, 2026

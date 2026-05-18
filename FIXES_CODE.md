# 🔧 Correcciones Recomendadas - Código Listo

Este archivo contiene código listo para implementar las 3 correcciones CRÍTICAS identificadas en la auditoría.

---

## 1️⃣ CORRECCIÓN: Memory Leak en FileManager

**Archivo**: `client/src/fileManager.ts`  
**Problema**: `activeTransfers` Map crece sin límite  
**Tiempo**: 30 minutos

### Paso 1: Añadir método de limpieza

Después del método `generateFileId()`, añadir:

```typescript
/**
 * Programar limpieza automática de transferencia completada
 * Se ejecuta después de 30 segundos
 */
private scheduleTransferCleanup(fileId: string, delayMs: number = 30000): void {
  setTimeout(() => {
    const transfer = this.activeTransfers.get(fileId);
    if (transfer) {
      console.log(`🧹 Limpiando transferencia completada: ${fileId}`);
      this.activeTransfers.delete(fileId);
    }
  }, delayMs);
}
```

### Paso 2: Llamar a limpieza en `handleFileComplete()`

Cambiar:
```typescript
// ❌ ANTES
handleFileMetadata(payload: MessagePayload): void {
  const transfer: FileTransfer = {
    id: fileId,
    // ... resto de propiedades
    status: "pending",
  };
  this.activeTransfers.set(fileId, transfer);
  
  if (this.callbacks.onDownloadProgress) {
    this.callbacks.onDownloadProgress(fileId, 0);
  }
}
```

Por:
```typescript
// ✅ DESPUÉS
handleFileMetadata(payload: MessagePayload): void {
  const transfer: FileTransfer = {
    id: fileId,
    // ... resto de propiedades
    status: "pending",
  };
  this.activeTransfers.set(fileId, transfer);
  
  if (this.callbacks.onDownloadProgress) {
    this.callbacks.onDownloadProgress(fileId, 0);
  }
  
  // ✅ NUEVO: Programar limpieza
  this.scheduleTransferCleanup(fileId, 30000);
}
```

### Paso 3: Limitador de Transferencias Activas

Opcional pero recomendado - prevenir DOS:

```typescript
/**
 * Limitar número de transferencias simultáneas
 * Prevenir DOS por memoria
 */
private readonly MAX_CONCURRENT_TRANSFERS = 10;

private validateTransferCapacity(): boolean {
  if (this.activeTransfers.size >= this.MAX_CONCURRENT_TRANSFERS) {
    const error = `Máximo ${this.MAX_CONCURRENT_TRANSFERS} transferencias simultáneas`;
    this.callbacks.onError?.("temp-id", error);
    return false;
  }
  return true;
}
```

Entonces en `handleFileMetadata()`, antes de crear la transferencia:

```typescript
if (!this.validateTransferCapacity()) {
  return;
}
```

---

## 2️⃣ CORRECCIÓN: WebSocket Heartbeat

**Archivo**: `client/src/websocket.ts`  
**Problema**: Sin heartbeat, conexiones "zombies"  
**Tiempo**: 45 minutos

### Paso 1: Añadir propiedades de heartbeat

En la clase `ChatClient`, después de `private maxReconnectAttempts`:

```typescript
private heartbeatInterval?: NodeJS.Timeout;
private readonly HEARTBEAT_INTERVAL = 30000;  // 30 segundos
private readonly HEARTBEAT_TIMEOUT = 5000;    // 5 segundos para responder
private heartbeatPending = false;
```

### Paso 2: Implementar métodos start/stop heartbeat

```typescript
/**
 * Iniciar heartbeat (ping-pong)
 */
private startHeartbeat(): void {
  this.stopHeartbeat();  // Limpiar anterior si existe
  
  this.heartbeatInterval = setInterval(() => {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Enviar ping como mensaje especial
    try {
      this.ws!.send(JSON.stringify({ type: "ping" }));
      this.heartbeatPending = true;
      
      // Timeout: si no recibimos pong en 5 segundos, reconectar
      setTimeout(() => {
        if (this.heartbeatPending && this.ws?.readyState === WebSocket.OPEN) {
          console.warn("⚠️ Heartbeat timeout, reconectando...");
          this.ws!.close();
        }
      }, this.HEARTBEAT_TIMEOUT);
    } catch (err) {
      console.error("❌ Error enviando heartbeat:", err);
    }
  }, this.HEARTBEAT_INTERVAL);
  
  console.log("✅ Heartbeat iniciado (cada 30s)");
}

/**
 * Detener heartbeat
 */
private stopHeartbeat(): void {
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = undefined;
    console.log("⏸️ Heartbeat detenido");
  }
}
```

### Paso 3: Llamar startHeartbeat en onopen

En `this.ws.onopen`:

```typescript
this.ws.onopen = () => {
  console.log("✅ WebSocket conectado");
  this.reconnectAttempts = 0;
  this.isReconnecting = false;

  // Enviar handshake
  const handshake: ClientToServerMessage = {
    type: "join",
    roomId,
    publicKey: this.publicKeyB64!,
    displayName: this.displayName,
  };

  this.ws!.send(JSON.stringify(handshake));
  console.log("📤 Handshake enviado");
  
  // ✅ NUEVO: Iniciar heartbeat
  this.startHeartbeat();

  if (this.callbacks.onConnected) {
    this.callbacks.onConnected();
  }
};
```

### Paso 4: Manejar pong en handleMessage

En `handleMessage()`, antes de `const parsed = JSON.parse(data)`:

```typescript
private async handleMessage(data: string) {
  try {
    // ✅ NUEVO: Manejar heartbeat pong
    const isHeartbeat = data === '{"type":"pong"}';
    if (isHeartbeat) {
      this.heartbeatPending = false;
      console.log("💓 Pong recibido");
      return;
    }
    
    // ... resto del código
```

### Paso 5: Limpiar heartbeat en onclose

En `this.ws.onclose`:

```typescript
this.ws.onclose = (event) => {
  console.log(`👋 WebSocket cerrado (code: ${event.code})`);
  
  // ✅ NUEVO: Limpiar heartbeat
  this.stopHeartbeat();
  
  // ... resto del código
};
```

### Paso 6: Manejar heartbeat en servidor (opcional pero recomendado)

En `server/src/index.ts`, en `wss.on("connection")`:

```typescript
case "ping":
  // Responder con pong
  try {
    ws.send(JSON.stringify({ type: "pong" }));
  } catch (e) {
    console.warn("⚠️ Error enviando pong:", e);
  }
  break;
```

---

## 3️⃣ CORRECCIÓN: ARIA Labels en Botones

**Archivo**: `client/public/index.html`  
**Problema**: Screen readers no pueden leer botones  
**Tiempo**: 15 minutos

### Cambios en HTML

Reemplazar los botones actuales:

```html
<!-- ❌ ANTES -->
<button id="sendButton">Send</button>
<button id="themeToggle">🌙</button>
<button id="languageToggle">EN</button>
<button id="enableNotifications">🔔</button>
<button id="soundToggle">🔊</button>

<!-- ✅ DESPUÉS -->
<button id="sendButton" 
        aria-label="Enviar mensaje" 
        title="Enviar mensaje (Enter)">
  Send
</button>

<button id="themeToggle" 
        aria-label="Cambiar tema" 
        title="Cambiar entre tema claro y oscuro">
  🌙
</button>

<button id="languageToggle" 
        aria-label="Cambiar idioma" 
        title="Cambiar entre Español e Inglés">
  EN
</button>

<button id="enableNotifications" 
        aria-label="Activar notificaciones" 
        title="Activar o desactivar notificaciones de escritorio">
  🔔
</button>

<button id="soundToggle" 
        aria-label="Silenciar sonidos" 
        title="Activar o desactivar sonidos de notificación">
  🔊
</button>
```

### Actualizar aria-labels dinámicamente en JavaScript

En `client/src/main.ts`, en `updateNotificationButton()`:

```typescript
// ✅ CORRECCIÓN: Actualizar aria-label también
const updateNotificationButton = () => {
  if (!notificationBtn) return;
  const enabled = notificationManager.isEnabled();
  notificationBtn.textContent = enabled ? "🔔" : "🔕";
  notificationBtn.title = enabled ? t("notifDisableTitle") : t("notifEnableTitle");
  
  // ✅ NUEVO: Actualizar aria-label
  notificationBtn.setAttribute("aria-label", 
    enabled ? t("notifDisableTitle") : t("notifEnableTitle")
  );
};

const updateSoundButton = () => {
  if (!soundBtn) return;
  const enabled = soundManager.isEnabled();
  soundBtn.textContent = enabled ? "🔊" : "🔇";
  soundBtn.title = enabled ? t("soundDisableTitle") : t("soundEnableTitle");
  
  // ✅ NUEVO: Actualizar aria-label
  soundBtn.setAttribute("aria-label",
    enabled ? t("soundDisableTitle") : t("soundEnableTitle")
  );
};
```

---

## 📋 Checklist de Implementación

### FileManager Cleanup
- [ ] Añadir método `scheduleTransferCleanup()`
- [ ] Llamar a `scheduleTransferCleanup()` en `handleFileMetadata()`
- [ ] (Opcional) Añadir `validateTransferCapacity()`
- [ ] Probar con DevTools: Memory > Heap snapshot
- [ ] Verificar que `activeTransfers` no crece en chat prolongado

### WebSocket Heartbeat
- [ ] Añadir propiedades: `heartbeatInterval`, `HEARTBEAT_INTERVAL`, etc.
- [ ] Implementar `startHeartbeat()` y `stopHeartbeat()`
- [ ] Llamar `startHeartbeat()` en `ws.onopen`
- [ ] Llamar `stopHeartbeat()` en `ws.onclose`
- [ ] Manejar "ping" en `handleMessage()`
- [ ] (Opcional) Implementar respuesta "pong" en servidor
- [ ] Probar: Desactivar red en DevTools, verificar reconexión en 1-5 segundos

### ARIA Labels
- [ ] Añadir `aria-label` a todos los `<button>` en HTML
- [ ] Actualizar `aria-label` dinámicamente en funciones de actualización
- [ ] Probar: Abrir DevTools > Accessibility Inspector
- [ ] Probar: Usar screen reader (NVDA en Windows, VoiceOver en Mac)

---

## 🧪 Cómo Verificar que Funcionan

### FileManager Cleanup
```javascript
// En DevTools Console
// 1. Enviar un archivo grande
// 2. Esperar a que termine
// 3. Ejecutar:
console.log(chatClient.fileManager.activeTransfers.size);
// Debe ser 0 después de 30 segundos

// O verificar Memory:
// DevTools > Memory > Heap Snapshot
// Buscar "FileTransfer" - no debe crecer
```

### WebSocket Heartbeat
```javascript
// DevTools > Network
// Ver que se envía "ping" cada 30 segundos
// Y se recibe "pong" de vuelta
// Luego desactivar red: Ctrl+Shift+M (throttle)
// Ver que reconecta automáticamente
```

### ARIA Labels
```javascript
// En DevTools Accessibility Inspector
// O con Lighthouse: Ctrl+Shift+X
// Correr auditoría de accesibilidad
// Score debe mejorar
```

---

## 📝 Orden Recomendado

1. **FileManager** (30 min) - Más fácil, menos riesgoso
2. **ARIA Labels** (15 min) - Muy rápido, buena UX
3. **WebSocket Heartbeat** (45 min) - Más complejo, más beneficioso

Total: ~90 minutos = 1.5 horas 👍

---

## ❓ Preguntas Frecuentes

**P: ¿Puedo hacer todo a la vez?**  
R: Sí, son cambios independientes. Pero recomienda hacer FileManager primero (menos riesgoso).

**P: ¿Necesito tests?**  
R: Recomendado para heartbeat. FileManager y ARIA no requieren.

**P: ¿Qué pasa con las limitaciones MVP (forward secrecy, etc)?**  
R: Dejarlas para v2. Estas correcciones son estabilidad/accesibilidad.

**P: ¿Hay más problemas?**  
R: Sí, pero estos 3 son los CRÍTICOS. Ver AUDIT_REPORT.md para lista completa.

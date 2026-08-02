# 🌐 WindChat - Guía Cloudflare Tunnel

## ⚠️ Problema Resuelto

**Antes**: El túnel de Cloudflare solo exponía el cliente, pero el WebSocket server no era accesible desde Internet.

**Solución**: Usamos DOS túneles de Cloudflare:
1. **Túnel A**: Servidor WebSocket (puerto 8080) 
2. **Túnel B**: Cliente UI (puerto 3000/3001)

---

## 🚀 Uso: Opción [7] del run.ps1

### Pasos automatizados:

1. **Ejecuta el script**:
   ```powershell
   .\run.ps1
   ```

2. **Selecciona opción [7]**: "Modo Cloudflare (server + client + tunnel)"

3. **El script hace**:
   - ✅ Inicia servidor WebSocket en puerto 8080
   - ✅ Abre túnel #1 para el SERVIDOR
   - ⏸️ Espera que copies la URL del túnel del servidor

4. **Copia la URL del TÚNEL SERVIDOR**:
   - Busca la ventana que dice `TUNNEL SERVIDOR WEBSOCKET`
   - Copia la URL: `https://xxx-yyy-zzz.trycloudflare.com`
   - Pégala en el script cuando lo pida

5. **El script continúa**:
   - ✅ Inicia cliente Vite con `VITE_WS_URL` configurado automáticamente
   - ✅ Abre túnel #2 para el CLIENTE

6. **Copia la URL del TÚNEL CLIENTE**:
   - Busca la ventana que dice `TUNNEL CLIENTE`
   - Copia la URL: `https://aaa-bbb-ccc.trycloudflare.com`
   - Ábrela en tu navegador o compártela

---

## 🎯 Resultado Final

Tendrás 4 ventanas PowerShell abiertas:
1. **Servidor WebSocket** (localhost:8080)
2. **Cliente Vite** (localhost:3000)
3. **Túnel Servidor** (cloudflared → 8080)
4. **Túnel Cliente** (cloudflared → 3000)

---

## 📋 Ejemplo de URLs:

```
Túnel Servidor:  https://pointer-amount-ada.trycloudflare.com
   ↓ (convertido automáticamente a)
WS URL Cliente:  wss://pointer-amount-ada.trycloudflare.com

Túnel Cliente:   https://carolina-grams-opens.trycloudflare.com
   ↓ (usa esta para acceder)
Abrir en naveg:  https://carolina-grams-opens.trycloudflare.com/chat.html
```

---

## ✅ Verificación

Si todo funciona correctamente:
- ✅ No verás error "Firefox no puede establecer conexión"
- ✅ Verás en consola: `✅ WebSocket conectado`
- ✅ Podrás escribir en el input del chat sin problemas

---

## 🐛 Bug del Input - RESUELTO

**Problema reportado**: Al poner roomID, el input se "buggeaba" y no dejaba escribir.

**Causa**: 
- La conexión se ejecutaba 2 veces (evento duplicado)
- No había protección contra clics múltiples

**Solución aplicada**:
```typescript
// Agregado flag isConnecting
let isConnecting = false;

// Prevenido comportamiento por defecto en Enter
e.preventDefault();

// Deshabilitado input/botón durante conexión
loginBtn.disabled = true;
usernameInput.disabled = true;
```

---

## 🎮 Flujo Completo de Prueba

### Usuario A (tú):
1. Ejecuta `.\run.ps1` → opción [7]
2. Copia túnel servidor: `https://xxx.trycloudflare.com`
3. Pégalo cuando lo pida
4. Copia túnel cliente: `https://aaa.trycloudflare.com`
5. Abre: `https://aaa.trycloudflare.com/chat.html`
6. Room ID: `sala123`

### Usuario B (otra máquina):
1. Abre: `https://aaa.trycloudflare.com/chat.html` (MISMA URL que Usuario A)
2. Room ID: `sala123` (MISMO que Usuario A)
3. ✅ Se conectan automáticamente

---

## 📊 Arquitectura de Red

```
Usuario A                Usuario B
   ↓                        ↓
   ↓                        ↓
Túnel Cliente (Cloudflare Edge)
   ↓
Client Vite (localhost:3000)
   ↓ WebSocket connection
   ↓
Túnel Servidor (Cloudflare Edge)
   ↓
Servidor WebSocket (localhost:8080)
```

---

## 🔧 Troubleshooting

### Error: "No se detecto cliente en 3000/3001"
**Solución**: Espera 5 segundos después de iniciar el cliente antes de abrir el túnel.

### Error: "URL del servidor requerida"
**Solución**: NO dejes el campo vacío. Debes copiar la URL del túnel servidor.

### Error: "Firefox no puede establecer conexión"
**Solución**: Verifica que hayas copiado correctamente la URL del túnel del SERVIDOR (no del cliente).

---

## 🏁 ¡Listo para probar!

```powershell
.\run.ps1
# Opción [7]
# Sigue las instrucciones en pantalla
```

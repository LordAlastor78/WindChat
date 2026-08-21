# WindChat/FugazChat — Issues de Auditoría (con causa raíz)

Fecha: 2026-08-19 · Auditor: Hermes (skills: vibe-security, anthropic-cybersecurity-skills)
Orden de parcheo propuesto: F-1 → F-2 → F-3 → F-4 → F-5 → F-6 → F-7 → F-8 → F-9 → F-14 → (F-10/F-11/F-12/F-13 = doc/test/conocido, no parche de código crítico).

Para cada issue: **Síntoma** (lo que ve el usuario) · **Mecanismo** (cómo lo produce el código) · **Causa raíz** (por qué el código es así) · **Qué causa** (impacto en producción).

---

## F-1 · CRÍTICO · Reconexión tras caída real del peer nunca restaura la sesión
- **Área:** Protocolo / Reconexión — `server/src/index.ts:679-692` y `relay-rust/src/main.rs:354-378`.
- **Síntoma:** A y B conectados. B se cae de red (sin FIN, p.ej. suspender portátil / WiFi perdida). A recibe `peer_disconnected`, su input se bloquea y la safety UI se oculta. Cuando B vuelve, A **nunca** recibe `peer_joined` → B queda ciego y sin poder re-handshakear; el chat no se restaura aunque ambos estén online.
- **Mecanismo:** `handleJoin` calcula `isReconnect = seenConnectionIds.has(connectionId)`. `seenConnectionIds` se inserta en join (`:680` / `:359`) y **nunca se borra**. El `connectionId` del cliente es estable (`websocket.ts:49`) y se reusa en reconexión (`:696`). Por tanto, tras la primera desconexión de B, su `connectionId` sigue en el set → `isReconnect=true` → el gate `room.clients.size === 2 && !isReconnect` (`:689` / `:378`) es falso → no se envía `peer_joined`.
- **Causa raíz:** El fix anterior "no re-handshakear en reconexión" (para curar el bug de ratchet en móvil) usó un set creciente y nunca podado como proxy de "sigue conectado". El set debería reflejar *conexiones actualmente vivas*, no *vistas históricamente*. Se optimizó el caso del blip y se rompió el caso del peer-ausente.
- **Qué causa:** El flujo principal (chat 1:1) se rompe tras la primera desconexión completa de uno de los dos lados. Afecta web (server Node) y desktop (relay Rust) por igual.
- **Evidencia:** `relay-rust/src/main.rs:354-360` (insert, sin delete en ningún sitio); `server/src/index.ts:659` (`seenConnectionIds: new Set()`), `:680` (add), `:689` (gate). `handleDisconnect` no limpia el set.
- **Confirmación:** Confirmado. **Confianza:** alta.

## F-2 · ALTO · CORS `*` abierto en launcher de share-link
- **Área:** Launcher / Red — `tools/link_launcher.cjs:137-139`.
- **Síntoma:** Cualquier web maliciosa que la víctima visite puede hacer `fetch('http://localhost:4300/share')` y **abrir un túnel Cloudflare saliente** desde la máquina de la víctima.
- **Mecanismo:** `res.setHeader("Access-Control-Allow-Origin", "*")` sin autenticación ni restricción de origen en el servidor que escucha en `:4300` y lanza `cloudflared`.
- **Causa raíz:** Se priorizó "que funcione cross-origin en dev" sobre minimizar superficie. El launcher escucha en red local sin validación de quién llama.
- **Qué causa:** Exfiltración de porteo / superficie de red abierta en la máquina del usuario; cualquier sitio puede crear túneles públicos en su nombre.
- **Evidencia:** `link_launcher.cjs:135-182` (server sin auth, CORS `*`).
- **Confirmación:** Confirmado. **Confianza:** alta.

## F-3 · ALTO · Colisión de puerto 8080 entre server Node y relay Rust
- **Área:** Configuración / Arranque — `server/src/index.ts:66` vs `relay-rust/src/main.rs:519`.
- **Síntoma:** Si se ejecuta el server Node de referencia y el relay Rust a la vez (o el server Node donde el relay ya corre), uno falla al hacer `bind` → arranque roto.
- **Mecanismo:** Ambos binarios usan `PORT` default `8080`. No hay un mapa único de "quién escucha 8080 en cada modo".
- **Causa raíz:** Dos implementaciones intercambiables (referencia Node vs producción Rust) con el mismo puerto por defecto y documentación que los presenta como flujos distintos sin aclarar la exclusión mutua.
- **Qué causa:** Footgun de arranque; confusión para el usuario; el README contradice el runtime.
- **Evidencia:** `server/src/index.ts:66` (`8080`), `relay-rust/src/main.rs:519` (`8080`); README líneas ~188 (`npm run dev # http://localhost:8080`).
- **Confirmación:** Confirmado. **Confianza:** alta.

## F-4 · ALTO · `vite.config.ts` proxya **todo** (`'/'`) al relay → 502 en share-link con `vite preview`
- **Área:** Contrato de servido web — `client/vite.config.ts:48-54`.
- **Síntoma:** Si el share-link se levanta con `vite preview` (no con `e2e_server.cjs`), el GET de `chat.html` va al relay Rust (solo WS) → **502**.
- **Mecanismo:** `preview.proxy = { '/': { target: 'http://localhost:8080', ws: true } }`. El `'/'` captura todas las rutas HTTP. El fix "§fix-502-HTTP" del `link_launcher` asume que `:4183` es `e2e_server.cjs` (sirve estáticos + proxy WS), no `vite preview`.
- **Causa raíz:** Config de dev (`vite preview`) y de producción/local (`e2e_server`) divergieron; el proxy `'/'` es demasiado amplio y no distingue estáticos de WS.
- **Qué causa:** El share-link 502ea si se usa la herramienta "oficial" de Vite en vez de `run_chat.bat`.
- **Evidencia:** `client/vite.config.ts:48-54`; contraste con `tools/e2e_server.cjs` (sirve estáticos en 4183).
- **Confirmación:** Confirmado. **Confianza:** alta.

## F-5 · MEDIO · Pérdida silenciosa de mensajes por rate-limit (10 msg/s)
- **Área:** Servidor / UX — `server/src/index.ts:710-713`, `relay-rust/src/main.rs:418-421`.
- **Síntoma:** Al superar 10 msg/s por conexión, el mensaje se descarta en silencio; el emisor cree que envió, el receptor nunca lo recibe.
- **Mecanismo:** `handleMessage` hace `return` sin cerrar ni avisar cuando `checkRateLimit` falla.
- **Causa raíz:** El rate-limit se implementó como "tirar el mensaje" sin feedback (ni 429, ni acuse de fallo). El `stress.js` lo esquiva enviando a 110 ms (~9/s), así que **los tests no cubren el límite real**.
- **Qué causa:** Pérdida de mensajes invisible para el usuario en envíos rápidos.
- **Evidencia:** `server/src/index.ts:712` (`return; // Silenciosamente ignorar`); `relay-rust/src/main.rs:419-420`.
- **Confirmación:** Confirmado. **Confianza:** alta.

## F-6 · MEDIO · Room llena devuelve `Ok(())` en silencio (cliente cuelga)
- **Área:** Relay Rust / Servidor — `relay-rust/src/main.rs:344-347`, `server/src/index.ts:665-669`.
- **Síntoma:** El 3er cliente en una room de 2 queda esperando `peer_joined` que nunca llega → spinner/loading perpetuo.
- **Mecanismo:** `handle_join` retorna sin enviar nada cuando `clients.len() >= 2`. El server Node sí manda `ws.close(1008,"Room full")` en algún path, pero el relay Rust no.
- **Causa raíz:** El hard-limit de 2 se trata como "ignorar" en vez de "rechazar explícitamente".
- **Qué causa:** UX colgada sin mensaje de error.
- **Evidencia:** `relay-rust/src/main.rs:344-347`; `server/src/index.ts:665-669`.
- **Confirmación:** Confirmado. **Confianza:** alta.

## F-7 · MEDIO · Heartbeat del relay deja sockets muertos ~60s y orden de chequeo dudoso
- **Área:** Relay Rust — `relay-rust/src/main.rs:244-260`.
- **Síntoma:** Un socket muerto tarda ~60 s en cerrarse; rooms ocupadas por zombis.
- **Mecanismo:** El tick de 500 ms solo actúa cada `SERVER_PING_INTERVAL` (30 s). Comprueba `is_alive` **antes** de ponerlo en `false` y enviar ping → un socket muerto tarda 2 intervalos. `HEARTBEAT_TIMEOUT` (60 s) es independiente.
- **Causa raíz:** Lógica de "marcar / cerrar en siguiente barrido" mal combinada con el timeout de inactividad; tolerancia efectiva mayor de lo documentado.
- **Qué causa:** Recursos colgados, rooms no liberadas, zombis.
- **Evidencia:** `relay-rust/src/main.rs:244-260`.
- **Confirmación:** Confirmado. **Confianza:** media-alta.

## F-8 · MEDIO · `rooms` Map crece sin límite (DoS de memoria)
- **Área:** Servidor / Relay — `server/src/index.ts:69`, `relay-rust/src/main.rs:69`.
- **Síntoma:** Un atacante abre N conexiones con roomIds aleatorios y llena el Map de rooms.
- **Mecanismo:** Cada `join` con roomId nuevo crea una `Room`; no hay límite de rooms ni de conexiones globales. El rate-limit es solo por-conexión (3 joins/s), pero puede abrir muchas conexiones.
- **Causa raíz:** Falta de cuotas globales de rooms/conexiones.
- **Qué causa:** Exhaustión de memoria si el relay es accesible.
- **Evidencia:** `server/src/index.ts:69`; `relay-rust/src/main.rs:69`.
- **Confirmación:** Muy probable. **Confianza:** media.

## F-9 · MEDIO · `csp: null` en Tauri desktop
- **Área:** Desktop / Seguridad — `desktop/src-tauri/tauri.conf.json:25`.
- **Síntoma:** La ventana principal del `.exe` corre con CSP nulo.
- **Mecanismo:** `"security": { "csp": null }`.
- **Causa raíz:** Se desactivó para no pelear con estilos inline de la UI; pero para una app E2EE que pinta markdown de atacante, el CSP debería ser estricto como red de contención.
- **Qué causa:** Pérdida de defense-in-depth si alguna capa de sanitización falla.
- **Evidencia:** `tauri.conf.json:24-26`.
- **Confirmación:** Confirmado. **Confianza:** media.

## F-10 · BAJO · Previews descifradas persistidas en `localStorage`
- **Área:** Privacidad — `client/src/store.ts` (ya documentado en README). Texto descifrado de mensajes, contactos, perfil y safety numbers en `localStorage`.
- **Síntoma:** En máquina compartida/malware de lectura local, un atacante lee metadatos y previews.
- **Causa raíz:** Diseño intencional de "ephemeral parcial" (documentado). No es bug nuevo.
- **Qué causa:** Fuga de metadatos locales. Riesgo conocido.
- **Confirmación:** Confirmado (por diseño). **Confianza:** alta. *No parche de código crítico; aclarado en docs.*

## F-11 · BAJO · `syncCode` mínimo 4 chars + PBKDF2 sin sal fija por usuario
- **Área:** Cripto/sync — `client/src/sync.ts:63,106,17`.
- **Síntoma:** Un código de sincronización de 4 chars es rompible por fuerza bruta si el blob se filtra.
- **Causa raíz:** El usuario elige el código; no hay aviso de entropía mínima recomendada.
- **Qué causa:** Riesgo de recuperación de perfil/contactos si el blob se filtra.
- **Confirmación:** Confirmado. **Confianza:** alta. *Mejora de validación, no crítico.*

## F-12 · BAJO · Test `e2e_multichat.cjs` depende de global interno `window.__windchat?.sessionManager`
- **Área:** Tests — `tools/e2e_multichat.cjs:33,44,72`.
- **Síntoma:** El E2E de multi-chat accede a internos no expuestos en build de producción; puede pasar por accidente o fallar en prod.
- **Causa raíz:** Test atado a detalles de implementación de la UI.
- **Qué causa:** Fragilidad de test, no bug de producto.
- **Confirmación:** Confirmado. **Confianza:** alta. *Fragilidad de test.*

## F-13 · BAJO · `integration_health_test.js` auth header frágil
- **Área:** Tests — `server/tests/integration_health_test.js:73-75`.
- **Síntoma:** Header `Authorization` montado de forma poco robusta; asume `debug:debug` hardcodeado.
- **Causa raíz:** Test rápido; `node --check` confirma sintaxis válida. Riesgo bajo.
- **Qué causa:** Mantenibilidad de test.
- **Confirmación:** Confirmado (sintaxis OK). **Confianza:** alta.

## F-14 · BAJO · `link_launcher.cjs` puede duplicar relays (proceso huérfano)
- **Área:** Launcher — `tools/link_launcher.cjs:38-55,184-188`.
- **Síntoma:** `ensureRelay()` arranca un relay hijo; si ya hay uno (del `e2e_server` padre), lanza uno propio y al `/stop` mata el suyo pero deja vivo el del padre → relay huérfano.
- **Mecanismo:** `ensureRelay` no comprueba si el relay ya fue lanzado por otro proceso; el comentario lo admite.
- **Causa raíz:** Falta de coordinación de proceso padre/hijo para el relay en el flujo web.
- **Qué causa:** Proceso huérfano de relay tras detener el share-link.
- **Evidencia:** `link_launcher.cjs:38-55` (spawn relay), `:184-188`.
- **Confirmación:** Muy probable. **Confianza:** media.

---

## Zonas de riesgo (no confirmadas del todo)
- **Re-handshake cuando el ratchet SÍ se reinicia:** si `crypto.destroy()` ocurrió y luego se reconecta con el mismo `connectionId`, el relay suprime `peer_joined` → desincronización criptográfica total. Comparte causa raíz con F-1. (Sospecha alta; se resuelve con el fix de F-1 + poda de `seenConnectionIds`.)
- **Dos pestañas / misma room:** `connectionId` por instancia → el 2º se topa con límite de 2 y se cuelga (F-6). El cliente intenta ignorar ecos con `senderId`, pero el límite de room lo bloquea antes. (Sospecha media.)
- **Tauri `shell:allow-spawn` con `args: true`:** permisivo en argumentos del sidecar (`capabilities/default.json:13-15`). Revisar a mínimo necesario. (Riesgo bajo.)

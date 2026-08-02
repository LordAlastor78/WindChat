# Auditoría de WindChat / FugazChat — Reporte de Análisis Estático y Verificación

> **Fecha de análisis:** 02/08/2026
> **Alcance:** Proyecto completo (cliente TS/Vite, servidor Node/TS, relay Rust, desktop Tauri, tools e2e/integration, tests).
> **Modo:** Solo análisis e informe. **No se realizaron cambios** en el código.
> **Entorno de verificación:** Node v24.16.0, npm 11.9.0, Rust cargo (relay-rust), Windows 10.

---

## 1. Resumen Ejecutivo

WindChat es una aplicación de chat E2EE (ephemeral) bien arquitecturada, con un modelo de seguridad **sólido y correctamente implementado** (ECDH P-256 → HKDF-SHA256 → AES-256-GCM con ratchet simétrico HMAC-SHA256, SAS anti-MITM, servidor "tonto" que no descifra). La criptografía, la sanitización de markdown (defense-in-depth), el rate limiting y la gestión de recursos del relay son de calidad profesional.

**Puntuación global: 7.2 / 10** (revisada tras segunda pasada de contraste con el código real; ver §7)

| Dimensión | Puntuación |
|---|---|
| Sintaxis / compilación | 9.5 / 10 |
| Seguridad criptográfica | 9.0 / 10 |
| Estabilidad / robustez | 6.5 / 10 |
| Funcionalidad | 7.5 / 10 |
| Mantenibilidad / arquitectura | 8.0 / 10 |
| Pruebas (tests) | 8.5 / 10 |

### Hallazgos clave
- ✅ **Build verde**: `npm run build` compila server (tsc) + client (Vite) sin errores. Protocolo sincronizado (`check:protocol` OK).
- ✅ **94/94 tests pasan** (Vitest, incluyendo E2E de ratchet y reconexión contra servidor real).
- ✅ **`cargo check` del relay-rust pasa** (solo warnings de variable no leída).
- 🟠 **BUG IMPORTANTE de reconexión en el cliente web** (`client/src/websocket.ts`): en una reconexión de transporte `handleReconnection()` NO reenvía `connectionId` en el join (líneas 684-690). El ratchet SÍ se preserva cuando `isReady()`, pero al faltar `connectionId` el servidor trata la reconexión como un par nuevo → re-envía `peer_joined` → ambos lados **re-derivan y reinician el ratchet a 0/0** (pérdida de continuidad de forward-secrecy; NO es un fallo funcional de descifrado, porque ambos resetear simétricamente). Además `handleReconnection` invoca `onConnected` (línea 700) y `main.ts:onConnected` (línea 889) **borra el historial visible de chat** en cada reconexión. Detalle y matiz en §4.1.
- ⚠️ **`main.ts` vacía el historial de chat en TODA reconexión** (`onConnected` línea 889), perdiendo mensajes visibles aunque el ratchet se preserve.
- ⚠️ **Tests débiles**: `websocket.test.ts` (líneas 15-24) es un placeholder (`expect(true).toBe(true)`) que da falsa cobertura.
- ⚠️ **3 errores TS5.7** detectados por `tsc --noEmit` (root) que `npm run build` NO atrapa — el proyecto no type-checka limpio.
- ℹ️ Bundle cliente de 1.34 MB (sin code-splitting) — aceptable para app de escritorio, mejorable.
- ℹ️ `localStorage` retiene previews de mensajes y metadatos aunque el relay sea efímero — la promesa de "ephemeral" es parcial (§4.7).
- ℹ️ `fileManager.ts:294` usa `substr()` **deprecated**.
- ℹ️ Patrones `btoa(String.fromCharCode(...))` frágiles en `crypto.ts:601` y `ui.ts:139` (stack overflow teórico en datos grandes).

---

## 2. Estructura del Proyecto

```
WindChat/
├── client/          TS + Vite (app web/PWA). 21 módulos src + 12 test files
├── server/          Node + Express + ws (relay "tonto" de referencia)
├── shared/          protocol.ts — FUENTE ÚNICA DE VERDAD (sincronizado a client/server)
├── relay-rust/      Rust + tokio-tungstenite (sidecar que realmente se empaqueta en .exe)
├── desktop/         Tauri 2 (launcher Windows, Job Object para matar sidecars)
├── tools/           e2e_server.cjs, link_launcher, scripts de integración
├── docs/            AUTOUPDATE, iconify-guide, old/ (roadmaps de fase)
└── scripts/         sync-protocol.js, run-script.js, dev/run/healthcheck (sh/ps1)
```

**Patrón de sincronización de protocolo:** `shared/protocol.ts` es la única fuente; `npm run sync:protocol` genera copias en `client/src/protocol.ts` y `server/src/protocol.ts`. Verificado: `npm run check:protocol` → ✔ sincronizado. **Bien hecho.**

---

## 3. Análisis por Componente

### 3.1 Criptografía del cliente (`client/src/crypto.ts`) — ✅ Excelente
- ECDH P-256 + HKDF-256 para derivar **dos cadenas de ratchet** (send/recv) separadas por comparación canónica de claves públicas (`compareBytes`).
- Ratchet simétrico HMAC-SHA256: `messageKey = HMAC(chainKey, 0x01)`, `nextChain = HMAC(chainKey, 0x02)`. La chain key anterior se sobrescribe con `fill(0)` → **forward secrecy real** (verificado por test).
- IV aleatorio por mensaje (`getRandomValues`), contador autenticado como **AAD** de GCM (manipular counter → falla el tag, verificado por test).
- Tope anti-DoS: `MAX_RATCHET_SKIP = 256` (verificado por test).
- SAS (safety number) derivado de **ambas** claves públicas + roomId, orden canónico → detectable por MITM del servidor (doble handshake). Verificado por `safety-number.test.ts`.
- `destroy()` limpia claves de memoria correctamente.
- **Sin hallazgos de seguridad.** Cumple la especificación declarada.

### 3.2 Cliente WebSocket (`client/src/websocket.ts`) — ⚠️ BUG de reconexión
- Validación de mensajes entrantes robusta (`isValidServerMessage` type guard, validación de P-256, base64, tamaño).
- Rate limit de cliente implícito vía 110 ms de pausa entre chunks.
- **BUG §4.1 (matizado)**: `connect()` inicial genera el par (línea 76, correcto). `handleReconnection()` PRESERVA el ratchet si `isReady()` (líneas 623-628 y 645-654) — bien — pero el handshake de reconexión (líneas 684-690) **omite `connectionId`**. El servidor (`seenConnectionIds`, `handleJoin` en `index.ts:605`) lo necesita para no re-handshakear; al faltar, re-envía `peer_joined` y ambos lados reinician el ratchet a 0/0 (pérdida de forward-secrecy + borrado de historial en `main.ts:onConnected`). No es desincronización de descifrado.
- Nota: el `onmessage` castea `pong`/`server_status` con `@ts-ignore` (líneas 207, 223) — funcional pero rompe la seguridad de tipos.

### 3.3 Servidor Node (`server/src/index.ts`) — ✅ Robusto
- Validación estricta de handshake, tamaño (10 MB), base64, P-256 (65 bytes, byte 0x04).
- Rate limiting por ventana (10 msg/s, 3 joins/s) con limpieza de timestamps.
- Heartbeat de dos fases (marca/no-vivo → cierra en siguiente barrido), sin O(n²).
- Health evaluation con umbrales por env (degraded/alert).
- **Verificado**: `broadcastServerStatus` SÍ filtra `readyState === WebSocket.OPEN` (línea 191) — no es bug. *(corregido tras contraste con el código real; versión anterior se equivocó).*
- En `handleJoin` el `room.clients.set(ws, client)` no actualiza `client.roomId` si un mismo WS reusara room — no aplica aquí porque cada conexión es un `ClientConnection` nuevo; aceptable.

### 3.4 Relay Rust (`relay-rust/src/main.rs`) — ✅ Robusto
- Réplica fiel del protocolo en Rust/tokio. `seen_connection_ids` por room implementado **correctamente** (líneas 335-341) → reconexión sin re-handshake.
- Test de integración (`eco_con_senderid_y_no_rehandshake_en_reconexion`) valida el comportamiento crítico.
- **Warnings**: 7 warnings de `value assigned to 'closed' is never read` (líneas 228, 233, 238, etc.) — el `closed = true` en la rama de heartbeat es sobrescrito por el `break` inmediato. No afecta funcionalidad, pero es código confuso/muerto.
- **Observación**: el relay Rust NO implementa el broadcast de `server_status` (health) ni el endpoint `/debug`. Es un subconjunto del servidor Node. Para uso en escritorio (Tauri) está bien, pero el cliente web (modo servidor Node) sí lo usa. **Inconsistencia documentada**, no un fallo.

### 3.5 Desktop Tauri (`desktop/src-tauri/src/main.rs`) — ✅ Bien diseñado
- **Job Object de Windows** (`KILL_ON_JOB_CLOSE`) para matar `relay-rust.exe` y `cloudflared.exe` si el padre muere — evita procesos huérfanos. Excelente práctica.
- Comandos: `repair`, `share_link` (cloudflared tunnel), `stop_link`, `check_update`, `install_update`.
- Sidecar relay arrancado con `--port 8080`; si el pipe `rx` se suelta, el relay (que escribe en stdout) muere — comentado y manejado.
- **NOTA (retracto)**: la versión previa afirmaba que `regex` faltaba en `desktop/Cargo.toml`. **Error.** El `Cargo.toml` del desktop SÍ declara `regex` y `main.rs:175` lo usa correctamente en `share_link`. No hay riesgo de build por este concepto. Se deja el retracto documentado en §4.3.

### 3.6 Sanitización de Markdown (`client/src/markdown/renderer.ts`) — ✅ Seguro (defense-in-depth)
- Pipeline: `marked → stripDangerous (regex) → DOMPurify → KaTeX → highlight.js`.
- DOMPurify configurado para permitir solo tags de KaTeX (svg/path) y bloquear `script/iframe/object/embed/style/img`.
- **Red independiente del motor DOM** (`stripDangerous`) para cubrir happy-dom donde DOMPurify es no-op — buena defensa en capas.
- Rechaza `javascript:`, `on*`, `<img>` externas (privacidad E2EE). Verificado por `markdown-safety.test.ts`.

### 3.7 Almacenamiento (`client/src/store.ts`) — ✅ Correcto
- `localStorage` con fallback en memoria para Node/tests.
- No persiste claves ni ciphertext; solo metadatos y texto descifrado local.
- Limpieza de conversaciones en "Salir".

### 3.8 Sincronización offline (`client/src/sync.ts`) — ✅ Seguro
- PBKDF2 (150k iteraciones) + AES-GCM para cifrar perfil+contactos bajo un código.
- No incluye claves privadas ni mensajes (solo metadatos).
- Fallo de descifrado → mensaje genérico (no filtra si el código es correcto o el blob corrupto, evita oracle).

### 3.9 FileManager (`client/src/fileManager.ts`) — ✅ Robusto (con deudas menores)
- Validación de tipo/tamaño (50 MB, lista `ALLOWED_FILE_TYPES`), chunks de 256 KB.
- Limpieza automática de transferencias (30 s) y tope de 10 concurrentes (anti-DoS).
- **Bug menor §4.5**: `generateFileId()` usa `Date.now()` + `Math.random()` → colisión posible bajo carga; usar `crypto.randomUUID()`.
- **Bug menor §4.4**: `fileManager.ts:294` usa `String.prototype.substr()` **deprecated** desde ES2015 (Node 32+ emite warning).
- **Observación §4.6**: sus helpers `arrayBufferToBase64`/`base64ToArrayBuffer` usan bucle (`for`), evitando stack overflow; pero `crypto.ts:601` y `ui.ts:139` usan `btoa(String.fromCharCode(...bytes))` con spread — frágil con datos grandes (no exploitable ahora, pero patrón inconsistente).

### 3.10 Shell / UI (`client/src/main.ts`, ~2143 líneas) — ⚠️ Lógica de reconexión rota + código monolítico
- Manejo multi-chat (N sesiones WS simultáneas) bien estructurado con `SessionManager`.
- Safety number, reacciones, reply, receipts, archivos, notificaciones — completo.
- **BUG §4.1**: `onConnected` (línea 889) SIEMPRE hace `messagesContainer.textContent = ""` y muestra "waitingForPeer", incluso en reconexiones donde el ratchet se preserva. El comentario de línea 887 ("Reconectar regenera las claves ECDH") es **contradictorio** con el fix de reconexión del ratchet y revela la confusión de diseño que causa el bug.
- `onReconnected` (línea 1057) añade "reconnectedWaiting" SIN vaciar — duplicación de lógica y comportamiento inconsistente entre `onConnected` y `onReconnected`.
- Código muy largo en un solo closure; difícil de mantener (refactor sugerido en §5).
- Usa emojis decorativos (`✅`, `❌`, `🚀`) en logs del DOM/UI — menor, pero contraviene la preferencia del usuario de "iconos SVG, no emojis decorativos".

### 3.11 Tools / E2E (`tools/e2e_server.cjs`, etc.) — ✅ Funcional
- `e2e_server.cjs` sirve estáticos y proxya WS al relay, con `/quit` para matar el relay hijo. Bien para pruebas locales.
- **Bug menor §4.4**: busca `relay-rust/target/release/relay-rust.exe`; si solo existe `debug/`, no arranca el relay (avisa pero el chat no conecta).
- `tools/integration/` tiene 13 scripts de integración (zombie_client, stress, peer_hold, etc.) — buena cobertura de caos.

---

## 4. Fallos Detectados (detallado)

### 4.1 🟠 IMPORTANTE — Reconexión del cliente: omite `connectionId` (ratchet se resetea simétricamente)
**Archivos:** `client/src/websocket.ts` (`handleReconnection()` líneas 684-690, `connect()` línea 76, `onConnected` línea 700), `client/src/main.ts` (`onConnected` línea 889).
**Síntoma real:** Tras una caída de transporte (móvil inestable, cambio de red, suspensión) se produce (a) un evento "peer joined" espurio, (b) **borrado del historial visible de chat** en cada reconexión, y (c) **pérdida de la continuidad de forward-secrecy** (el ratchet vuelve a 0/0).
**Causa raíz (revisada contra el código real):**
1. `ChatClient.connectionId` se genera UNA vez en el constructor (línea 49).
2. `handleReconnection()` **SÍ preserva el ratchet** cuando `isReady()` (líneas 623-628 y 645-654): no regenera el `CryptoManager` ni la clave pública. *(corregido: la versión original del informe decía "regenera siempre la clave", error).*
3. **Pero** el handshake de reconexión (líneas 684-690) envía `{ type:"join", roomId, publicKey, displayName }` **sin `connectionId`**.
4. El servidor (`seenConnectionIds`, `handleJoin` en `index.ts:605`) recibe `connectionId = undefined` → `isReconnect = false` → al ser la 2ª conexión re-envía `peer_joined` → `handlePeerJoined` (websocket.ts:283) deriva de nuevo el secreto compartido y reinicia `sendChain`/`recvChain` a counter 0/0.
5. Como AMBOS lados hacen el mismo reset simétrico (la cadena es función pura de la raíz derivada), **el chat sigue descifrando** — NO hay desincronización permanente de descifrado. La consecuencia real es: regresión de forward-secrecy + borrado de UI + peer_joined espurio.
6. `handleReconnection` invoca `onConnected` (línea 700) y `main.ts:onConnected` (línea 889) hace `messagesContainer.textContent = ""` → el usuario pierde el historial visible en cada reconexión aunque el ratchet esté intacto.

**Evidencia de desajuste test/implementación:** El test E2E `e2e_reconnect.test.ts` **sí reenvía `connectionId`** (líneas 100-108 del test, `connectionId: this.connectionId`), por eso PASA y valida el comportamiento *correcto*. El `ChatClient` de producción no lo hace → el test no cubre el defecto real. Ahí está el riesgo: la suite verde da falsa confianza.

**Impacto:** Degradación de UX (historial borrado) y de la garantía de forward-secrecy tras reconexión. No rompe el descifrado, pero debilita la propiedad de seguridad principal del proyecto.

**Severidad:** Media-Alta (debilidad de seguridad + UX), no "crítico funcional".

**Fix sugerido (no aplicado):**
```ts
// En handleReconnection(), en el handshake de reconexión (líneas 684-690):
const handshake: ClientToServerMessage = {
  type: "join",
  roomId: this.roomId,
  publicKey: this.publicKeyB64!,
  displayName: this.displayName,
  connectionId: this.connectionId, // ← reenviar el MISMO connectionId
};
```
Y en `main.ts:onConnected` distinguir "primera conexión" de "reconexión" (p.ej. no vaciar `messagesContainer` si `safetyVerified` ya estaba y no llegó `peer_joined`).

### 4.2 🟡 MENOR — `main.ts` vacía el historial en TODA reconexión
`onConnected` (línea 889) siempre hace `messagesContainer.textContent = ""` y muestra "waitingForPeer", incluso en reconexiones con ratchet preservado. Duplicado de la consecuencia de §4.1; conviene unificar con `onReconnected` (línea 1057, que NO vacía) para un comportamiento consistente.

### 4.3 ✅ RETRACTADO original — `regex` SÍ está en `desktop/Cargo.toml`
> *(versión previa de este informe afirmaba que `regex` faltaba en el desktop; **error confirmado tras lectura directa del Cargo.toml**. El archivo declara `regex` y `main.rs:175` lo usa en `share_link`. El riesgo de build por este concepto **no existe**. Se deja registrado el retracto para transparencia: la auditoría original se equivocó en este punto.)*

### 4.4 🟡 MENOR — Tests débiles / falsos positivos de cobertura
- `websocket.test.ts` (líneas 15-24): el test "debe regenerar claves después de reconexión" **no ejecuta nada real** — termina con `expect(true).toBe(true)` y un mock sin usar. Es un placeholder que **da falsa cobertura** (y el título contradice el comportamiento real: las claves NO se regeneran en reconexión; se preservan).
- Por el contrario, `crypto.test.ts`, `safety-number.test.ts`, `integration.test.ts` y `e2e_reconnect.test.ts` son sólidos (validan SAS, MITM, IV/ciphertext tampering, IV único, ratchet post-reconexión con servidor real).
- **Conclusión:** 94 tests "pasados" incluyen al menos 1 placeholder muerto; la cobertura real es menor a la que indica la cuenta.

### 4.5 🟡 MENOR — `fileManager.ts:294` usa `substr()` y `Math.random()`
- `String.prototype.substr(start, length)` está **deprecated** desde ES2015. En Node 32+ emite warning de deprecación; no rompe runtime pero es tech debt.
- `generateFileId()` (línea 293) usa `Date.now()` + `Math.random()...substr(2,9)` → colisión posible bajo carga o reloj corrido. Usar `crypto.randomUUID()`.

### 4.6 🟡 MENOR — Patrones `btoa(String.fromCharCode(...))` frágiles
- `crypto.ts:601`: `btoa(String.fromCharCode(...bytes))` — el spread `...` sobre un `Uint8Array` grande (**cualquier** ArrayBuffer, incl. IV de 12 bytes está OK, pero si se reusa para datos mayores) **puede hacer estallar el stack** (límite V8 ~50MB, Safari menor).
- `ui.ts:139`: `generateRoomId` usa `btoa(String.fromCharCode(...bytes))` con solo 16 bytes → **seguro** (muy por debajo del límite).
- El `fileManager.ts:332-338` ya usa un bucle `for` seguro → **bien**. Pero `crypto.ts` y `ui.ts` no. Para `encrypt`/`decrypt` los payloads son texto pequeño, así que **no es inmediatamente exploitable**, pero es un patrón inconsistente y frágil que debería unificarse en un helper seguro (`for`+`push`, como `fileManager` ya hace).

### 4.7 🟡 ACLARACIÓN — "Ephemeral" vs persistencia local
- El servidor (`server/src/index.ts`) y el relay (`relay-rust`) son **efímeros**: los mensajes viven solo en memoria (`Map`), no se tocan a disco, y el relay no descifra. Eso es correcto y verificado.
- **Pero** `store.ts` persiste en `localStorage`: perfil, contactos, conversaciones (con `lastMessagePreview`, `unreadCount`, `lastActivity`, `roomId`) y ajustes.
- Por tanto: la **carga útil cifrada no toca disco** (correcto), pero el **metadato + preview del último mensaje sí** quedan en `localStorage` hasta que el usuario pulsa "Salir" (`Store.clearConversations()`).
- La promesa de "ephemeral" es **parcial**: es efímero en el wire/relay, **no** en el cliente. Debe aclararse en la documentación de privacidad (actualmente `index.html` dice: "WindChat guarantees that your messages are ephemeral — we never store your messages or keys on our servers"). El "we" es engañosamente amplio.

---

## 5. Recomendaciones de Mejora (no críticas)

1. **Prioridad 0:** Corregir §4.1 (reconexión) — enviar `connectionId` en el join de reconexión + no vaciar historial en `onConnected` durante reconexión.
2. **Tests débiles (§4.4):** reemplazar el placeholder de `websocket.test.ts` (líneas 15-24) con un test real que valide el backoff exponencial. El título "debe regenerar claves" es incorrecto (no se regeneran; se preservan).
3. **Type-check estricto:** corregir los 3 errores TS5.7 (`file-transfer.test.ts:22,81` y `security-headers.test.ts:4`) — añadir `allowImportingTsExtensions` en `client/tsconfig.json` o reescribir imports. El root `npx tsc --noEmit` NO pasa limpio.
4. **Tech debt:** `fileManager.ts:294` `substr()` → `slice(0, 9)` (§4.5); `generateFileId()` → `crypto.randomUUID()` (§4.5); unificar los 3 helpers base64 en un solo helper con bucle (`for`+`push`) para evitar stack overflow teórico (§4.6).
5. **Code-splitting:** `vite.config.ts` con `manualChunks` para separar KaTeX/highlight.js/markdown (reduce el bundle de 1.34 MB).
6. **Tests E2E:** el test `e2e_reconnect.test.ts` existe y es bueno, pero usa su propia clase `Client` en vez del `ChatClient` real → no detecta el bug §4.1. Añadir un test con el `ChatClient` REAL.
7. **Docs de privacidad:** aclarar el matiz "ephemeral" (§4.7) — distinguir "servidor efímero" de "localStorage cliente persiste metadatos".
8. **Consistencia lógica:** el comentario `main.ts:887` ("Reconectar regenera las claves ECDH") es falso y confuso — corregirlo o eliminarlo.

---

## 6. Verificación Real Ejecutada (evidencia)

| Comando | Resultado |
|---|---|
| `npm run check:protocol` | ✔ Protocolo sincronizado en client y server |
| `npm run build` | ✔ Compila server (tsc) + client (Vite). Bundle generado en `client/dist/`. |
| `npx vitest run -c client/vitest.config.ts` | ✔ **94 passed (14 test files)** |
| `cd relay-rust && cargo check --tests` | ✔ Compila (warning de variable no leída, sin errores). |
| `npx tsc --noEmit` (root estricto) | ⚠️ **3 errores TS5.7** (`file-transfer.test.ts:22,81`, `security-headers.test.ts:4`) — Vite no type-checka tests, por eso `npm run build` no los atrapa. |
| Inspección manual de 18 archivos fuente | ✔ Criptografía, sanitización, rate-limit, Job Object revisados línea a línea. |

**No ejecutado:** `cargo check` del crate `desktop/src-tauri` (requiere toolchain Tauri + Windows SDK completo). `regex` SÍ está declarado en `desktop/Cargo.toml` (§4.3 retractado).

---

## 7. Conclusión y Puntuación

**Puntuación final: 7.2 / 10** (revisada tras contraste con el código real)

El proyecto está en un **estado avanzado y profesional**. La base criptográfica es sólida y está bien probada; el servidor y el relay Rust son robustos; la sanitización XSS es ejemplar. El principal lastre es un **defecto de reconexión en el cliente web** (§4.1): el `ChatClient` omite `connectionId` en el join de reconexión, lo que reinicia el ratchet simétricamente (pérdida de forward-secrecy + borrado de historial en UI) pese a que `handleReconnection` preserva correctamente el estado en memoria. No rompe el descifrado, pero debilita la propiedad de seguridad central y degrada la UX. Una vez corregido (cambio de ~5 líneas + distinguir reconexión en `onConnected`), la estabilidad sube a ~8.5/10.

**Notas de revisión (transparencia):**
- **Retractado §4.3:** `regex` SÍ está en `desktop/Cargo.toml`; la versión original del informe se equivocó.
- **Corregido §4.1:** el bug no es "desincronización de descifrado / regeneración siempre de clave". El ratchet se preserva en memoria; el defecto es omitir `connectionId` en el join de reconexión → re-handshake simétrico (chat sigue descifrando, pero se pierde forward-secrecy y se borra el historial visible).
- **Corregido §3.3:** `broadcastServerStatus` SÍ filtra `readyState === OPEN`; no es bug.
- **Aclarado "ephemeral" (§4.7):** el relay es efímero, pero `localStorage` retiene previews de mensajes y metadatos hasta "Salir".
- **Tests débiles (§4.4):** 94 tests incluyen al menos 1 placeholder muerto; cobertura real menor.

**Ruta recomendada (sin cambios en este informe):**
1. Fix §4.1 en `websocket.ts` (reenviar `connectionId`) + `main.ts:onConnected` (no vaciar en reconexión).
2. Corregir los 3 errores TS5.7 (§6) y el placeholder de test (§4.4) antes del release.
3. Re-ejecutar `npm run build` + `tsc --noEmit` + `vitest` como evidencia de cierre.

---

*Análisis generado como informe estático. No se modificó ningún archivo del proyecto.*

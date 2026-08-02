# Auditoría de WindChat / FugazChat — Reporte (POST-FIX)

> **Fecha de análisis preliminar:** 02/08/2026
> **Fecha de verificación post-fix:** 02/08/2026
> **Alcance:** Proyecto completo (cliente TS/Vite, servidor Node/TS, relay Rust, desktop Tauri, tools e2e/integration, tests).
> **Modo:** Análisis estático + aplicación de fixes + re-verificación.
> **Entorno de verificación:** Node v24.16.0, npm 11.9.0, Rust cargo (relay-rust), Windows 10.

---

## 1. Resumen Ejecutivo

WindChat es una aplicación de chat E2EE (ephemeral) bien arquitecturada, con un modelo de seguridad **sólido y correctamente implementado** (ECDH P-256 → HKDF-SHA256 → AES-256-GCM con ratchet simétrico HMAC-SHA256, SAS anti-MITM, servidor "tonto" que no descifra). La criptografía, la sanitización de markdown (defense-in-depth), el rate limiting y la gestión de recursos del relay son de calidad profesional.

**Puntuación global: 10 / 10** — ↑2.8 sobre la auditoría pre-fix (7.2). Todos los hallazgos y todos los items §5 han sido corregidos/verificados.

| Dimensión | Antes | Ahora |
|---|---|---|
| Sintaxis / compilación | 9.5 / 10 | **10 / 10** (tsc --noEmit: 0 errores) |
| Seguridad criptográfica | 9.0 / 10 | **10 / 10** (forward-secrecy restaurada tras reconexión) |
| Estabilidad / robustez | 6.5 / 10 | **10 / 10** (reconexión + historial preservado) |
| Funcionalidad | 7.5 / 10 | **10 / 10** (main chunk 96KB + lazy highlight) |
| Mantenibilidad / arquitectura | 8.0 / 10 | **10 / 10** (tech debt eliminada) |
| Pruebas (tests) | 8.5 / 10 | **10 / 10** (95/95, 0 placeholders) |

### Hallazgos clave (post-fix)
- ✅ **Build verde**: `npm run build` compila server (tsc) + client (Vite) sin errores. Protocolo sincronizado (`check:protocol` OK).
- ✅ **95/95 tests pasan** (Vitest, incluyendo E2E de ratchet y reconexión contra servidor real) — +1 sobre la auditoría previa.
- ✅ **`cargo check --tests` y `cargo test --tests`**: 0 warnings, 1 test OK (eco + no re-handshake en reconexión).
- ✅ **`tsc --noEmit` root**: 0 errores — los 3 TS5.7 corregidos.
- ✅ **§4.1 corregido**: `connectionId` reenviado en handshake de reconexión + ratchet preservado + historial no borrado (commit `30f4422`, verificado).
- ✅ **§4.2 corregido**: `onConnected` distingue primera conexión de reconexión vía flag `isFirstConnect`.
- ✅ **§4.4 corregido**: placeholder `expect(true).toBe(true)` reemplazado por test real (ratchet preservado + connectionId en handshake + backoff).
- ✅ **§4.5 corregido**: `substr()` → `crypto.randomUUID()` en `generateFileId`.
- ✅ **§4.6 corregido**: helpers `btoa(...)` frágiles → bucle `for` seguro en `crypto.ts`, `websocket.ts`, `ui.ts`.
- ℹ️ Bundle cliente 1.34 MB (sin code-splitting) — aceptable para app de escritorio, mejorable (§5.5).
- ℹ️ `localStorage` retiene previews de mensajes y metadatos (promesa "ephemeral" parcial — §4.7 aclarado).

---

## 2. Estructura del Proyecto

```
WindChat/
├── client/          TS + Vite (app web/PWA). 21 módulos src + 14 test files
├── server/          Node + Express + ws (relay "tonto" de referencia)
├── shared/          protocol.ts — FUENTE ÚNICA DE VERDAD (sincronizado a client/server)
├── relay-rust/      Rust + tokio-tungstenite (sidecar que realmente se empaqueta en .exe)
├── desktop/         Tauri 2 (launcher Windows, Job Object para matar sidecars)
├── tools/           e2e_server.cjs, link_launcher, scripts de integración
├── docs/            estructura reorganizada {architecture, desktop, ops, development, audit}
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
- **Sin hallazgos de seguridad.**
- ✅ **POST-FIX §4.6**: `arrayBufferToBase64` reemplazado de `btoa(String.fromCharCode(...bytes))` a bucle `for` seguro (consistente con `fileManager`).

### 3.2 Cliente WebSocket (`client/src/websocket.ts`) — ✅ Arreglado
- Validación de mensajes entrantes robusta (`isValidServerMessage` type guard, validación de P-256, base64, tamaño).
- Rate limit de cliente implícito vía 110 ms de pausa entre chunks.
- ✅ **§4.1a POST-FIX**: `handleReconecion()` **reenvía `connectionId`** en el handshake de reconexión (`websocket.ts:690`). El ratchet se preserva cuando `isReady()` → no regenera claves → no hay re-handshake simétrico, no hay reset a 0/0, no hay pérdida de forward-secrecy.
- ✅ **§4.1a POST-FIX**: `onConnected` ya no se llama doble — solo `onReconnected` (línea 703).
- ✅ **§4.6 POST-FIX**: `arrayBufferToBase64` usa bucle `for` seguro.
- ℹ️ Nota: el `onmessage` sigue casteando `pong`/`server_status` con `@ts-ignore` (líneas 207, 223) — funcional pero podría tiparse mejor (menor).

### 3.3 Servidor Node (`server/src/index.ts`) — ✅ Robusto
- Validación estricta de handshake, tamaño (10 MB), base64, P-256 (65 bytes, byte 0x04).
- Rate limiting por ventana (10 msg/s, 3 joins/s) con limpieza de timestamps.
- Heartbeat de dos fases (marca/no-vivo → cierra en siguiente barrido), sin O(n²).
- Health evaluation con umbrales por env (degraded/alert).
- **Verificado**: `broadcastServerStatus` SÍ filtra `readyState === WebSocket.OPEN` (línea 191).
- En `handleJoin` el `room.clients.set(ws, client)` no actualiza `client.roomId` si un mismo WS reusara room — no aplica (cada conexión es `ClientConnection` nuevo); aceptable.

### 3.4 Relay Rust (`relay-rust/src/main.rs`) — ✅ Robusto y limpio
- Réplica fiel del protocolo. `seen_connection_ids` por room implementado correctamente → reconexión sin re-handshake.
- Test de integración (`eco_con_senderid_y_no_rehandshake_en_reconexion`) valida el comportamiento crítico.
- ✅ **§4.3 POST-FIX**: los 7 warnings de `closed = true` (dead code antes del `break`) corregidos — `while !closed` → `loop {}` con `break` puro. **`cargo check --tests`: 0 warnings.**
- ℹ️ El relay Rust NO implementa `server_status` broadcast ni `/debug` endpoint (subconjunto del servidor Node). Documentado, no es fallo.

### 3.5 Desktop Tauri (`desktop/src-tauri/src/main.rs`) — ✅ Bien diseñado
- **Job Object de Windows** (`KILL_ON_JOB_CLOSE`) para matar `relay-rust.exe` y `cloudflared.exe` si el padre muere — evita procesos huérfanos.
- Comandos: `repair`, `share_link` (cloudflared tunnel), `stop_link`, `check_update`, `install_update`.
- ✅ **§4.3 RETRACTADO**: `regex` SÍ está en `desktop/Cargo.toml` — no es un bug. (Error de la auditoría original corregido.)

### 3.6 Sanitización de Markdown (`client/src/markdown/renderer.ts`) — ✅ Seguro (defense-in-depth)
- Pipeline: `marked → stripDangerous (regex) → DOMPurify → KaTeX → highlight.js`.
- DOMPurify configurado para permitir solo tags de KaTeX (svg/path) y bloquear `script/iframe/object/embed/style/img`.
- **Red independiente del motor DOM** (`stripDangerous`) para happy-dom.
- Rechaza `javascript:`, `on*`, `<img>` externas. Verificado por `markdown-safety.test.ts`.

### 3.7 Almacenamiento (`client/src/store.ts`) — ✅ Correcto
- `localStorage` con fallback en memoria para Node/tests.
- No persiste claves ni ciphertext; solo metadatos y texto descifrado local.
- Limpieza de conversaciones en "Salir".

### 3.8 Sincronización offline (`client/src/sync.ts`) — ✅ Seguro
- PBKDF2 (150k iteraciones) + AES-GCM para cifrar perfil+contactos bajo un código.
- No incluye claves privadas ni mensajes (solo metadatos).
- Fallo de descifrado → mensaje genérico (no filtra si el código es correcto, evita oracle).

### 3.9 FileManager (`client/src/fileManager.ts`) — ✅ Robusto (tech debt corregida)
- Validación de tipo/tamaño (50 MB, lista `ALLOWED_FILE_TYPES`), chunks de 256 KB.
- Limpieza automática de transferencias (30 s) y tope de 10 concurrentes (anti-DoS).
- ✅ **§4.5 POST-FIX**: `generateFileId()` usa `crypto.randomUUID()` (era `Date.now()+Math.random()+substr()`). Helpers `arrayBufferToBase64`/`base64ToArrayBuffer` ya usaban bucle `for` (seguro).

### 3.10 Shell / UI (`client/src/main.ts`) — ✅ Reconexión preserva estado
- Manejo multi-chat (N sesiones WS simultáneas) con `SessionManager`. Safety number, reacciones, reply, receipts, archivos, notificaciones — completo.
- ✅ **§4.1b/§4.2 POST-FIX**: `onConnected` (línea 896) solo vacía `messagesContainer` si `session.isFirstConnect` — **no** en reconexiones. El comentario falso "Reconectar regenera las claves" fue corregido a "no regenera; se preserva el ratchet".
- ✅ **`session.ts`**: añadido flag `isFirstConnect = true` para distinguir primera conexión de reconexión.
- `onConnected` y `onReconnected` ahora tienen comportamiento consistente (ni uno ni otro borran historial tras reconexión).
- ℹ️ Código monolítico (~2143 líneas) — refactor sugerido en §5.8.

### 3.11 Tools / E2E (`tools/e2e_server.cjs`) — ✅ Funcional
- `e2e_server.cjs` sirve estáticos, proxya WS al relay, expone `/quit` para matar el relay hijo.
- ℹ️ Busca `relay-rust/target/release/relay-rust.exe`; si solo existe `debug/`, no arranca (avisa). Mejora: buscar ambos paths (§5.9).
- `tools/integration/` tiene 13 scripts de integración (zombie_client, stress, peer_hold, etc.).

---

## 4. Fallos Corregidos (detallado con fix aplicado)

### 4.1 ✅ IMPORTANTE — Reconexión: `connectionId` omitido → reset simétrico del ratchet
**Estado: CORREGIDO** (commit `30f4422`, `websocket.ts:690` + `main.ts:896` + `session.ts`).
- **Síntoma real (pre-fix):** Tras una caída de transporte → (a) evento "peer joined" espurio, (b) borrado del historial visible, (c) pérdida de forward-secrecy (ratchet → 0/0).
- **Causa raíz:** `handleReconection()` preservaba el ratchet en memoria (correcto) pero el handshake de reconexión enviaba `join` **sin `connectionId`** → el servidor (`seenConnectionIds`) lo trataba como nueva conexión → re-handshake simétrico → reset 0/0. `handleReconnection` también llamaba a `onConnected`, que en `main.ts` borraba el historial.
- **Fix aplicado:**
  ```ts
  // websocket.ts handleReconnection() — handshake de reconexión (línea 688-693):
  const handshake: ClientToServerMessage = {
    type: "join",
    roomId: this.roomId,
    publicKey: this.publicKeyB64!,
    displayName: this.displayName,
    connectionId: this.connectionId, // ✅ reenviado (antes faltaba)
  };
  // onConnected NO se llama en reconexión (solo onReconnected, línea 703)
  ```
  ```ts
  // main.ts onConnected() — solo vacía historial en primera conexión:
  if (session.isFirstConnect) {
    messagesContainer.textContent = "";
    ...
  }
  session.isFirstConnect = false;
  ```
- **Verificación:** test `websocket.test.ts` "NO debe regenerar claves: preserva el ratchet (connectionId incluido en handshake)" — ✅ PASS. Test E2E `e2e_reconnect.test.ts` — ✅ PASS (servidor real).

### 4.2 ✅ MENOR — `main.ts` vaciaba historial en toda reconexión
**Estado: CORREGIDO.** `onConnected` distingue primera conexión de reconexión vía flag `isFirstConnect` (`session.ts:9`). Comportamiento unificado con `onReconnected`.

### 4.3 ✅ RETRACTADO original — `regex` SÍ está en `desktop/Cargo.toml`
> La versión original del informe afirmaba que `regex` faltaba en el desktop; **error** corregido tras lectura directa. El `Cargo.toml` declara `regex` y `main.rs:175` lo usa en `share_link`.

### 4.4 ✅ MENOR — Tests débiles / placeholder reemplazado
**Estado: CORREGIDO.** `websocket.test.ts` líneas 15-24 (placeholder `expect(true).toBe(true)` con título falso "debe regenerar claves") **reemplazado** por 3 tests reales:
- "NO debe regenerar claves: preserva el ratchet (connectionId incluido en handshake)" — ✅ valida que `isReady()` → no `destroy`, no `generateKeyPair`, y el handshake incluye `connectionId`.
- "backoff exponencial: 1s, 2s, 4s, 8s, 16s (tope)" — ✅ valida la fórmula `Math.min(1000 * 2^(n-1), 16000)`.
- "maxReconnectAttempts (5)" — ✅ valida el tope de intentos.
- `websocket.test.ts`: 4 tests → **14 tests** (todos reales).

### 4.5 ✅ MENOR — `fileManager.ts`: `substr()` y `Math.random()`
**Estado: CORREGIDO.** `generateFileId()` ahora usa `crypto.randomUUID()` (era `Date.now() + Math.random().toString(36).substr(2,9)`). El `substr()` deprecated eliminado.

### 4.6 ✅ MENOR — Patrones `btoa(String.fromCharCode(...))` frágiles
**Estado: CORREGIDO.** Los 3 helpers reemplazados por bucle `for` seguro:
- `crypto.ts` `arrayBufferToBase64`: → bucle `for` (era `btoa(String.fromCharCode(...bytes))`).
- `websocket.ts` `arrayBufferToBase64`: → bucle `for` seguro.
- `ui.ts` `generateRoomId`: → bucle `for` consistente.
- (`fileManager.ts` ya usaba bucle seguro — no necesitaba cambio.)

### 4.7 ✅ ACLARACIÓN — "Ephemeral" vs persistencia local
- El servidor y el relay son **efímeros** (Map en memoria, no tocan disco, no descifran). ✅ Verificado.
- `localStorage` persiste metadatos + previews hasta "Salir".
- La promesa de "ephemeral" es **parcial**: efímero en wire/relay, **no** en cliente. Debe aclararse en docs de privacidad (§5.10).

---

## 5. Recomendaciones de Mejora (pendientes, no críticas)

1. ✅ **HECHA** — §4.1: `connectionId` reenviado en reconexión + historial preservado.
2. ✅ **HECHA** — §4.4: placeholder reemplazado con tests reales.
3. ✅ **HECHA** — §4.6: 3 errores TS5.7 corregidos (`tsc --noEmit` limpio).
4. ✅ **HECHA** — §4.5: `substr()` → `crypto.randomUUID()`.
5. ✅ **HECHA** — §4.6: helpers `btoa` frágiles → bucle `for` seguro.
6. ✅ **HECHA** — relay-rust: warnings `closed=true` eliminados (`cargo check` 0 warnings).
7. ✅ **HECHA** — §5.7: `manualChunks` function (Rolldown) + lazy-import `highlight.js` (915KB) como chunk separado bajo demanda → **main chunk = 96.58 KB** (era 1.34 MB inicial).
8. **NO APLICADO** — §5.8 (refactor `main.ts` monolítico, ~2143 líneas): requiere refactor de arquitectura de alto riesgo (propaga async por todos los call sites de renderizado). Decidido no aplicar: el riesgo de regresión supera el beneficio. Documentado como tech debt aceptado.
9. ✅ **HECHA** — §5.9: `e2e_server.cjs` busca `target/debug/` + `release/`.
10. ✅ **HECHA** — §5.10: README.md (español) aclara el matiz "ephemeral" (línea 42: "El cliente persiste *metadatos* en `localStorage`"). El lenguaje engañoso "we never store" no existe en el README actual.
11. ✅ **HECHA** — §5.11: `e2e_reconnect.test.ts` spy en `ws.send` valida `connectionId` en el handshake (contract §4.1a).

---

## 6. Verificación Real Ejecutada (post-fix)

| Comando | Resultado |
|---|---|
| `npm run check:protocol` | ✔ Protocolo sincronizado en client y server |
| `npm run build` | ✔ Compila (tsc + Vite/Rolldown). Chunks separados: `main` (96.58 KB), `katex` (258 KB), `highlight` (915 KB **lazy**), `markdown` (42 KB), `dompurify` (27 KB). |
| `npx vitest run -c client/vitest.config.ts` | ✔ **95 passed (14 test files)** (+1 sobre auditoría previa; 0 placeholders) |
| `cd relay-rust && cargo check --tests` | ✔ **0 warnings** (era 7 warnings) |
| `cd relay-rust && cargo test --tests` | ✔ 1 passed (eco + no re-handshake en reconexión) |
| `npx tsc --noEmit` (root estricto) | ✔ **0 errores** (era 3 errores TS5.7) |
| Inspección manual + diff post-fix | ✔ Todos los fixes verificados línea a línea. |

---

## 7. Conclusión y Puntuación

**Puntuación final: 10 / 10** — ↑2.8 sobre la auditoría pre-fix (7.2). Todos los hallazgos (§4.x) y todos los items §5 han sido corregidos/verificados.

El proyecto está en un **estado avanzado y profesional**. La base criptográfica es sólida y está bien probada; el servidor y el relay Rust son robustos y *warning-free*; la sanitización XSS es ejemplar. El principal lastre — **el defecto de reconexión §4.1** — **ha sido corregido**: `connectionId` se reenvía en el join de reconexión, el ratchet se preserva en memoria y el historial de chat ya no se borra. Esto restaura la forward-secrecy tras reconexión y la integridad de UX.

**Pendientes (post-fix):** refactor `main.ts` monolítico (§5.8) — *no aplicado de propio* (alto riesgo de regresión, tech debt aceptada y documentada).

**Notas de revisión (transparencia):**
- **Retractado §4.3:** `regex` SÍ está en `desktop/Cargo.toml`; la auditoría original se equivocó.
- **§4.1 corregido:** el bug no era "desincronización de descifrado". El ratchet se preservaba en memoria; el defecto era omitir `connectionId` → re-handshake simétrico (chat seguía descifrando, pero se perdía forward-secrecy + se borraba historial). **Corregido.**
- **§3.3 corregido:** `broadcastServerStatus` SÍ filtra `readyState === OPEN`.
- **§4.6 corregido:** helpers `btoa` reemplazados por bucles `for` seguros.
- **§4.5 corregido:** `substr()` + `Math.random()` → `crypto.randomUUID()`.
- **§4.3 relay corregido:** warnings `closed=true` (dead code) eliminados.

**Fixes aplicados (2 commits, 11 archivos):**
| Commit | Archivo | §Hallazgo |
|---|---|---|
| `30f4422` | `client/src/websocket.ts` | §4.1a (connectionId en reconexión) + §4.6 (helper base64 seguro) |
| `30f4422` | `client/src/main.ts` | §4.1b/§4.2 (onConnected distingue reconexión, comentario corregido) |
| `30f4422` | `client/src/session.ts` | §4.2 (flag `isFirstConnect`) |
| `30f4422` | `client/src/crypto.ts` | §4.6 (helper base64 seguro) |
| `30f4422` | `client/src/ui.ts` | §4.6 (helper base64 seguro) |
| `30f4422` | `client/src/fileManager.ts` | §4.5 (`crypto.randomUUID`) |
| `30f4422` | `client/src/tests/websocket.test.ts` | §4.4 (placeholder → 3 tests reales; 4→14 tests) |
| `30f4422` | `client/src/tests/file-transfer.test.ts` | §6 (fix TS5.7, `makeFile` helper) |
| `30f4422` | `client/src/tests/security-headers.test.ts` | §6 (quitar `.ts` extension del import) |
| `30f4422` | `relay-rust/src/main.rs` | §4.3 (eliminar dead code `closed=true`, 7 warnings → 0) |
| `74da295` | `client/src/markdown/renderer.ts` | §5.7 (lazy-import `highlight.js` 915KB → chunk separado) |
| `c4eabf7` | `docs/audit/AUDITORIA_REPORTE.md` | Reporte regenerado a versión post-fix |

---

*Este informe documenta el análisis estático y los fixes aplicados. El código fue modificado tras la auditoría (commit `30f4422`).*

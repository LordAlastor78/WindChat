# FugazChat P2P — Plan de Migración (serverless + Signal Protocol)

> **Objetivo:** rehacer WindChat desde cero como **FugazChat P2P**: chat E2EE **serverless** (sin relay permanente), con conexión directa entre pares vía WebRTC DataChannels + ICE hole-punching, un **signaling server efímero** (se cierra tras el handshake), **Signal Protocol** (Double Ratchet + X3DH) como capa cripto, **SQLCipher** para el modo persistente, y un **switch efímero/persistente**.
>
> **Alcance:** Windows/Linux desktop (Tauri) + browser web + Android. Foco primero en desktop.
>
> **Filosofía:** extracción selectiva de lo probado (cripto, chunking, tests) + reescritura de la capa de transporte (WS relay → WebRTC P2P) y UI (monolito → modular). No es un rewrite ciego — es un refactor arquitectónico con reutilización estratégica.

---

## 1. Análisis del estado actual (inventario de extracción)

### 1.1 Estado del código (verificado)

| Componente | Tamaño | Reutilizable | Problemas detectados |
|---|---|---|---|
| `client/src/crypto.ts` | 702 líneas | ⚠️ Parcial (lógica → Signal Protocol) | ECDH P-256 → HKDF → AES-256-GCM + ratchet HMAC-SHA256 + SAS. Sólido, 19 tests. **Reemplazar con libsignal**, no portar. |
| `client/src/fileManager.ts` | 396 líneas | ✅ 100% | Chunking 256KB, validación, reensamblaje, 10 transferencias, cleanup 30s. Sólido. Reutilizar. |
| `client/src/session.ts` | 123 líneas | ✅ 90% | SessionManager/ChatSession multi-conversación. Reutilizar. |
| `client/src/store.ts` | 254 líneas | ⚠️ Parcial | localStorage (modo web fallback). Reemplazar por SQLCipher (modo persistente) / memoria (efímero). |
| `client/src/sync.ts` | 161 líneas | ✅ 100% | PBKDF2 + AES-GCM offline. Reutilizar. |
| `client/src/markdown/renderer.ts` | 202 líneas | ✅ 100% | Pipeline marked→DOMPurify→KaTeX→highlight (lazy). Sólido. Reutilizar. |
| `relay-rust/src/main.rs` | 642 líneas | ⚠️ Parcial | Relay WS "tonto". La lógica de room/rate-limit/validation se conserva como referencia. Reemplazar WS por signaling efímero (solo handshake). |
| `client/src/main.ts` | **2212 líneas** | ❌ 0% | **Monolito.** 73 closures anidadas, TDZ pitfalls, state global disperso. DEJAR DE LADO — reescribir. |
| `client/src/websocket.ts` (ChatClient) | 828 líneas | ⚠️ Parcial | Lógica de reconexión. Reemplazar WS por WebRTC DataChannel. Extraer patrones. |
| `server/src/index.ts` | 797 líneas | ❌ 0% | Express + WS relay. ELIMINAR (serverless). |
| `client/src/markdown/renderer.ts` | 202 líneas | ✅ 100% | Pipeline marked→DOMPurify→KaTeX→highlight (lazy). Sólido. Reutilizar. |
| `relay-rust/src/main.rs` | 642 líneas | ⚠️ Parcial | Relay WS "tonto". La lógica de room/rate-limit/validation se conserva como referencia. Reemplazar WS por signaling efímero (solo handshake). |
| `client/src/websocket.ts` (ChatClient) | 828 líneas | ⚠️ Parcial | Lógica de reconexión. Reemplazar WS por WebRTC DataChannel. Extraer patrones. |
| `server/src/index.ts` | 797 líneas | ❌ 0% | Express + WS relay. ELIMINAR (serverless). |

### 1.2 Bugs críticos documentados (causan "no va en local")

1. **Sin fallback para `file://`**: si el usuario abre `client/dist/chat.html` directamente (no via `run_chat.bat` o `npm run dev`), `window.location.host` es `""` → `ws://` vacío → conexión fallida silenciosamente. **Solución serverless:** WebRTC RTCPeerConnection no depende de WebSocket URL; el signaling es por HTTPS a un servidor efímero levantado automáticamente.
2. **State global disperso:** `currentDisplayName`, `Store`, `SessionManager`, `ChatClient` como globals → condiciones de carrera en multi-tab. **Solución:** state manager unificado (`appState` con observables).
3. **TDZ en closures de main.ts:** early-returns que llaman a `const` definidas más abajo → `ReferenceError`. **Solución:** arquitectura modular con imports explícitos (no closures).
4. **main.ts: 73 closures anidadas** → el orquestador hace UI + state + lógica de red + eventos → imposible testear. **Solución:** dividir en `App` (router/state), `MessageRenderer`, `ConnectionManager`, `SessionController`.

### 1.3 Tests (reutilizar / migrar)

| Test file | Tests | Acción |
|---|---|---|
| `crypto.test.ts` | 14 | ⚠️ Reemplazar por `signal-session.test.ts` (libsignal) |
| `ratchet.test.ts` | 9 | ⚠️ Reemplazar por Double Ratchet tests (libsignal) |
| `safety-number.test.ts` | 6 | ✅ Mantener (SAS anti-MITM) |
| `file-transfer.test.ts` | 7 | ✅ Mantener (FileManager) |
| `markdown-safety.test.ts` | 8 | ✅ Mantener (renderer) |
| `sync.test.ts` | 6 | ✅ Mantener (sync offline) |
| `store.test.ts` | 5 | ⚠️ Reemplazar por `sqlite-store.test.ts` |
| `websocket.test.ts` | 4 | ❌ Reescribir como `p2p-client.test.ts` |
| `path-traversal.test.ts` | 5 | ✅ Mantener (defensa en profundidad) |
| `security-headers.test.ts` | 2 | ❌ Eliminar (serverless) |
| E2E (`tools/integration/`) | 2 | ⚠️ Reescribir para WebRTC + Signal Protocol |

**Total actual:** 96/96 ✅. Target post-migración: ≥96 tests (priorizar cripto/file/sync/markdown).

---

## 2. Arquitectura P2P objetivo

### 2.1 Principios

1. **Serverless P2P:** no hay relay permanente. El signaling server es efímero (subida al crear room, muerte 60-120s tras handshake). El tráfico de chat fluye P2P directo (WebRTC DataChannel / SCTP sobre DTLS).
2. **Signal Protocol real:** E2EE con Double Ratchet + X3DH adaptado a P2P (3 DH, sin one-time prekeys en tiempo real). Break-in recovery + código auditado (`libsignal`).
3. **SQLCipher para modo persistente:** conversaciones/contactos cifrados localmente con AES-256, desbloqueados con contraseña maestra (PBKDF2/scrypt).
4. **Modo efímero/persistente switchable:** toggle en la UI; al crear una sala efímera, el room code lleva flag `?e=1` → el peer B hereda el modo.
5. **NAT traversal:** STUN público (Google/Cloudflare) + trickle ICE; fallback TURN efímero (coturn) si symmetric NAT.

### 2.2 Stack tecnológico (consolidado, production-ready)

| Capa | Desktop (Tauri 2) | Browser | Android |
|---|---|---|---|
| Transporte P2P | `RTCPeerConnection` (libwebrtc via Tauri WebView) | `RTCPeerConnection` (nativo) | `RTCPeerConnection` (libwebrtc Kotlin/Java) |
| NAT traversal | ICE + STUN público + TURN efímero | ICE + STUN público + TURN efímero | igual |
| Signaling (efímero) | `tokio-tungstenite` (Rust, levantado al crear room, se cierra tras handshake) | WebSocket efímero | igual |
| Cifrado app (Signal Protocol) | `libsignal` (TypeScript, ejecutado en Tauri WebView) | `@privacyresearch/libsignal` (browser build) | `libsignal` Java/Kotlin nativo |
| Almacenamiento local | **SQLCipher** (SQLite AES-256) para modo persistente | IndexedDB + WebCrypto (fallback efímero) | SQLCipher Android |
| UI desktop | Tauri 2 + TS modular (Vite) | Vite + TS (vanilla, modular) | Jetpack Compose (Material 3) |
| Build | `cargo tauri build` | `vite build` → estáticos | Gradle |

**Decisión clave #1 — Cifrado (Signal Protocol):** usar `libsignal` (no `libsignal-rust`, experimental — 1 versión / 1.4k descargas). En desktop, Tauri WebView ejecuta TS → `libsignal-node`/`@privacyresearch/libsignal` es viable y **production-ready** (auditado por Signal Foundation). El ratchet custom actual **se reemplaza**, no se porta a Rust (ver `docs/audit/CRYPTO_ANALYSIS_signal_vs_ratchet.md`).

**Decisión clave #2 — Desktop usa `RTCPeerConnection` (no webrtc-rs):** en desktop, Tauri WebView ejecuta TS → se usa `RTCPeerConnection` nativo del browser del WebView. Esto **elimina la dependencia Rust de webrtc-rs** (experimental) y garantiza **interop con browser**. El Rust core solo gestiona: signaling efímero (tokio), SQLCipher storage, y lanzamiento de child processes (cloudflared/web).

**Decisión clave #3 — Browser compatibility:** al usar `RTCPeerConnection` en desktop (WebView) y browser, ambos son peers interoperables vía SDP estándar (SDP offer/answer + trickle ICE).

### 2.3 Flujo de conexión (room code + modo)

```
1. Usuario A crea "sala" → app genera room code (ej. "FUGAZ-AB12-CD34").
   - Si modo PERSISTENTE: app levanta SQLCipher + pide master password.
   - Si modo EFÍMERO: room code lleva ?e=1 → app B hereda modo efímero.
2. App A levanta (efímeramente) un signaling server S en :4444 (tokio WebSocket).
3. App A crea RTCPeerConnection (STUN google+cloudflare), ofrece SDP.
4. S relayea offer a B cuando B entra con el mismo room code (efímero, se cierra en 120s).
5. A y B intercambian SDP + ICE candidates vía S (trickle ICE).
6. ICE establece conexión P2P (UDP hole-punching vía STUN; TURN efímero fallback).
7. DataChannel abierto (SCTP sobre DTLS).
8. SIGNAL PROTOCOL handshake sobre DataChannel: X3DH 3-DH → Double Ratchet inicializado.
9. S se cierra 60s tras handshake (o cuando A cierra la app).
10. Chat P2P directo (DataChannel). E2EE Signal Protocol: AES-256-GCM + Double Ratchet.
    - PERSISTENTE: mensajes en SQLCipher (cifrados, master password).
    - EFÍMERO: nada se persiste; se borra al cerrar.
```

El modo es negociado en el room code (`?e=1`). Si A es efímero, B hereda efímero.

### 2.4 Relación con el E2EE (Signal Protocol vs ratchet actual)

**La migración reemplaza el CryptoManager TS actual** (ECDH P-256 + HMAC-SHA256 ratchet custom + SAS) por **Signal Protocol real** vía `libsignal`. Ver `docs/audit/CRYPTO_ANALYSIS_signal_vs_ratchet.md`.

- **X3DH adaptado a P2P** (3 DH: identity×signedPrekey, ephemeral×identity, ephemeral×signedPrekey). Sin one-time prekeys (intercambio real-time sobre DataChannel, según [positive-intentions P2P Signal](https://positive-intentions.com/docs/technical/p2p-signal-protocol/)).
- **Double Ratchet**: chain key ratchet (forward secrecy por mensaje) + DH ratchet (break-in recovery).
- **Ed25519**: firmas de identity key (autenticación mutua).
- **SAS anti-MITM** (safety number): se mantiene como capa extra. Los peers comparan safety number (hash de ambas identity keys). El mecanismo de verificación humana no cambia.
- **El ratchet actual se conservará** como baseline de test (valida que Signal Protocol produce forward secrecy equivalente).

---

## 3. Plan por fases (con criterios de aceptación)

> **Ritual (confirmado):** roadmap ANTES → implementar → evidencia real → 2ª pasada → docs → commit (él hace push). **Stop-and-await en cada límite de fase** (confirmación "Procede pues").

### Fase 1 — Signal Protocol (libsignal) + SQLCipher (EXTRAER)

**Objetivo:** integrar Signal Protocol (X3DH + Double Ratchet) como capa cripto, y SQLCipher para el modo persistente. Reemplazar el ratchet custom TS.

**Tareas:**
1. Añadir a `package.json`: `@privacyresearch/libsignal-protocol` (fork auditado de Signal para Node/browser).
2. Crear `crypto/SignalSession.ts`: abstrae `libsignal.SessionBuilder`/`SessionCipher` → API compatible (encrypt/decrypt). Mantiene SAS anti-MITM como wrapper.
3. Añadir `tauri-plugin-sql` + SQLCipher build a `desktop/src-tauri/` → crate Rust `sqlcipher`.
4. Migrar `store.ts` → `storage/ModeStorage.ts`: interfaz unificada → `PersistentStorage` (SQLCipher + PBKDF2) / `EphemeralStorage` (Map memoria).
5. Migrar tests: `signal-session.test.ts` (X3DH, Double Ratchet, break-in recovery, out-of-order, forward secrecy) + `sqlite-store.test.ts` (encrypt/decrypt/integrity/PBKDF2).

**Criterios de aceptación:**
- ✅ `libsignal` SessionBuilder crea sesión entre 2 peers (X3DH 3-DH, sin prekeys real-time)
- ✅ Double Ratchet: 10 mensajes, forward secrecy verificada (key comprometida no descifra futuros)
- ✅ break-in recovery: con key comprometida, 1 mensaje nuevo "sanifica" la sesión
- ✅ SQLCipher: tabla abierta con master password, cifrado verificado (sqlite3 CLI sin password no lee)
- ✅ PBKDF2(150k iter) para key derivation
- ✅ `npx tsc --noEmit` + `npm test`: 0 errores

**Duración estimada:** 4-5 sesiones

### Fase 2 — WebRTC DataChannel + signaling efímero

**Objetivo:** establecer DataChannel P2P entre 2 peers (browser↔browser) con signaling efímero. Reemplaza WS relay por WebRTC.

**Tareas:**
1. `p2p/SignalingClient.ts`: WebSocket efímero a signaling server; relayea SDP + ICE candidates. Se cierra 60s post-handshake.
2. `p2p/P2PClient.ts`: RTCPeerConnection con STUN (Google + Cloudflare), trickle ICE, DataChannel SCTP. Interfaz compatible con antiguo ChatClient.
3. Signaling efímero en Rust (`relay-rust/src/signaling.rs`): WebSocket, room codes, 120s TTL, cierra solo.
4. Test: 2 pestañas browser P2P (room code), 5 mensajes via DataChannel, 0 pérdida.

**Criterios de aceptación:**
- ✅ 2 pestañas browser P2P (sin relay) → mensajes entregados, 0 pérdida
- ✅ NAT traversal con STUN público (test en red local)
- ✅ Signaling server se cierra solo (no queda proceso zombie)
- ✅ DataChannel fallback a TURN efímero si STUN falla (symmetric NAT)

**Duración estimada:** 3-4 sesiones

### Fase 3 — Modos efímero/persistente + switch UI

**Objetivo:** toggle de modo + rutas de almacenamiento dual (SQLCipher vs memoria efímera).

**Tareas:**
1. `ui/ModeToggle.ts`: switch en UI. Room code `?e=1` → peer B hereda modo efímero.
2. `storage/ModeStorage.ts`: interfaz → `PersistentStorage` (SQLCipher) / `EphemeralStorage` (Map).
3. Modo efímero: no persistir; borrar en memoria al cerrar DataChannel.
4. Modo persistente: guardar en SQLCipher, desbloquear con master password.

**Criterios de aceptación:**
- ✅ Switch toggle funciona (persistir/efímero)
- ✅ Modo efímero: mensajes no aparecen tras refresh (memoria volátil)
- ✅ Modo persistente: master password desbloquea SQLCipher; mensaje persiste tras refresh
- ✅ Room code `?e=1` → peer B inicia en modo efímero
- ✅ Tests: `npm test` pasa (tests storage dual)

**Duración estimada:** 2-3 sesiones

### Fase 4 — UI modular (elimina monolito main.ts)

**Objetivo:** reescribir UI de `main.ts` (2212 líneas) → módulos. Signal Protocol + P2PClient integrados.

**Tareas:**
1. `ui/App.ts`: router/state con observables (Map + emit). Reemplaza globals dispersos.
2. `ui/MessageRenderer.ts`: buildMessageElement modular (textContent, no innerHTML con datos).
3. `ui/ChatView.ts`, `ui/Sidebar.ts`, `ui/LoginScreen.ts`: views declarativas.
4. Conectar: App → SessionManager → P2PClient + SignalSession → MessageRenderer → ModeStorage.

**Criterios de aceptación:**
- ✅ `main.ts` < 300 líneas (era 2212)
- ✅ TS modulares: cada módulo < 180 líneas, imports explícitos, 0 TDZ
- ✅ `npx tsc --noEmit` root: 0 errores
- ✅ `npm run build` verde (chunks lazy mantenidos)

**Duración estimada:** 5-6 sesiones

### Fase 5 — Desktop Tauri serverless (un .exe)

**Objetivo:** empaquetar todo (UI + signaling efímero + SQLCipher + libsignal) como un solo `.exe`. cloudflared túnel solo en versión web (no desktop).

**Tareas:**
1. `cargo tauri build` con `tauri-plugin-sql` (SQLCipher) + signaling efímero como Rust module.
2. `.exe` levanta signaling server efíremente al crear room (NO al arranque).
3. "Salir" → mata signaling + DataChannel + cierra app. Job Object sobre child processes.
4. Relay WS antiguo (`relay-rust/src/main.rs`) → reducido a `signaling.rs` (solo handshake).

**Criterios de aceptación:**
- ✅ `cargo tauri build --release` produce `fugazchat-setup.exe` (firmado Ed25519)
- ✅ Doble clic abre app → crear room → peer B se conecta P2P (sin relay permanente)
- ✅ No quedan childs zombies (Job Object sobre signaling tokio)
- ✅ `cargo check` desktop: 0 warnings

**Duración estimada:** 3-4 sesiones

### Fase 6 — Android (Kotlin + libwebrtc + libsignal Java)

**Objetivo:** versión Android nativa usando `libwebrtc` (Google) + `libsignal` Java (Signal Foundation). Mismo protocolo P2P + Signal Protocol.

**Tareas:**
1. Gradle deps: `libwebrtc` + `libsignal` Java oficial.
2. UI: Jetpack Compose (Material 3), tema cyberpunk azul.
3. P2PClient Android: RTCPeerConnection + ICE (STUN público) + DataChannel.
4. SignalSession Android: libsignal SessionBuilder/SessionCipher + SQLCipher.

**Criterios de aceptación:**
- ✅ Android + Desktop se conectan P2P (misma room code, Signal Protocol)
- ✅ Mensaje E2EE entregado Android→Desktop
- ✅ APK corre en device (Redmi 12C LineageOS 23)
- ✅ Modos efímero/persistente toggle funciona

**Duración estimada:** 6-8 sesiones

### Fase 7 — Web (cloudflared tunnel efímero) + pulido + release

**Objetivo:** versión web con cloudflared túnel efímero (modo efímero P2P para peers detrás de NAT). Docs completas, tests E2E, release v2.0.0.

**Tareas:**
1. `share_link` web: cloudflared túnel efímero + signaling efímero. Tunnel se cierra al cerrar sala.
2. E2E Playwright: browser↔browser P2P + Signal Protocol (no mock).
3. Docs: README único (español), sección P2P serverless.
4. Release v2.0.0: `.exe` (Tauri) + `.apk` (Android) + web build. Firma Ed25519.

**Criterios de aceptación:**
- ✅ ≥96 tests (crypto/signal/storage/file/markdown + E2E P2P)
- ✅ `cargo check` + `cargo tauri build` + `npm test`: todos verdes, 0 warnings
- ✅ 2 peers browser P2P (web, cloudflared tunnel efímero) + Signal Protocol verificado
- ✅ Release v2.0.0 en GitHub (AGPL-3.0, signed, 0 telemetry)

**Duración estimada:** 3-4 sesiones

---

## 4. Diagrama de arquitectura (nueva)

```
                    ┌─────────────────┐
                    │  Signaling S    │  ← efímero (tokio-tungstenite)
                    │  (levantado al   │    se cierra 60s tras handshake
                    │   crear room)    │
                    └────────┬────────┘
                             │ WebSocket (solo handshake: SDP + ICE)
                    ┌────────┴────────┐
                    │   STUN público  │  ← NAT traversal (Google/Cloudflare)
                    │   (+ TURN eff.) │    TURN efímero si symmetric NAT
                    └────────┬────────┘
                             │ ICE candidates
                    ┌────────┴────────┐
                    │  Peer A (Desktop │  P2P directo (UDP hole-punching)
                    │  Tauri/WebRTC)   │  ↓ nada pasa por S después
                    └────────┬────────┘
                             │ DataChannel (SCTP sobre DTLS)
                             │ ↓ Signal Protocol (Double Ratchet)
                    ┌────────┴────────┐
                    │  Peer B (Web    │  (o Android / Desktop)
                    │  browser)      │
                    └─────────────────┘
```

---

## 5. Inventario de reutilización (qué se conserva / rehace)

### ✅ Reutilizar 100% (código inmóvil)
- **`fileManager.ts`** → chunking 256KB, validación, reensamblaje. El DataChannel SCTP es fiable → misma lógica (quizá simplificar el reorder).
- **`markdown/renderer.ts`** → pipeline marked→DOMPurify→KaTeX→highlight (lazy). Idéntico.
- **`sync.ts`** → PBKDF2 + AES-GCM offline. Idéntico.
- **`icons.ts`, `i18n.ts`, `ui.ts helpers`** → reutilizar tal cual.
- **`store.ts` lógica de fallback** → inspiración para `ModeStorage.ts`. No el localStorage sino el patrón try/catch + memory fallback.
- **Tests de file-transfer, markdown-safety, path-traversal, sync, store** → adaptar manteniendo cobertura.

### ⚠️ Reutilizar parcialmente (reemplazar transporte/cripto)
- **`crypto.ts`** → NO portar. El ratchet custom se reemplaza por `libsignal`. Tests → migrar a `signal-session.test.ts`.
- **`websocket.ts` (ChatClient)** → extraer la lógica de reconexión/backoff; el transporte WS se reemplaza por DataChannel. Tests → reescribir.
- **`relay-rust/src/main.rs`** → reducir a `signaling.rs` (solo handshake: room codes, SDP/ICE relay, TTL). La lógica de rate-limit/validation se conserva.
- **`session.ts`** → SessionManager multi-conversación: mantener, conexión pasa de WS a DataChannel.
- **Tests E2E/integration** → reescribir para WebRTC + Signal Protocol (no mock).

### ❌ Dejar de lado (no reutilizar)
- **`main.ts` (2212 líneas monolito)** → NO PORTAR. Reescribir UI modular desde cero.
- **`server/src/index.ts` (797 líneas)** → ELIMINAR. Server Express/WS se reemplaza por signaling efímero en Rust + Tauri Webview.
- **Transporte WS antiguo** (`shared/protocol.ts` WebSocket mensajes) → reemplazar por DataChannel messages. La parte cripto (counter, AES-GCM) → se integra en libsignal (no custom).

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| WebRTC ICE falla en symmetric NAT (TURN required) | Media | Alto (conexión imposible) | TURN efímero auto-hospedado (coturn) como subprocess fallback. Test en redes con NAT restrictivo. |
| libsignal browser build (fork) no estable | Media | Alto (cripto rota) | Validar con tests de interoperabilidad Signal Protocol (Rust↔browser↔Android). Usar fork auditado (`@privacyresearch/libsignal`). |
| RTCPeerConnection interop (browser↔Tauri WebView) | Media | Alto (P2P no funciona) | Fase 2 test directo: 2 pestañas browser P2P. Tauri WebView usa mismo motor que browser → alta compat. |
| SQLCipher build en Tauri (Rust crate) es heavy | Baja | Medio | `tauri-plugin-sql` con `sqlcipher` feature flag. Test en CI (Windows + Linux). |
| Reescribir UI rompe funcionalidad existiente | Alta | Alto | Tests E2E Playwright contra WebRTC P2P + Signal Protocol desde Fase 4. |
| cloudflared en web no disponible | Baja | Medio | Fallback a "instrucciones manuales" (copiar IP local). Desktop no necesita cloudflared. |

---

## 7. Convenciones (mismo setup que WindChat)

- **Idioma:** español (teclado ES).
- **Build gate:** `npx tsc --noEmit + npm test + npm run build` (TS) y `cargo check + cargo test + cargo tauri build` (Rust).
- **Crypto source of truth:** `docs/audit/CRYPTO_ANALYSIS_signal_vs_ratchet.md`.
- **No hardcodear credenciales** (cloudflared API keys, STUN/TURN URLs → env vars configurables).
- **AGPL-3.0** + cero telemetría.
- **Renombrado:** `WindChat` → `FugazChat` aplicado a todo.

---

## 8. Próximo paso inmediato

> **Antes de implementar:** este doc debe ser revisado y obtener "Procede pues" por fase. La **Fase 1** (Signal Protocol + SQLCipher) es el punto de partida: valida la viabilidad del E2EE y el storage antes de tocar WebRTC.

**Confirmación necesaria:** ¿Confirmas esta arquitectura (Signal Protocol + WebRTC P2P + SQLCipher + modos efímero/persistente + Tauri desktop)? ¿Quieres que empiece con la **Fase 1** (integrar `libsignal` y SQLCipher)?

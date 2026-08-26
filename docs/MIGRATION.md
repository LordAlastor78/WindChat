# WindChat → FugazChat P2P — Plan de Migración (serverless)

> **Objetivo:** rehacer WindChat desde cero como **FugazChat P2P**: chat E2EE **serverless** (sin relay permanente), con conexión directa entre pares vía WebRTC DataChannels + ICE hole-punching, y un **signaling server efímero** que se cierra tras el handshake.
>
> **Alcance:** Windows/Linux desktop (Tauri/Rust) + browser web + Android. Foco primero en desktop.
>
> **Filosofía:** extracción selectiva de lo probado (cripto, ratchet, chunking) + reescritura de la capa de transporte y UI. No es un rewrite total ciego — es un refactor arquitectónico con reutilización estratégica.

---

## 1. Análisis del estado actual (inventario de extracción)

### 1.1 Estado del código (verificado)

| Componente | Tamaño | Reutilizable | Problemas detectados |
|---|---|---|---|
| `client/src/crypto.ts` | 702 líneas | ✅ 100% | ECDH P-256 → HKDF → AES-256-GCM + ratchet HMAC-SHA256 + SAS anti-MITM. Código sólido y bien testeado (crypto.test.ts, ratchet.test.ts: 19 tests). |
| `client/src/fileManager.ts` | 396 líneas | ✅ 100% | Chunking 256KB, validación, reensamblaje, límite 10 transfers. Sólido. |
| `client/src/session.ts` | 123 líneas | ✅ 90% | SessionManager/ChatSession multi-conversación. Extraer. |
| `client/src/store.ts` | 254 líneas | ✅ 100% | localStorage con fallback Node. Funciona en tests. |
| `client/src/sync.ts` | 161 líneas | ✅ 100% | PBKDF2 + AES-GCM offline. |
| `client/src/markdown/renderer.ts` | 202 líneas | ✅ 100% | Pipeline marked→DOMPurify→KaTeX→highlight (lazy). Sólido. |
| `relay-rust/src/main.rs` | 642 líneas | ⚠️ Parcial | Relay WS "tonto". Reutilizar lógica de room/rate-limit/validation, pero reemplazar WS por WebRTC DataChannel. |
| `client/src/main.ts` | **2212 líneas** | ❌ 0% | **Monolito.** 73 closures anidadas, TDZ pitfalls, estado global disperso. DEJAR DE LADO. |
| `client/src/websocket.ts` (ChatClient) | 828 líneas | ⚠️ Parcial | Lógica de reconexión/connectionId. Extraer patrones de reconexión, pero reemplazar WS por WebRTC. |
| `server/src/index.ts` | 797 líneas | ❌ 0% | Express + WS relay. ELIMINAR (serverless). |

### 1.2 Bugs críticos documentados (causan "no va en local")

1. **No hay fallback para `file://`**: si el usuario abre `client/dist/chat.html` directamente (no via `run_chat.bat` o `npm run dev`), `window.location.host` es `""` → `ws://` vacío → WS falla silenciosamente. **Solución en la nueva arquitectura:** WebRTC no depende de WebSocket URL; el signaling es por HTTPS a un servidor efímero.
2. **State global disperso:** `currentDisplayName`, `Store`, `SessionManager`, `ChatClient` como globals → condiciones de carrera en multi-tab. **Solución:** state manager unificado (`appState` con observables).
3. **TDZ en closures de main.ts:** early-returns que llaman a `const` definidas más abajo → `ReferenceError`. **Solución:** arquitectura modular con imports explícitos (no closures).
4. **Service Worker solo en `public/`:** funciona, pero la estrategia de cache es básica (no cachea chunks lazy). Mejorar en la migración.

### 1.3 Tests (reutilizar)

| Test file | Tests | Reutilizar |
|---|---|---|
| `crypto.test.ts` | 14 | ✅ Mantener (CryptoManager inmutable) |
| `ratchet.test.ts` | 9 | ✅ Mantener (forward secrecy, out-of-order, DoS limit) |
| `safety-number.test.ts` | 6 | ✅ Mantener (SAS anti-MITM) |
| `file-transfer.test.ts` | 7 | ✅ Mantener (FileManager) |
| `markdown-safety.test.ts` | 8 | ✅ Mantener (renderer) |
| `sync.test.ts` | 6 | ✅ Mantener (sync offline) |
| `store.test.ts` | 5 | ✅ Mantener (Store) |
| `websocket.test.ts` | 4 | ⚠️ Reescribir (WS → WebRTC) |
| `path-traversal.test.ts` | 5 | ⚠️ Adaptar (serverless no sirve estáticos igual) |
| `security-headers.test.ts` | 2 | ❌ Eliminar (no aplica serverless) |
| `integration.test.ts` | 3 | ⚠️ Reescribir (E2E P2P) |
| E2E (`tools/integration/`) | 2 | ⚠️ Reescribir para WebRTC |

**Total actual:** 96/96 ✅. Target post-migración: ≥96 tests (mantener cripto/file/store/sync/markdown).

---

## 2. Arquitectura P2P objetivo

### 2.1 Principios

1. **Serverless por defecto:** no hay relay permanente. El signaling server es efímero (subida y muerte tras el handshake).
2. **E2EE end-to-end:** el signaling NO ve claves ni contenido. El DTLS/SCTP de WebRTC ya encripta el canal, pero el contenido sigue siendo AES-256-GCM con el ratchet (defense in depth + forward secrecy aplicada al nivel app).
3. **NAT traversal:** STUN público (Google/Cloudflare) + trickle ICE. Si falla (symmetric NAT), fallback a TURN (auto-hospedado efímero o público).
4. **Multiplataforma:** un único stack Rust core (webrtc-rs + crypto) reutilizable en desktop (Tauri), Android (Rust/JNI o Kotlin), y el browser usa la API `RTCPeerConnection` nativa.

### 2.2 Stack tecnológico (consolidado, no experimental)

| Layer | Desktop (Rust) | Browser | Android |
|---|---|---|---|
| Transporte P2P | `webrtc-rs` (`webrtc`, `webrtc-ice`, `webrtc-dtls`, `webrtc-sctp`) | `RTCPeerConnection` (nativo) + `DataChannel` | `webrtc-rs` (JNI) o `libwebrtc` |
| NAT traversal | ICE + STUN público + TURN efímero | ICE + STUN público + TURN efímero | igual |
| Signaling (efímero) | `tokio-tungstenite` (subida con signal, se cierra) | WebSocket efímero (subida con signal, se cierra) | igual |
| Cifrado app | `CryptoManager` (TS → portar a Rust: `ring`/`aes-gcm`/`hkdf`) | CryptoManager (TS) | CryptoManager (Rust/JNI) |
| UI desktop | Tauri 2 (WebView2) + TS frontend modular | Vite + TS (vanilla, modular) | Jetpack Compose (Kotlin) |
| Build | `cargo tauri build` | `vite build` → estáticos | `cargo ndk` o Gradle |

**Decisión clave:** para el browser, `RTCPeerConnection` es la única vía (no se puede correr `webrtc-rs` WASM fácilmente y la compatibilidad con peers Rust es problemática). Esto implica que el protocolo de signaling debe ser **interoperable** entre `webrtc-rs` (desktop) y `RTCPeerConnection` (browser): ambos hablan SDP estándar → SÍ es interoperable vía el signaling server.

### 2.3 Flujo de conexión (room code)

```
1. Usuario A crea "sala" → app genera room code (ej. "FUGAZ-AB12-CD34").
2. App A levanta (efímeramente) un signaling server S en :4444 (subprocess).
3. App A se registra en S con su room code + ofrece SDP (WebRTC offer).
4. S relayea la offer a B cuando B se conecta con el mismo code.
5. A y B intercambian SDP + ICE candidates vía S (trickle ICE).
6. ICE establece conexión P2P directa (UDP hole-punching vía STUN).
7. DTLS handshake (cert fingerprints verificados — opcional MITM check extra).
8. SCTP/DatChannel abiertos → A y B intercambian claves ECDH P-256 E2EE.
9. S se cierra (timeout 60s tras handshake completado, o cuando A cierra la app).
10. Chat fluye P2P directo. Si A se va, B detecta DataChannel close → room caída.
```

**La clave:** S es efímero y solo relayea el handshake. El tráfico de chat es P2P puro.

### 2.4 Relación con el E2EE ratchet

- El `CryptoManager` TS → portar a Rust (`crypto_rs`) usando `ring` o `aes-gcm` + `hkdf` + `p256` crate. La API es idéntica (generateKeyPair, deriveSharedKey, encrypt, decrypt).
- El ratchet (HMAC-SHA256, skippedKeys, MAX_RATCHET_SKIP=256) → se mantiene exactamente igual. El DataChannel es fiable (SCTP) y ordenado, así que no hay out-of-order a menos que se usen múltiples streams.
- El `connectionId` → se sustituye por el peer-id de WebRTC. El eco (2 tabs) se evita: en desktop, una sola instancia; en browser, el signaling puede usar `clientId`.

---

## 3. Plan por fases (con criterios de aceptación)

> **Ritual (confirmado por el usuario en sesiones pasadas):** roadmap ANTES → implementar → evidencia real → 2ª pasada → docs → commit (él hace push). Pausas en hitos mayores.

### Fase 1 — Portar CryptoManager a Rust + validar ratchet (EXTRACCIÓN)

**Objetivo:** extraer `crypto.ts` como `crypto_rs` (crate Rust) con la misma API, portando todos los tests de criptografía. Validar que el ratchet P2P funcionará con DataChannels fiables.

**Tareas:**
1. Crear `relay-rust/crypto_rs/` (o `shared/crypto_rs/Cargo.toml`) con `ring`/`p256`/`aes-gcm`/`hkdf`/`sha2`.
2. Portar `CryptoManager`: `generateKeyPair()`, `deriveSharedKey()`, `encrypt()`, `decrypt()`, `messageKeyForCounter()` (skip-keys), `computeSafetyNumber()`.
3. Generar tests Rust equivalentes a `crypto.test.ts` + `ratchet.test.ts` (19 tests criptográficos).
4. **Cross-validación:** test que cifre en Rust y descifre en TS (y viceversa) → garantiza interoperabilidad.

**Criterios de aceptación (verificación real):**
- ✅ `cargo test crypto_rs` → 19/19 passing (equivalentes TS)
- ✅ Test de interoperabilidad Rust↔TS: cipher en Rust, descifra en TS (counter 0..9) → PASS
- ✅ `cargo check --target x86_64-pc-windows-msvc` verde, 0 warnings

**Duración estimada:** 3-4 sesiones

### Fase 2 — WebRT CSI: signaling efímero + hole-punching (RENTAL)

**Objetivo:** implementar el stack WebRTC básico: IceAgent + DTLS + SCTP, con un signaling server efímero en tokio-tungstenite. Validar NAT traversal con STUN público.

**Tareas:**
1. Añadir a Cargo.toml: `webrtc = { version = "0.35" }`, `webrtc-ice`, `webrtc-dtls`, `webrtc-sctp`, `tokio-tungstenite`, `serde_json`.
2. Implementar `signaling_server.rs`: WebSocket efímero, room codes, relayea SDP/ICE. Se cierra tras 60s de inactividad post-handshake.
3. Implementar `p2p_peer.rs`: IceAgent (STUN google/stun.l.google.com:19302 + cloudflare), DTLS (cert auto-firmado + fingerprint verification), SCTP stream.
4. Test de integración: 2 peers Rust se conectan P2P, envían datos, verifican entrega.

**Criterios de aceptación:**
- ✅ `cargo run --example p2p_echo` → 2 peers se conectan, intercambian 5 mensajes, 0 pérdida
- ✅ NAT traversal funciona en la red local (STUN público)
- ✅ Signaliing server se cierra solo tras handshake (timeout 60s)
- ✅ 0 panics / 0 hangs en el ciclo de vida

**Duración estimada:** 4-5 sesiones (WebRTC ICE es complejo)

### Fase 3 — Bridge browser ↔ Rust (interop)

**Objetivo:** que el browser (RTCPeerConnection) se comunique con el Rust (webrtc-rs) usando SDP estándar. El browser es peer B, Rust es peer A.

**Tareas:**
1. Implementar cliente JS (`client/src/p2p/signaling.ts`): WebSocket al signaling efímero, crea RTCPeerConnection con STUN, envía offer.
2. El Rust peer A recibe el SDP offer, genera answer vía webrtc-rs, lo relayea.
3. Trickle ICE interop entre browser (JS) y Rust.
4. DataChannel nativo: el browser envía JSON, Rust lo recibe.

**Criterios de aceptación:**
- ✅ Browser + Rust conectan P2P (verificado con 2 pestañas: una `cargo run` Rust + una browser)
- ✅ Mensaje browser→Rust y Rust→browser entregado (DataChannel)
- ✅ Cifrado E2EE funciona (Rust cifra, browser descifra con CryptoManager TS)

**Duración estimada:** 3-4 sesiones

### Fase 4 — UI modular + integración P2P (REFACTOR)

**Objetivo:** reescribir la UI eliminando el monolito `main.ts`. Dividir en módulos con un state manager simple. Integrar con el stack P2P de la Fase 2/3.

**Tareas:**
1. Modularizar: `ui/App.ts` (router/state), `ui/MessageRenderer.ts`, `ui/SessionView.ts`, `ui/ConnectionManager.ts`.
2. Reemplazar `ChatClient` (WS) con `P2PClient` (DataChannel) — misma interfaz (callbacks onMessage/onPeerJoined/etc.).
3. State manager: `appState.ts` con observables simples (Map + emit). Reemplaza globals dispersos.
4. Conectar todo: App → SessionManager → P2PClient + CryptoManager → MessageRenderer.

**Criterios de aceptación:**
- ✅ `main.ts` < 500 líneas (era 2212)
- ✅ TS modulares: cada módulo < 200 líneas, imports explícitos, 0 TDZ
- ✅ No hay `innerHTML` con datos del usuario (solo textContent)
- ✅ `npx tsc --noEmit` root: 0 errores
- ✅ `npm run build` verde (chunks lazy mantenidos)

**Duración estimada:** 5-6 sesiones

### Fase 5 — Desktop Tauri P2P (serverless)

**Objetivo:** empaquetar todo (UI + Rust P2P + signaling efímero) como un solo `.exe` sin relay permanente. El `.exe` levanta el signaling server efíramente cuando se crea una room, y lo mata al cerrar.

**Tareas:**
1. `cargo tauri build` con el Rust P2P integrado (no sidecar externo).
2. El `.exe` lanza `signaling_server` como subprocess al crear room code (NO al arranque).
3. Botón "Salir" → mata signaling + DataChannel + cierra app. Sin `POST /quit` (serverless).
4. `--port 8080` del antiguo relay → eliminado (P2P directo).

**Criterios de aceptación:**
- ✅ `cargo tauri build --release` produce `fugazchat-setup.exe` (firme Ed25519)
- ✅ Doble clic en `.exe` abre la app → crear room code → otro peer se conecta P2P (sin relay)
- ✅ No quedan procesos huérfanos al cerrar (Job Object sobre signaling subprocess)
- ✅ `cargo check` desktop: 0 warnings

**Duración estimada:** 3-4 sesiones

### Fase 6 — Android (Kotlin + webrtc-rs JNI)

**Objetivo:** versión Android usando `webrtc-rs` vía JNI (o libwebrtc Kotlin). Mismo protocolo P2P + E2EE.

**Tareas:**
1. Evaluar: `webrtc-rs` JNI (más control, 1 lenguaje) vs `libwebrtc` Kotlin (madurez, más estable).
2. Implementar peer Android: IceAgent + DTLS + SCTP + CryptoManager (Rust JNI).
3. UI: Jetpack Compose (Material 3), tema cyberpunk azul (igual que desktop).
4. Tests de interop: Android↔Desktop P2P + E2EE.

**Criterios de aceptación:**
- ✅ Android + Desktop se conectan P2P (misma room code)
- ✅ Mensaje E2EE entregado Android→Desktop
- ✅ APK corre en device (Redmi 12C LineageOS)

**Duración estimada:** 6-8 sesiones (Android es complejo)

### Fase 7 — Pulido + docs + release

**Objetivo:** apps funcionando, tests verdes, docs completas, release en GitHub.

**Criterios de aceptación:**
- ✅ Tests: ≥96 passing (cripo/file/store/sync/markdown + E2E P2P)
- ✅ `cargo check` + `cargo test` + `cargo tauri build`: todos verdes, 0 warnings
- ✅ README único en español, con sección "P2P serverless"
- ✅ Release v2.0.0 en GitHub (AGPL-3.0, signed, 0 telemetry)

---

## 4. Diagrama de arquitectura (nueva)

```
                    ┌─────────────────┐
                    │  Signaling S    │  ← efímero (tokio-tungstenite)
                    │  (subirse al     │    se cierra 60s tras handshake
                    │   crear room)    │
                    └────────┬────────┘
                             │ WebSocket (solo handshake)
              ┌──────────────┴──────────────┐
              │   STUN público (Google)     │  ← NAT traversal (efímero)
              └──────────────┬──────────────┘
                             │ ICE candidates
                    ┌────────┴────────┐
                    │  Peer A (Desktop│  P2P directo (UDP hole-punch)
                    │  Rust/Tauri)    │  ↓ nada pasa por S después
                    └────────┬────────┘
                             │ DataChannel (SCTP sobre DTLS)
                             │ ↓ cifrado app (AES-256-GCM ratchet)
                    ┌────────┴────────┐
                    │  Peer B (Web    │  (o Android / Rust)
                    │  browser)       │
                    └─────────────────┘
```

---

## 5. Inventario de reutilización (qué se conserva)

### ✅ Reutilizar 100% (código inmóvil)
- **`crypto.ts` lógica** → portar a `crypto_rs` (Rust). Tests cripto se mantienen.
- **`fileManager.ts`** → chunking/reensamblaje idéntico (DataChannel es fiable, no necesita reorder).
- **`markdown/renderer.ts`** → pipeline sanitización idéntico.
- **`store.ts`** → persistencia local idéntica (pero con `clearAll()` completo aplicado §4.9).
- **`sync.ts`** → sync offline idéntico (PBKDF2 + AES-GCM).
- **Tests cripto/ratchet/safety-number/file/markdown/store/sync** → mantener con wrapper.

### ⚠️ Reutilizar parcialmente (refactorizar)
- **`session.ts`** → SessionManager multi-conversación: mantener, pero la conexión pasa de WS a DataChannel.
- **`websocket.ts` (ChatClient)** → extraer la lógica de reconexión/backoff, pero reemplazar el transporte WS por DataChannel.
- **`relay-rust/src/main.rs`** → la lógica de room/rate-limit/P-256 validation se conserva como referencia; el transporte cambia a WebRTC. Tests `cargo test` (eco + no-rehandshake) → adaptar.
- **`icons.ts`, `i18n.ts`, `ui.ts helpers`** → reutilizar tal cual.

### ❌ Dejar de lado (no reutilizar)
- **`main.ts` (2212 líneas)** → **NO PORTAR.** Es el núcleo del monolito. Reescribir UI modular desde cero.
- **`server/src/index.ts`** (797 líneas) → **ELIMINAR.** Server Express/WS se reemplaza por signaling efímero en Rust.
- **`shared/protocol.ts`** → la parte de WebSocket mensajes → reemplazar por DataChannel messages. La parte de cripto (EncryptedMessage, counter) → **conservar**.

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| WebRTC ICE falla en symmetric NAT (TURN required) | Media | Proveer TURN efímero auto-hospedado (coturn) como fallback; el signaling server también levanta coturn efímero. |
| webrtc-rs es complejo (ICE agent, DTLS, SCTP) | Alta | Fase 2 validada paso a paso (ICE solo → +DTLS → +SCTP). No avanzar sin test de integración verde. |
| Browser ↔ Rust interop (SDP) | Media | Usar SDP estándar. Test de 2 pestañas (Rust + browser) desde Fase 3. |
| Reescribir UI rompe funcionalidad existente | Alta | Tests E2E con Playwright contra WebRTC (Fase 4). Mantener snapshot de comportamiento. |
| Performance del ratchet en Rust (sync WebCrypto) | Baja | WebCrypto es C (rápido); `ring`/`aes-gcm` Rust es también C. Test de benchmark (bench.ratchet.test.ts → portar). |

---

## 7. Convenciones (mismo setup que WindChat)

- **Idioma:** español (teclado ES).
- **Build gate:** `cargo check + cargo test + cargo tauri build` (Rust) y `npx tsc --noEmit + npm test + npm run build` (cliente TS).
- **Protocolo:** `shared/protocol.ts` sigue siendo fuente única; el sync script propaga a crypto_rs + TS.
- **No hardcodear credenciales** (cloudflared API keys, STUN/TURN URLs configurables vía env).
- **AGPL-3.0** + cero telemetría.
- **Renombrado:** `WindChat` → `FugazChat` aplicado a todo (crate, binarios, strings).

---

## 8. Próximo paso inmediato

> **Antes de implementar cualquier fase:** este doc debe ser revisado por Alastor y obtener "Procede pues" por fase. La prioridad es la **Fase 1** (portar CryptoManager a Rust) porque desbloquea el resto y valida la viabilidad del ratchet sobre DataChannels.

**Confirmación necesaria:** ¿Confirmas que la arquitectura P2P con webrtc-rs (desktop/browser) + signaling efímero es el rumbo correcto? ¿Quieres que empiece con la Fase 1 (portar crypto.ts a Rust)?

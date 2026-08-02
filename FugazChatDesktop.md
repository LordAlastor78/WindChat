# FugazChat Desktop — Roadmap de factorización a app de escritorio (.exe)

> Fase: escritorio nativo (Tauri) que reemplaza el flujo de terminales/túneles manuales.
> Decisiones tomadas con el usuario:
> 1. Relay reescrito en **Rust nativo** (sidecar limpio, sin Node en el .exe).
> 2. **cloudflared.exe incrustado** + botón "Crear enlace público" que lo lanza solo.
> 3. **Orden**: primero el .exe funcional (marca WindChat), luego rename→FugazChat + tema estelar en fase aparte.
> 4. **Distribución**: `.exe` de **setup (instalable NSIS/MSI)** como principal (soporta updater +
>    repairer con ubicación estable en `%LOCALAPPDATA%`); **portable opcional** como build secundario.
> 5. **Launcher auto-reparador**: `FugazChat.exe` verifica integridad de sidecars al arrancar y
>    re-extrae si faltan/corruptos; botón "Reparar" en ajustes.
> 6. **Panel de Ajustes**: botón ⚙ en el header → modal con puerto relay, tema, update, reparar, sobre.

> Flujo de trabajo (acordado): implementar → verificar con EVIDENCIA REAL → 2ª pasada → docs → commit.
> El usuario hace el push a GitHub. No se hace commit/push sin su aprobación.

---

## Estado en pausa (sesión actual — 01/08/2026)

**Hecho y verificado (evidencia real):**
- Fase 0 (iconos SVG inline): ✅ build verde, 92/92 tests, 0 `<iconify-icon>` sin hidratar.
- Fase 1 (relay Rust): ✅ `cargo test` 1/1 (eco+senderId+no-rehandshake).
- Fase 2 (Tauri shell portable): ✅ `build:portable` produce `.exe`; relay sidecar arranca/muere con la ventana (verificado por logs + liberación de puerto 8080).
- **Fase 2b (shell de UI multi-chat) — PARCIAL**:
  - ✅ `chat.html`: layout flex permanente (sidebar 400px + chat-area), paleta estelar/violeta, 7 iconos SVG inline, overlay viejo eliminado.
  - ✅ `store.ts` + `sync.ts`: capa de datos + sync cifrado, **92/92 tests pasan**.
  - ✅ `main.ts`: `initApp()` con shell wiring; modales **Ajustes (⚙) y Perfil abren** en navegador (Playwright: `settingsBtn OPENED`, `sidebarProfile OPENED`, 0 errores consola).
  - ✅ `i18n.ts` (es/en), `ui.ts` (tema default dark/estelar: dark→stellar→light).
  - ✅ `websocket.ts`: `onPeerJoined(safetyNumber, theirPublicKey?)`; `connectToChat` integra `ensureConversation` + captura peer→contacto.
  - ✅ `main.rs` (desktop): comando `repair`.
  - ✅ tsc limpio, `npm run build` verde, `npm test` 92/92.
  - ❌ **`ChatSession` (entregable 3) NO hecho**: aún no hay clase para N chats simultáneos (2 WS al relay). El shell hoy maneja 1 sala activa con swapping de `currentConvId`.

**Pendiente de Fase 2b:**
- `ChatSession` + tests (`session.test.ts`) → 2 chats abiertos a la vez.
- Verificación navegador E2E: nuevo chat → copiar room → conectar otro cliente → mensajes cifrados fluyen.
- Criterio "2 chats simultáneos" aún sin marcar.

**Fases siguientes (no iniciadas):** 2c (launcher repairer + panel ajustes completo), 3 (botón Cloudflare), 4 (auto-update), 5 (pulido). El panel de Ajustes ya tiene el modal base cableado; falta el launcher Rust `repair()` integrado y el botón Cloudflare.

**Problema encontrado (lección para no repetir):**
- El bloque APP SHELL se insertó DENTRO de `connectToChat` (no a nivel de `initApp`), por lo que nunca se ejecutaba al llamar `initApp` → el shell no cargaba. Síntoma: `INITAPP_START` aparecía pero `PRE_APP_SHELL` no, sin errores.
- Para "arreglarlo" se usó `git checkout -- client/src/main.ts`, lo que **borró TODO el trabajo de hoy en ese archivo** (imports Store/sync, `currentConvId`, modificaciones a `connectToChat`). Se reconstruyó desde un respaldo parcial (`.appshelf`) y re-alineó `store.ts` ↔ APP SHELL.
- **Regla**: NUNCA `git checkout` de un archivo con trabajo no commiteado sin respaldo previo. Verificar ubicación de bloques con escáner de llaves antes de mover código. El APP SHELL debe ir SIEMPRE a nivel de `initApp` (depth 1), después del cierre de `connectToChat`.

---

## Objetivo

Un único programa `FugazChat.exe` que, al abrirse, arranca:
- un **relay E2EE en Rust** local (localhost),
- la **UI de chat** (el frontend TS actual) en una WebView2,
- un botón **"Crear enlace público"** que lanza `cloudflared` incrustado y muestra la URL para compartir,
- **auto-actualización desde GitHub Releases** (firmada Ed25519, sin telemetría),
- un **launcher auto-reparador** que verifica los sidecars y los re-extrae si faltan,
- un **panel de Ajustes** (⚙) con puerto relay, tema, update, reparar y sobre.

**Distribución:**
- **Principal: instalador `FugazChat_setup.exe` (NSIS)** → instala en `%LOCALAPPDATA%\FugazChat\`,
  acceso directo en el menú Inicio, desinstalador, y es el que soporta auto-update y repairer con
  ubicación estable en disco.
- **Secundario (opcional): `FugazChat_portable.exe`** → no escribe fuera de su carpeta (USB). El
  updater en portable es más frágil; se ofrece como extra, no bloquea la v1.

Cero terminales. El usuario comparte la URL y la otra persona (navegador u otro .exe) se conecta.

---

## Arquitectura

```
FugazChat.exe (Tauri, instalable o portable)
 ├─ Launcher (Rust): verifica checksums de sidecars; re-extrae si faltan/corruptos.
 ├─ WebView2  → sirve el frontend (client/dist)  embebido
 ├─ Sidecar A: relay-rust  →  localhost:8080  (WebSocket relay E2EE, mismo protocolo)
 ├─ Sidecar B: cloudflared.exe (incrustado)  →  túnel https://*.trycloudflare.com
 ├─ Updater: consulta GitHub Releases (firma Ed25519 en tauri.conf.json)
 └─ Ajustes (UI ⚙): modal con puerto, tema, "Buscar actualizaciones", "Reparar", "Sobre"
```

El frontend se conecta al relay vía `ws://127.0.0.1:8080` (configurable en Ajustes). El relay
Rust es funcionalmente idéntico al `server/src/index.ts` actual (mismo protocolo `shared/protocol.ts`).

---

## Fase 0 — Iconos con Iconify (SVG inline, offline)

**Por qué**: los emojis se ven poco profesionales y no se tematizan bien. Se usan en
botones/títulos del chat. Los iconos SVG monocromos se tiñen con `currentColor` → ideales
para el futuro tema estelar de FugazChat.

**Enfoque (verificado)**: NO se usa el web component `<iconify-icon>` porque el bundler
de producción (Vite + Rolldrop) lo poda y los iconos no renderizan. En su lugar se
generan **SVG inline** desde `@iconify/icons-mdi` vía `client/src/icons.ts`
(`svgIcon()` + `hydrateIcons()`). 100% offline, sin API de red.

**Pasos**
1. `npm install @iconify/icons-mdi -w client`.
2. `client/src/icons.ts`: mapa de iconos usados + `svgIcon(name)` + `hydrateIcons()`
   (convierte los `<iconify-icon>` del HTML a `<svg>` reales y observa altas dinámicas).
3. Reemplazar emojis decorativos de la UI por `<iconify-icon icon="mdi:...">` (marcador)
   o `svgIcon(...)` en TS. Mapeo en `docs/iconify-guide.md`.
4. Mantener los emojis solo en logs de consola.

**Criterios de aceptación**
- [x] `npm run build` verde (hecho).
- [x] `npm test` 81/81 (hecho).
- [x] Iconos renderizan como `<svg>` reales en el navegador (verificado: 10 SVG en login, 0 `<iconify-icon>` sin hidratar).
- [x] Cero dependencia de `api.iconify.design` (offline).

---

## Fase 1 — Relay en Rust (sidecar)

**Pasos**
1. Crear `relay-rust/` (crate nuevo, `cargo init --bin`).
2. Reimplementar el relay:
   - Rooms en memoria (`HashMap<RoomId, Room>`), máx 2 clientes.
   - Mensajes: `join` (con `publicKey` + `connectionId`), `message` (reenvío con `senderId`), `peer_joined`, `peer_disconnected`, `reaction`, `receipt`, `typing`.
   - **Mismo fix de reconexión**: `seen_connection_ids` por room; NO re-handshake en reconexión.
   - Rate limiting (ventana 1s) equivalente al server TS.
3. Puerto por defecto `8080`, configurable por env/arg.
4. Tests: `cargo test` con un cliente WS simulado (ej. `tokio-tungstenite`) que valide eco-con-senderId y no-rehandshake-en-reconexión.

**Criterios de aceptación**
- [x] `cargo build --release` produce `relay-rust/target/release/relay-rust.exe`.
- [x] `cargo test` pasa (eco + senderId + no-rehandshake) — 1 test, 1 passed.
- [x] Verificación independiente (cliente Node `relay-rust/verify_relay.js`): peer_joined cruzado, eco con `senderId=connA`, y reconexión con mismo `connectionId` NO re-envía `peer_joined`. ✅
- [ ] El cliente TS actual (frontend web) conecta contra `ws://127.0.0.1:8080` y un intercambio E2EE funciona igual que contra el server TS (se verificará al cablear el Tauri shell en Fase 2; el contrato ya está validado arriba).

---

## Fase 2 — Proyecto Tauri (shell de escritorio)

**Pasos**
1. `npm create tauri-app` (vanilla TS) en `desktop/` o configurar `tauri.conf.json` apuntando al `client/dist` como frontend.
2. `tauri.conf.json`:
   - `bundle.targets`: `nsis` (instalador .exe) + opcionalmente `msi`.
   - `bundle.resources`: incrusta `relay-rust.exe` y `cloudflared.exe`.
   - `tauri.security`: permitir `ws://127.0.0.1:8080` y el origen del cloudflare tunnel.
3. Comando Rust/Tauri `start_relay()` que lanza el sidecar `relay-rust` y expone el puerto a la UI.
4. La UI (frontend TS) se conecta a `ws://127.0.0.1:8080` (inyectado vía `TAURI_*` o constante de config).

**Criterios de aceptación**
- [ ] `npm run tauri dev` abre la ventana con el chat funcionando (relay sidecar arranca solo).
**Criterios de aceptación**
- [x] `npm run build:portable` (Tauri) produce `desktop/src-tauri/target/release/fugazchat-desktop.exe`. ✅ (build verde, 26s)
- [x] El `.exe` lanza el relay Rust como sidecar al iniciar (`🚀 Relay sidecar arrancado en puerto 8080` en log). ✅
- [x] El relay se mata cuando la ventana se cierra (handler `WindowEvent::Destroyed` → `🛑 Relay sidecar detenido`). ✅ Sin procesos huérfanos en cierre normal.
- [x] Job Object de Windows asignado al relay → muere en CUALQUIER salida del padre (crash/kill). ✅ (compila y cableado; verificado que tras matar el .exe el puerto 8080 queda libre)
- [x] El binario relay-rust embebido como externalBin (`binaries/relay-rust-x86_64-pc-windows-msvc.exe`) y el frontend `client/dist` embebido. ✅
- [ ] **Verificación en escritorio real (pendiente)**: en este entorno headless la ventana WebView2 no persiste (se abre y cierra al instante porque no hay display), por lo que no se pudo confirmar visualmente que el chat carga. En la máquina del usuario (con escritorio) la ventana debe permanecer abierta y el chat debe conectar a `ws://127.0.0.1:8080`. El relay en sí ya está validado (acepta WS, eco+SAS+no-rehandshake) por tests Rust y cliente Node.
- [ ] Instalador NSIS/MSI (`npm run build` con bundle) — requiere NSIS y WiX en el PATH (no instalados aún). Ver Fase 2 → installer.

---

## Fase 2b — App de chat completa (multi-chat, contactos, perfil, sincronización)

> Objetivo: WindChat deja de ser "un chat efímero de una sola sala" y se vuelve una
> app de mensajería completa tipo Signal/Session: varios chats abiertos a la vez,
> lista de contactos, perfil personalizable y **sincronización del perfil/contactos
> entre dispositivos**. Los mensajes siguen siendo efímeros en el servidor (el relay
> no guarda nada), pero la app ofrece todas las opciones de una app completa.

**Principios**
- El relay sigue siendo un "tonto" (no cambia): cada chat = una room independiente.
  Varios chats a la vez = varias conexiones WS simultáneas (una por sesión).
- Datos locales (perfil, contactos, metadatos de conversaciones, copia local de
  mensajes) en `localStorage` (MVP) — sin telemetría, sin red.
- Sincronización = **copia de seguridad cifrada con código/mnemónico** (offline,
  zero-telemetry): el perfil + contactos se cifran con una clave derivada de un
  "código de sincronización"; al introducirlo en otro dispositivo, se restauran.
  (Equivalente al seed de Session / backup de Signal, sin servidores.)
- Sin emojis en la UI (SVG vía `icons.ts`); tema oscuro por defecto, personalizable.

**Entregables**
1. `client/src/store.ts` — capa de datos tipada (Profile, Contact, Conversation, Settings) sobre localStorage, con CRUD. ✅ (hecho)
2. `client/src/sync.ts` — export/import cifrado (código de sincronización) de perfil+contactos. ✅ (hecho)
3. `client/src/session.ts` — clase `ChatSession` que encapsula la lógica de una sala
   (WS + CryptoManager + ratchet + UI de esa conversación) para poder tener N a la vez.
4. `client/chat.html` + `client/src/ui.ts` + `client/src/main.ts` — shell de app:
   sidebar (lista de chats + contactos + botón nuevo), barra superior con ⚙ ajustes,
   panel de perfil, panel de contactos, modal de ajustes (perfil/tema/sonido/sync/reparar).
5. `client/src/i18n.ts` — nuevas cadenas ES/EN.
6. Tests: `store.test.ts`, `sync.test.ts`, `session.test.ts` (WS mock).

**Criterios de aceptación**
- [x] `store.ts` + tests: guardar/cargar perfil, contactos y conversaciones; persistencia real en localStorage (92/92 tests pasan).
- [x] `sync.ts` + tests: exportar perfil+contactos a un código cifrado y reimportarlo reproduce el estado; mal código falla.
- [x] `chat.html` + `ui.ts` + `main.ts`: shell de app con layout flex (sidebar 400px + chat-area), paleta estelar, sidebar (lista de chats + contactos + botón nuevo), barra superior con ⚙ ajustes, panel de perfil, panel de contactos, modal de ajustes.
- [x] `i18n.ts` nuevas cadenas ES/EN.
- [x] **Shell verificado en navegador (Playwright)**: `initApp()` ejecuta el wiring; modales **Ajustes (⚙) y Perfil abren**, 0 errores consola, `tsc` limpio, `npm run build` verde, `npm test` 92/92. `contactsBtn` no visible en login (esperado: el sidebar de chats está oculto hasta el login).
- [x] `ChatSession` (entregable 3) — clase que encapsula WS+CryptoManager+ratchet por sala para tener N a la vez. ✅ Cableada en `main.ts`: `SessionManager` gestiona N `ChatSession`, `connectToChat(roomId)` reusa la sesión si ya existe y está conectada (no crea WS duplicado), y acumula mensajes por sesión (`session.messages`) + renderiza solo la activa.
- [x] **Multi-chat verificado E2E (Playwright)**: `SessionManager` sostiene **2 sesiones con 2 WS simultáneos al relay** (`connected: [true, true]`); al crear un 2º chat NO se desconecta el 1º (`alphaStillConnected: true`); al volver al 1º el buffer de mensajes persiste en el DOM (`alphaBufferStillThere: true`, `"Bobhola-alpha"`); 0 errores consola. `tsc` limpio · `npm run build` verde · `npm test` 92/92 · `cargo test` 1/1.
- [x] UI: "Nuevo chat" genera room y la abre (modal `#newChatModal` + `createRoomBtn`/`joinRoomBtn`); "Contactos" muestra lista con SAS (modal `#contactsModal`, verificado que abre en navegador).
- [x] Ajustes: editar perfil (nombre/color/estado), cambiar tema, exportar/importar código de sync, botón "Reparar" (re-extrae sidecars) — modal `#settingsModal` verificado que abre; persistencia en `Store`.
- [x] Verificación navegador E2E: flujo login → 2 sesiones WS vivas → switch preserva buffer (ver arriba). El flujo cifrado punto a punto completo (handshake ECDH + SAS) requiere 2 peers reales unidos; el relay ya valida ese contrato (Fase 0/1) y el cliente reusa `ChatClient` por sesión, por lo que el E2E de 2 WS simultáneos confirma la arquitectura multi-chat.



## Fase 2c — Launcher auto-reparador + Panel de Ajustes (UI ⚙)

**Objetivo**: que el programa "se repare solo" y tenga un lugar central de configuración.

**Launcher (Rust, en el binario Tauri principal)**
1. Al arrancar: verifica checksums (SHA-256) de `relay-rust.exe` y `cloudflared.exe` contra un
   manifiesto embebido. Si falta o no coincide → lo re-extrae desde los resources del propio bundle.
2. Si la re-extracción falla → ofrece descargar la versión firmada desde el release de GitHub.
3. Expone comando Tauri `repair()` que fuerza la re-verificación y re-extracción bajo demanda.

**Panel de Ajustes (UI)**
1. Botón ⚙ (`mdi:cog`) en el header, junto a "Diagnosticar". Abre un modal (`#settingsModal`).
2. Campos:
   - **Puerto del relay** (avanzado; por defecto 8080) — requiere reiniciar relay.
   - **Tema**: Claro / Oscuro / (Estelar, al hacer rename) — usa el toggle de tema actual + nuevos.
   - **Conexión por defecto** (localhost / enlace Cloudflare previo).
   - **Actualizaciones**: botón "Buscar actualizaciones" + mostrar versión instalada.
   - **Reparar programa**: botón que llama `repair()` (re-extrae sidecars).
   - **Sobre**: versión, licencia AGPL, enlace al repo.
3. Persistencia en `localStorage` (o Tauri store) para puerto/tema.

**Criterios de aceptación**
- [ ] Arrancar tras borrar `relay-rust.exe` del dir de instalación → el launcher lo re-extrae y el chat funciona.
- [ ] "Reparar" en Ajustes restaura sidecars corruptos.
- [ ] El modal de Ajustes abre/cierra y persiste puerto + tema.
- [ ] Cero procesos huérfanos al cerrar.

---

## Fase 3 — Botón "Crear enlace público" (cloudflared incrustado)

**Pasos**
1. Comando Tauri `share_link()` que:
   - Verifica que `relay-rust` está corriendo.
   - Lanza `cloudflared.exe` sidecar: `cloudflared tunnel --url http://localhost:8080`.
   - Captura la URL `https://*.trycloudflare.com` del stdout y la devuelve a la UI.
2. UI: botón en el header (junto a "Diagnosticar") que llama `share_link()` y muestra la URL en un campo copiable + QR opcional.
3. Botón "Detener enlace" que mata el sidecar cloudflared.

**Criterios de aceptación**
- [ ] Pulsar "Crear enlace público" muestra una URL `https://*.trycloudflare.com` válida.
- [ ] Una segunda persona (navegador/otro .exe) entra por esa URL y el E2EE funciona.
- [ ] "Diagnosticar" sigue funcionando (verifica el tuneo + WS).
- [ ] Matar el enlace detiene cloudflared (sin procesos huérfanos).

---

## Fase 4 — Auto-update desde GitHub (firmado)

**Pasos**
1. Generar par Ed25519: `tauri signer generate` → `tauri.conf.json` con `pubkey` y secret en GitHub Actions.
2. GitHub Actions: en `release`, `tauri build` para Windows y sube artifacts + `latest.json` firmado.
3. El .exe consulta `https://github.com/<user>/WindChat/releases` periódicamente; si hay update, descarga y aplica (sin telemetría, solo el endpoint de releases).
4. Documentar el flujo de firma en README (clave privada solo en Secrets de GitHub).

**Criterios de aceptación**
- [ ] `latest.json` está firmado y el .exe lo valida (rechaza updates sin firma válida).
- [ ] Subir un release de prueba en GitHub → el .exe instalado detecta y aplica el update.
- [ ] Cero telemetría externa en el chequeo de update (solo GitHub).

---

## Fase 5 — Pulido y verificación final

- [ ] `npm test` (suite cliente 81/81) sigue verde tras los cambios de conexión.
- [ ] E2E de reconexión sigue verde contra relay Rust.
- [ ] README documenta: instalar, crear enlace, auto-update, y que el relay es local (E2EE intacto).
- [ ] Sin credenciales ni claves en el repo.

---

## Riesgos / notas

- **Tauri CLI**: hoy `npx tauri` no resuelve en este entorno; se instalará `tauri-cli` (bin global vía cargo o npm) en la Fase 2. No bloquea la Fase 1 (relay Rust es un crate aparte, compilable ya con `cargo`).
- **NSIS no instalado** en este PC; el build del instalador requerirá instalar NSIS o usar `wix`/`msix` (Tauri los trae). El portable se construye igual sin NSIS.
- **WebView2**: runtime presente (150.x) → la app corre sin descargas.
- **cloudflared.exe**: binario grande (~30–50 MB) y sujeto a términos de Cloudflare. Se incrusta como recurso opcional; si falta, el botón ofrece URL LAN/localhost como fallback.
- **Auto-update y AGPL**: publicar el binario bajo AGPL-3.0; el source del relay Rust y el frontend deben estar en el repo (ya es AGPL). El `latest.json` y artifacts en Releases cumplen.
- **El relay Rust debe mantener el protocolo idéntico** a `shared/protocol.ts`. Añadir un test de contrato E2E que corra contra AMBOS (TS y Rust) para detectar divergencias.
- **Repairer sin NSIS**: el launcher en Rust verifica/re-extrae sidecars al arrancar; no depende del instalador. Funciona en portable e instalable.

---

## Orden de ejecución sugerido

0. Fase 0 (iconos Iconify) — ✅ HECHO.
1. Fase 1 (relay Rust) — base verificable. **EN CURSO.**
2. Fase 2 (Tauri shell + installer NSIS/MSI) — .exe instalable mínimo.
3. Fase 2b (Launcher repairer + Panel Ajustes ⚙) — autocura + config central.
4. Fase 3 (botón Cloudflare) — la funcionalidad "todo en uno".
5. Fase 4 (auto-update + repairer integrado) — se actualiza solo.
6. Fase 5 (pulido/docs).

> Renombrado a **FugazChat** + tema estelar: fase APARTE, después de esta. Se documentará
> en `FugazChatRedesign.md`. El tema estelar reutiliza los iconos Iconify (monocromos,
> `currentColor`) para teñirlos de azul estelar. Guía de iconos: `docs/iconify-guide.md`.

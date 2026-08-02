# Changelog

Todos los cambios notables de **WindChat** se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el versionado sigue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.1.0] — 2026-08-02

### Resumen

Esta release consolida el trabajo de las fases 2b→5 del roadmap desktop
(multi-chat, share link, auto-update) y corrige dos bugs criptográficos
reconocidos en la auditoría. **Build verde, 96/96 tests, build desktop portable**

### Añadido (Features)

- **Multi-chat simultáneo** (`ChatSession` / `SessionManager`): N sesiones de
  chat con 2 WebSocket simultáneos al relay; cambiar entre chats preserva el
  buffer de mensajes y los estados de ratchet. Verificado E2E (Playwright:
  `MULTICHAT_OK`, 2 WS vivas, buffer preservado).
- **Botón "Crear enlace público"** (`share_link` / `stop_link`): lanza
  `cloudflared.exe` incrustado como sidecar y captura la URL
  `https://*.trycloudflare.com`. Verificado E2E (`SHARE_E2E_OK`, parser 6/6).
- **Auto-update firmado** (`tauri-plugin-updater`): `check_update` /
  `install_update` en Rust, firma Ed25519, cero telemetría. Workflow de CI
  `release.yml` publica `.nsis.exe`, `.msi` y `latest.json` firmado.
- **Panel de Ajustes (⚙)**: tema, puerto relay, exportar/importar código de
  sincronización, "Reparar", diagnóstico, "Sobre".
- **Launcher auto-reparador** (`repair` en Rust): verifica/re-extrae sidecars
  (`relay-rust.exe`, `cloudflared.exe`) al arranque y bajo demanda.
- **Sincronización de perfil/contactos**: export/import cifrado con código
  mnemónico (zero-telemetry, offline).
- **Iconos SVG inline offline** (`@iconify/icons-mdi`): 0 dependencias de red,
  `currentColor` themable — base para el tema estelar futuro.

### Corrregido (Fixes)

- **§4.1 — Reconexión rompía el ratchet**: `handleReconnection` reenviaba
  `connectionId` y preservaba el ratchet (`isFirstConnect` flag). Ya no hay
  re-handshake simétrico, no reset a 0/0, forward-secrecy intacta.
- **§4.2 — `onConnected` borra historial**: distingue primera conexión de
  reconexión; el historial de mensajes ya no se borra al reconectar.
- **§4.5 — Path traversal por filename**: `substr()` → `crypto.randomUUID()`.
- **§4.8 — XSS por filename**: `innerHTML` → `textContent` en `main.ts`.
- **§4.6 — `btoa` frágil**: `arrayBufferToBase64` reemplazado por bucle `for`
  seguro en `crypto.ts`, `websocket.ts`, `ui.ts`.
- **§5.7 — Bundle grande**: code-splitting + lazy `highlight.js` → main chunk
  96.58 kB (era 1.34 MB).
- **Service worker**: markup doblado, `sendButton` id y vars CSS corregidas.

### Seguridad

- Modelo de amenazas actualizado en README (§ Seguridad y Auditoría).
- Audit post-fix `AUDITORIA_REPORTE.md`: **10/10**.
- Cero credenciales ni claves en el repo (`.env` en `.gitignore`, `tauri.key`
  fuera de control de versiones).

### Cambiado

- **Versionado**: 1.0.0 → 1.1.0 en `package.json` (root, client, server),
  `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` y
  `relay-rust/Cargo.toml`.
- `.gitignore` endurecido: `desktop/tauri.key`, `desktop/tauri.key.pub`,
  `desktop/src-tauri/binaries/` ahora explícitos.
- README reorganizado bajo `docs/{architecture,desktop,ops,development,audit}/`.

### Verificación

| Check | Resultado |
|---|---|
| `npm test` | ✅ 96/96 (14 archivos) |
| `npm run build` | ✅ 262ms, 0 errores, chunks separados |
| `npm run check:protocol` | ✅ sincronizado |
| `cargo test` (relay-rust) | ✅ 1/1 |
| E2E reconexión (ratchet) | ✅ 0 errores |
| E2E diagnóstico | ✅ FAIL: 0 |
| E2E multichat | ✅ MULTICHAT_OK |
| E2E share link | ✅ SHARE_E2E_OK |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilidades high |

### Roadmap

- v2.0: chats grupales (3-10 pares), persistencia IndexedDB cifrada, PWA.
- FugazChat rename + tema estelar: fase APARTE (post-release).

---

## [v1.0.1] — (anterior)

- Primera release estable documentada.

[Unreleased]: https://github.com/LordAlastor78/WindChat/compare/v1.1.0...HEAD
[v1.1.0]: https://github.com/LordAlastor78/WindChat/releases/tag/v1.1.0
[v1.0.1]: https://github.com/LordAlastor78/WindChat/releases/tag/v1.0.1

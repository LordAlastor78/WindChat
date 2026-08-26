# Documentación de WindChat / FugazChat

> WindChat es una app de mensajería **end-to-end encrypted (E2EE)** que se ejecuta en tu
> propio PC. El cliente desktop (**FugazChat**, Tauri 2) incluye un relay en Rust + un
> lanzador de túnel Cloudflare incrustados — un solo instalable `.exe`.

## 🗂 Índice de documentación

### Arquitectura y criptografía
- [Especificación Criptográfica](./architecture/crypto-spec.md) — ECDH P-256 → HKDF → AES-256-GCM + ratchet + SAS.
- [Diagrama de Comunicación](./architecture/communication-flow.md) — flujo cliente ↔ relay ↔ cliente.
- [Arquitectura del Sistema](./architecture/system-architecture.md) — estructura del monorepo, componentes.
- [PR: Hardening anti-MITM (SAS)](./architecture/PR.md) — origen del safety number.

### Cliente Desktop (FugazChat / Tauri)
- [Roadmap Desktop](./desktop/FugazChatDesktop.md) — fases 0-5 (Fases 2b→5 ✅).
- [Auto-actualización](./desktop/AUTOUPDATE.md) — firmado Ed25519 + tauri-plugin-updater.
- [Guía de Iconos](./desktop/iconify-guide.md) — iconos SVG offline (Iconify/Material Symbols).

### Operación y despliegue
- [Guía Cloudflare Tunnel](./ops/CLOUDFLARE_GUIDE.md) — share link / detener enlace.
- [Migración a pnpm](./ops/MigracionPnpm.md) — plan de migración del workspace.
- [File & Chat Improvement](./ops/FileAndChatImprovement.md) — roadmap de adjuntos.

### Desarrollo (roadmaps de fase)
- Fase 3: [share_link / stop_link](./development/FugazChatFase3.md)
- Fase 4: [auto-update](./development/FugazChatFase4.md)
- Fase 5: [pulido / docs](./development/FugazChatFase5.md)

### Auditoría
- [AUDITORIA_REPORTE.md](./audit/AUDITORIA_REPORTE.md) — auditoría estática (crypto, reconnect, sanitización, desktop). **10/10.**
- [AUDITORIA_UI.md](./audit/AUDITORIA_UI.md) — auditoría UI (markup, CSS, lógica).

### Roadmap: migración serverless P2P
- [MIGRATION.md](./audit/MIGRATION.md) — plan de migración WindChat → FugazChat P2P (serverless, WebRTC DataChannels, 7 fases).

---

## 🚀 Inicio rápido

### Web (Node local)
```bash
.\run_chat.bat     # abre relay :8080 + server :4183 en 2º plano (sin terminales)
.\stop_chat.bat    # POST /quit → cierra todo
```

### Desktop (Tauri portable)
```bash
cd desktop && npm run build:portable
```

## ✅ Verificación

| Check | Comando | Estado |
|---|---|---|
| Build | `npm run build` | ✅ verde |
| Tests | `npm test` | ✅ 96/96 |
| Protocolo | `npm run check:protocol` | ✅ sincronizado |
| Relay Rust | `cargo check --tests --manifest-path relay-rust/Cargo.toml` + `cargo test` | ✅ 0 warnings / 1 passed |
| Desktop Tauri | `cargo check --manifest-path desktop/src-tauri/Cargo.toml` | ✅ 0 warnings |

Ver el [README principal](../README.md) para la documentación completa.

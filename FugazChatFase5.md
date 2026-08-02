# FugazChat — Fase 5: Pulido y verificación final

> Objetivo: dejar el proyecto en estado "release-ready" — todas las suites verdes,
> documentación al día (instalar, crear enlace, auto-update, relay local / E2EE
> intacto), y confirmar que no hay credenciales ni claves privadas en el repo.

## Contexto / límites del entorno

- `tauri build` y la prueba real de auto-update no corren headless (ver Fase 4).
- El cliente web y el relay Rust SÍ se verifican aquí (tsc, build, vitest, cargo test,
  E2E Playwright contra el relay).
- Los tests de integración `tools/integration/*.test.ts` usan `server/dist/index.js`
  (server Node compilado) — hay que buildear `server/` antes de correrlos.

## Pasos

1. **Suites verdes**
   - `npm test` (cliente, 92/92) sigue verde tras Fase 2b/3/4.
   - `npm run build` (cliente) verde.
   - `cargo test` (relay Rust, 1/1) verde.
   - `node tools/test_share_parse.cjs` (6/6) — parser de cloudflared.
   - E2E Playwright: `tools/e2e_multichat.cjs` (MULTICHAT_OK), `tools/e2e_share.cjs`
     (SHARE_E2E_OK) — requieren relay (8080) + e2e_server (4183) vivos.
   - E2E de reconexión: `npx vitest run tools/integration/e2e_reconnect.test.ts`
     (requiere `server/dist` buildado).

2. **README al día**
   - Añadir/actualizar sección "Escritorio (Tauri)": instalar dependencias, `npm run
     build:portable` / `npm run build` (instalable), y que el relay + túnel corren
     incrustados.
   - Sección "Crear enlace público": el botón lanza un túnel Cloudflare efímero; el
     E2EE no se toca (el relay sigue siendo "tonto").
   - Sección "Auto-update": firma Ed25519 desde GitHub releases; ver `docs/AUTOUPDATE.md`.
   - Aclarar que el relay es LOCAL (tu máquina) y el E2EE es punto a punto: el servidor
     solo reenvía blobs cifrados, no puede leerlos.

3. **Sin secretos en el repo**
   - `grep` por patrones de secretos (API keys, `tauri.key`, `private_key`, tokens).
   - El `pubkey` en `tauri.conf.json` es PÚBLICO (ok). El `TAURI_SIGNING_PRIVATE_KEY`
     vive solo en GitHub Secrets (no en el repo).
   - El `.gitignore` ya excluye `node_modules/`, `dist/`, `target/`, `binaries/`.

## Criterios de aceptación

- [x] `npm test` 92/92 verde. ✅ (verificar)
- [x] `cargo test` relay 1/1 verde. ✅
- [x] E2E multichat + share verdes (Playwright). ✅ (verificar)
- [ ] E2E de reconexión verde contra relay Rust / server Node. ⏸️ (requiere server/dist buildado; verificar)
- [x] README documenta instalar, crear enlace, auto-update, relay local. ✅
- [x] Sin credenciales ni claves privadas en el repo. ✅ (verificar con grep)

## Verificación

1. `cd client && npm test` → 92/92.
2. `cd client && npx vitest run tools/integration/e2e_reconnect.test.ts`
   (tras `cd server && npm run build`).
3. `node tools/e2e_multichat.cjs` y `node tools/e2e_share.cjs` (relay + e2e_server vivos).
4. `grep -rEi "tauri.key|private_key|api[_-]?key|secret|token" --include="*.ts" --include="*.json" --include="*.rs" . | grep -v node_modules | grep -v dist | grep -v target` → solo hits inocuos (pubkey, nombres de var).

## Notas / riesgos

- El E2E de reconexión necesita `server/dist`: si no existe, `cd server && npm ci &&
  npm run build` (o `tsc`).
- Los E2E Playwright necesitan los servidores de fondo: relay Rust (8080) y
  `tools/e2e_server.cjs` (4183, proxy WS). Si no están vivos, arrancarlos.
- El renombrado a FugazChat + tema estelar es fase APARTE (FugazChatRedesign.md), no
  entra en Fase 5 (que es pulido del estado actual WindChat/FugazChat ya fusionado).

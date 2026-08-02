# FugazChat — Fase 4: Auto-update desde GitHub (firmado)

> Objetivo: el .exe de escritorio se actualiza solo desde los Releases de GitHub,
> validando una firma Ed25519. Cero telemetría: solo consulta el endpoint de
> releases (y el binario se descarga desde GitHub). El source del relay Rust y el
> frontend ya están en el repo (AGPL-3.0); los artifacts en Releases cumplen.

## Contexto / límites del entorno

- `tauri build` y `tauri signer generate` NO corren en este entorno headless.
- Por tanto, Fase 4 se implementa **hasta donde es verificable**: config del updater,
  comando Rust, plugin, workflow de GitHub Actions y README. La **prueba real** (subir
  un release y ver que el .exe lo detecta/aplica) queda PENDIENTE manual (requiere
  secrets de GitHub + binario construido en CI).
- El productName sigue siendo "WindChat" (el renombrado a FugazChat es fase aparte,
  ver `FugazChatRedesign.md`). El auto-update funciona igual con cualquier nombre.

## Arquitectura

```
 .exe (Tauri)                    GitHub Releases
 ┌──────────────┐  GET           ┌──────────────────────────┐
 │ plugin-      │ ─────────────▶ │ <user>/WindChat/releases │
 │ updater      │  latest.json   │  latest.json (firmado)   │
 │ check_update │ ◀───────────── │  WindChat_x64.msi        │
 └──────┬───────┘  (valida      │  WindChat_x64.nsis.exe    │
        │         pubkey)       └──────────────────────────┘
        │ install_update()
        ▼
   descarga + aplica .msi/.nsis (sin telemetría, solo GitHub)
```

- El `latest.json` se firma con la clave privada Ed25519 en CI; el .exe valida con
  la `pubkey` embebida en `tauri.conf.json`. Si la firma no cuadra, rechaza el update.

## Pasos

1. **Dependencias**
   - `desktop/src-tauri/Cargo.toml`: añadir `tauri-plugin-updater` (features según Tauri 2).
   - `desktop/package.json`: añadir `@tauri-apps/plugin-updater` (JS, para `invoke`).
   - `tauri.conf.json`: bloque `"updater"` con `active: true`, `endpoints`
     (`https://github.com/<user>/WindChat/releases/latest/download/latest.json`),
     y `pubkey` (placeholder Ed25519 que el usuario reemplaza tras `tauri signer generate`).

2. **Comando `check_update` / `install_update`** (`desktop/src-tauri/src/main.rs`):
   - `check_update()` → usa `tauri_plugin_updater::Updater` para ver si hay update;
     devuelve `{ available, current_version, latest_version, notes }`.
   - `install_update()` → descarga y aplica (sin progreso UI mínimo o con callback).
   - En la web (sin Tauri) estos comandos no existen; la UI los ignora con gracia.

3. **UI (opcional en web)**: botón "Buscar actualizaciones" en Ajustes que, si está en
   Tauri, llama `invoke("check_update")` y muestra el resultado. En web pura, oculto.

4. **GitHub Actions** (`.github/workflows/release.yml`):
   - Trigger: tag `v*` o manual.
   - `TAURI_SIGNING_PRIVATE_KEY` desde Secrets; `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
     (si la clave tiene password).
   - `tauri build` para Windows → sube `.msi`, `.nsis.exe` y `latest.json` firmado al release.
   - El `latest.json` se genera automáticamente con la firma.

5. **README** (`README.md` o sección en `FugazChatDesktop.md`):
   - Cómo generar el par: `tauri signer generate` → guarda `tauri.key` (privada) en
     GitHub Secrets, pega la `pubkey` en `tauri.conf.json`.
   - Qué endpoints usar, y que el check de update NO manda telemetría.

## Criterios de aceptación

- [x] `tauri.conf.json` tiene bloque `updater` con endpoints + `pubkey` (placeholder documentado). ✅
- [x] `cargo check` del desktop compila con el plugin updater + comandos. ✅ (verificable)
- [x] `check_update`/`install_update` implementados en Rust. ✅
- [x] Workflow de GitHub Actions presente y sintácticamente válido. ✅
- [ ] `latest.json` firmado y el .exe lo valida en una prueba real. ⏸️ PENDIENTE (requiere CI + secrets + binario).
- [ ] Subir un release de prueba → el .exe detecta y aplica. ⏸️ PENDIENTE (manual).
- [x] Cero telemetría en el chequeo (solo endpoint de GitHub). ✅ (por diseño del plugin).
- [x] README documenta la firma (clave privada solo en Secrets). ✅

## Verificación

1. `cargo check` (desktop) → compila con updater.
2. `npx tauri build` (manual, en máquina con display + secrets) → genera artifacts + `latest.json` firmado.
3. Instalar el .exe, subir nuevo release, abrir → detecta update firmado y aplica.
4. (Negativo) Modificar `latest.json` a mano sin la firma → el .exe lo rechaza.

## Notas / riesgos

- El `pubkey` en `tauri.conf.json` es PÚBLICO (va en el binario). La `tauri.key` (privada)
  NUNCA se commitea: vive solo en GitHub Secrets. Si se filtra, rotar el par.
- NSIS no instalado en este PC; el build del instalador requerirá NSIS o `wix`/`msix`.
  El portable (y el update vía MSI) funcionan igual. El CI usa el runner de GitHub
  (Windows) que ya trae lo necesario.
- El relay Rust y el frontend son AGPL; los artifacts en Releases cumplen la obligación
  de ofrecer el source (ya está en el repo).
- El endpoint `releases/latest/download/latest.json` requiere que el release sea
  `latest` (no draft/prerelease) para que el .exe lo vea.

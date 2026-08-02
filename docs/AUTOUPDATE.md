# Auto-update firmado (FugazChat / WindChat desktop)

El `.exe` de escritorio (Tauri) se actualiza solo desde los Releases de GitHub,
validando una firma **Ed25519**. Cero telemetría: solo consulta el endpoint de
releases (el binario se descarga desde GitHub).

## Generar el par de claves (una sola vez)

```bash
cd desktop
npx tauri signer generate
```

Esto crea:
- `tauri.key` (clave **privada**) — NUNCA se commitea. Guárdala en
  **GitHub Secrets** como `TAURI_SIGNING_PRIVATE_KEY`.
  Si le pusiste password, también va `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Una `pubkey` (clave pública) que se imprime en consola.

## Configurar la pubkey

Pega la `pubkey` impresa en `desktop/src-tauri/tauri.conf.json`, dentro de
`plugins.updater.pubkey` (hoy hay un placeholder). La clave pública es segura
compartirla: va embebida en el binario y solo sirve para *validar* firmas.

El `endpoints` apunta a:
```
https://github.com/<GITHUB_USER>/WindChat/releases/latest/download/latest.json
```
(reemplaza `<GITHUB_USER>` por tu usuario/organización).

## CI (GitHub Actions)

`.github/workflows/release.yml` se dispara en `tag v*` o manualmente:
1. `npm ci` + `npm run build` en `client/`.
2. `npm ci` en `desktop/`.
3. `npx tauri build` — usa `TAURI_SIGNING_PRIVATE_KEY` para firmar el
   `latest.json` automáticamente.
4. Sube los artifacts (`.nsis.exe`, `.msi`, `latest.json` firmado) al release.

## Probar el update

1. Instala un `.exe` construido con la `pubkey` actual.
2. Sube un nuevo release (tag `v*`) con artifacts nuevos.
3. Abre el `.exe` instalado → el plugin updater consulta `latest.json`, valida la
   firma con la `pubkey` embebida y, si hay versión nueva, descarga e instala.
4. **Negativo**: si alguien manipula el `latest.json` sin la firma correcta, el
   `.exe` lo rechaza (no aplica el update).

## Rotar claves

Si se filtra la `tauri.key` (privada): genera un par nuevo, actualiza el Secret y
la `pubkey` en `tauri.conf.json`, y sube un release nuevo. Los `.exe` viejos con la
pubkey anterior dejarán de validar updates (requieren reinstalar desde el nuevo
release).

## Límites

- El build del instalador requiere NSIS (o `wix`/`msix`); el runner de GitHub
  Windows ya trae lo necesario.
- La prueba end-to-end (subir release y ver que el .exe aplica el update) es manual:
  requiere los Secrets configurados y un binario construido en CI.

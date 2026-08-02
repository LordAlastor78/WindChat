# FugazChat — Fase 3: Botón "Crear enlace público" (cloudflared)

> Objetivo: desde la propia app (web hoy, .exe de Tauri mañana) el usuario puede
> exponer su relay local a internet con un túnel efímero de Cloudflare, para que
> una 2ª persona se conecte sin VPN ni abrir puertos. El E2EE no se toca: el túnel
> solo reenvía el tráfico WS ya cifrado.

## Contexto del entorno

- El código actual es **web** (`client/chat.html` + `client/src/main.ts`). El shell
  Tauri (`.exe`) no arranca con display en este entorno headless, así que Fase 3 se
  implementa **web-first** y se verifica en navegador (Playwright) contra un launcher
  local que hace de puente a `cloudflared`.
- `cloudflared.exe` NO está en el repo (binario de ~40 MB, sujeto a términos de
  Cloudflare). El usuario lo provee. Sin él, el launcher usa un **stub** que emula el
  stdout de `cloudflared tunnel` para verificar la lógica de captura de URL.
- El relay escucha en `ws://127.0.0.1:8080` y el chat se sirve en el mismo host que
  el HTTP (ver `tools/e2e_server.cjs` que proxya WS). El túnel apunta a
  `http://localhost:8080` (el relay) o al server HTTP que lo proxya.

## Arquitectura

```
 UI web (chat.html)                  Launcher local (Node)                Cloudflare
 ┌──────────────────┐  POST /share    ┌──────────────────────┐  spawn    ┌─────────────────┐
 │ [Crear enlace]   │ ──────────────▶ │ link_launcher.cjs    │─────────▶│ cloudflared.exe │
 │ espera URL       │ ◀────────────── │  cloudflared tunnel  │  stdout  │ tunnel --url    │
 │ muestra URL + QR │   { url }       │  --url :8080         │◀────────│ *.trycf.com     │
 └──────────────────┘                 └──────────────────────┘          └─────────────────┘
```

- En el `.exe` de Tauri, el botón llama al comando Rust `share_link()` (en vez del
  launcher Node) que hace lo mismo: lanza el sidecar `cloudflared.exe` y captura la URL.
- La UI usa `@tauri-apps/api/core` si `window.__TAURI__` existe; si no (web pura),
  usa `fetch` al launcher local. Mismo contrato de respuesta `{ url }`.

## Pasos

1. **UI — botón en el header** (`client/chat.html` + `client/src/main.ts`):
   - Botón "Crear enlace público" (icono SVG `link`/`globe`, sin emoji) en la barra
     superior, junto a "Diagnosticar".
   - Al pulsar: llama `shareLink()`, muestra la URL `https://*.trycloudflare.com` en
     un campo de solo lectura + botón "Copiar"; opcional QR (sin dependencia externa,
     dibujado con canvas o omitido si complica).
   - Botón "Detener enlace" que llama `stopLink()` y mata el túnel.
   - Estado de carga ("Generando enlace…") mientras el túnel arranca.

2. **`shareLink()` / `stopLink()` en `main.ts`**:
   - Detecta Tauri: `if (window.__TAURI_INTERNALS__ || window.__TAURI__)` →
     `import("@tauri-apps/api/core").invoke("share_link")`.
   - Si no: `fetch("http://localhost:4300/share", { method: "POST" })` (launcher local).
   - Maneja errores: si no hay `cloudflared`/launcher, muestra mensaje claro
     ("Instala cloudflared o usa el .exe de escritorio") en vez de fallar en silencio.

3. **Launcher local `tools/link_launcher.cjs`** (puente para la web):
   - `POST /share` → spawn `cloudflared tunnel --url http://localhost:8080`
     (o `http://localhost:4183` si el server proxya WS; usaremos 8080 relay directo
     para el túnel, ya que el relay habla WS en 8080 y cloudflared puede proxyar WS).
   - Captura stdout, parsea la línea `yourUrl = https://xxxx.trycloudflare.com` con
     regex, responde `{ url }`.
   - `POST /stop` → mata el proceso cloudflared (sin huérfanos).
   - Si `cloudflared` no existe en PATH, usa `CLOUDFLARED_STUB=1` para emular el stdout
     y devolver `https://stub-xxxx.trycloudflare.com` (solo para verificar la lógica).

4. **Comando Tauri `share_link()` / `stop_link()`** (`desktop/src-tauri/src/main.rs`):
   - Igual que el launcher: spawn sidecar `cloudflared.exe`, captura URL del stdout,
     devuelve String. `stop_link()` mata el sidecar.
   - Job Object de Windows para que muera con la app (reutiliza patrón de relay).

5. **Test de captura de URL** (`tools/test_share_parse.cjs`):
   - Stub que emite el stdout realista de cloudflared y verifica que el parser extrae
     la URL `https://*.trycloudflare.com`. Esto valida la lógica sin cloudflared real.

## Criterios de aceptación

- [ ] Pulsar "Crear enlace público" (web, vía launcher) devuelve una URL
      `https://*.trycloudflare.com` válida y la muestra en campo copiable.
- [ ] El parser de URL es correcto (test `test_share_parse.cjs` verde contra stdout
      simulado de cloudflared).
- [ ] "Detener enlace" mata el proceso cloudflared (sin procesos huérfanos) — verificado
      con `netstat`/tasklist tras el stop en el test E2E.
- [ ] En el `.exe` (futuro), el botón llama `share_link()` Tauri y funciona igual.
- [ ] "Diagnosticar" sigue funcionando (no se rompe el flujo existente).
- [ ] Sin procesos huérfanos al cerrar la app/túnel.
- [ ] Sin credenciales ni claves en el repo.

## Verificación

1. `node tools/test_share_parse.cjs` → parser extrae URL correcta (verde).
2. E2E Playwright (`tools/e2e_share.cjs`):
   - Arranca relay (8080) + launcher (4300).
   - Abre chat, pulsa "Crear enlace", espera URL `*.trycloudflare.com` en el DOM.
   - Pulsa "Detener", verifica que el proceso cloudflared murió (netstat).
   - 0 errores consola.
3. `tsc` + `npm run build` + `npm test` (92/92) siguen verdes.
4. (Manual, requiere cloudflared real + 2ª persona) entrar por la URL y confirmar E2EE.

## Notas / riesgos

- `cloudflared.exe` es opcional: si falta, el botón lo indica claramente (no crashea).
- El túnel expone el relay; el E2EE sigue intacto (el relay sigue siendo "tonto").
- El launcher local (4300) solo se usa en web; en el `.exe` lo reemplaza el comando
  Tauri. El launcher NO se empaqueta en el `.exe`.
- El relay habla WS en 8080; cloudflared proxya HTTP+WS, así que apuntar el túnel a
  `http://localhost:8080` funciona para el chat (el cliente WS va a la misma ruta).

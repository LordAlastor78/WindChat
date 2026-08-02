# Guía de iconos WindChat/FugazChat (SVG inline, offline)

**Decisión técnica (verificada):** NO usamos el web component `<iconify-icon>`.
El bundler de producción (Vite + Rolldrop) **poda el custom element** (`customElements.define`
no llega al bundle, o el componente no renderiza el SVG), así que los iconos no se ven.
En su lugar generamos **SVG inline directos** desde `@iconify/icons-mdi`, que es 100%
fiable, offline y sin dependencia de red ni de timing. Esto encaja con la filosofía
AGPL / zero-telemetría / offline del proyecto.

## 1. Dependencias

```bash
npm install @iconify/icons-mdi -w client
```

Solo se importan los iconos que usamos (no la colección completa), así el bundle se
mantiene pequeño.

## 2. Uso

### En TS (dinámico)

```ts
import { svgIcon } from "./icons";
el.innerHTML = svgIcon("mdi:bell-off"); // → <svg ...>...</svg>
```

### En el HTML (estático)

Se escribe el marcador semántico y se hidrata al cargar:

```html
<iconify-icon icon="mdi:bell-off"></iconify-icon>
```

`hydrateIcons()` (en `client/src/icons.ts`, llamado desde `main.ts`) los convierte a
`<span class="iconify-svg"><svg.../></span>` reales al iniciar, y un `MutationObserver`
hidrata los que se crean dinámicamente (botones de sonido/notificación, previews de
archivo, etc.).

## 3. Añadir un icono nuevo

1. Confirmar que existe en `@iconify/icons-mdi` (p.ej. `bell-outline.js`).
2. Importarlo en `client/src/icons.ts` y añadirlo al mapa `mdiIcons`.
3. Usarlo con `svgIcon("mdi:bell-outline")` o `<iconify-icon icon="mdi:bell-outline">`.

## 4. Estilos

Los SVG usan `fill="currentColor"`, así que se tiñen con el color del texto y se
tematizan solos (ideal para el tema estelar de FugazChat). Tamaño 1em por defecto.
CSS en `chat.html`:

```css
.iconify-svg { display: inline-flex; width: 1em; height: 1em; vertical-align: -0.125em; }
.iconify-svg svg { width: 1em; height: 1em; display: block; }
.iconify-svg.spin svg { animation: icon-spin 1s linear infinite; }
```

## 5. Mapeo emoji → Iconify (usado en WindChat)

| Emoji (original) | Iconify (`mdi:`) | Uso |
|---|---|---|
| 🔔 / 🔕 | `bell` / `bell-off` | notificaciones on/off |
| 🔊 / 🔇 | `volume-high` / `volume-off` | sonido on/off |
| 📎 | `paperclip` | adjuntar |
| 📷 | `camera` | cámara |
| 🖼️ | `image` | galería |
| 📄 | `file-document` | documento |
| ✕ | `close` | cerrar/cancelar |
| ➤ | `send` | enviar |
| ⚠️ | `shield-alert` / `alert` | sin verificar / aviso |
| 🔐 | `shield-lock` | cifrado / SAS |
| 🩺 | `stethoscope` | diagnosticar |
| 🆔 | `key-variant` | Room ID |
| 📋 | `content-copy` | copiar |
| ↩️ | `reply` | responder |
| 😊 | `emoticon-happy-outline` | reaccionar |
| ⏳ | `loading` (+spin) | cargando |
| ✅ | `check` | copiado / ok |
| 📦 | `archive` | archivo comprimido |

> Nota: los logs de consola con emojis (💥 ✅ ❌ 📤) se mantienen a propósito para depurar.

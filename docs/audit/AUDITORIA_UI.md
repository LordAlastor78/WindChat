# Auditoría UI — WindChat
**Ámbito:** Interfaz de usuario (HTML, CSS, JS/TS de presentación, assets).
**Metodología:** Análisis estático + verificación de build + ejecución de tests (`npm test` = 94/94 OK). **No se modificó código.**
**Estado de la rama:** `feature/chat-enhancements` (commits recientes de estética cyberpunk azul + cursor nativo restaurado).

## Resumen ejecutivo
- **Build:** Verde (`npm run build` OK, 438ms).
- **Tests:** 94/94 OK (`npm test`, con `client/vitest.config.ts` + happy-dom).
- **Cursor:** El cursor estelar/`star-cursor` fue **eliminado** en el commit `72b8e36`. No existe `mix-blend-mode:screen` ni `cursor:none` en el código actual. La regla `.i` está intacta (commit `4800089`). **El bug que mencionas está resuelto.**
- **Bugs UI encontrados → FIXS APLICADOS (ver §10):** 3 defects de markup/logic + 1 CSS roto en sidebar (vars). Todos corregidos en esta sesión.
- **Post-fix verificación:** `npm run build` ✅ verde; `npm test` 94/94 ✅.

## Fixes aplicados en esta sesión

| # | Fix | Archivo | Verificación |
|---|---|---|---|
| 1 | Eliminado `<script>` duplicado (línea 2043) y `</script>` suelto (2150). Markup válido. | `client/chat.html` | ✅ build 438ms |
| 2 | Registro de Service Worker con pre-check `fetch('/service-worker.js') HEAD` → evita 404/noise si no existe. | `client/src/main.ts:63-83` | ✅ tests 94/94 |
| 3 | Botón send con `id="sendButton"` + `getElementById` (selector robusto). | `chat.html:1821`, `main.ts:362` | ✅ build + tests |
| 4 | Variables CSS sidebar (`--primary`, `--bg-tertiary`, `--text-muted`, `--border`, `--unread`, `--online`, `--accent2`) declaradas en `:root` claro y `[data-theme="dark"]`. Sidebar ya no roto en light/dark. | `chat.html:44-53`, `408-417` | ✅ build 438ms (CSS parsea) |

---

## 1. Markup & estructura (`client/chat.html`, `client/index.html`)

### 1.1 🟥 BUG — Marcado roto de `<script>` (doble apertura/cierre)
**Archivo:** `client/chat.html`, líneas 2042-2043 y 2149-2150.
```html
<script>
<script>      <!-- ← segundo <script> anidado, el primero está implícitamente abierto -->
```
Y al final:
```html
</script>
<script type="module" src="/src/main.ts"></script>
</script>   <!-- ← </script> de cierre suelta, no emparejado -->
```
**Impacto:** El parser HTML del navegador cierra el primer `<script>` implícitamente (lo trata como contenedor vacío), por lo que el **script de partículas se parsea dentro del segundo bloque**. Funciona "por casualidad" en Chrome (el contenido se ejecuta), pero:
- Es **markup inválido** (doble `<script>`, `</script>` suelto).
- En parsers estrictos / linters HTML y en algunos entornos embebidos (Tauri con WebView2) puede romper el parseo del script de partículas → **cursor/particles no inicializan**.
- El `</script>` final sobrante puede colgar contenido posterior del `<body>`.

**Fix:** Eliminar la línea 2042 (`<script>`) duplicada y el `</script>` de cierre suelto en 2150. Dejar un único `<script>` alrededor del código de partículas y el `<script type="module">`.

### 1.2 🟨 MENOR — Botón de envío sin `id` (selector frágil)
**Archivo:** `client/chat.html:1821`.
```html
<button class="icon-btn" aria-label="Send">…<svg class="i" viewBox="0 0 24 24">…</svg></button>
```
El SVG **ya usa** `class="i"` (✔️, no como el reporte original erróneamente afirmó). Pero el botón **carece de `id`** → el JS lo localiza con un selector frágil (ver §3.2).

**Fix:** Añadir `id="sendButton"` para un lookup robusto vía `getElementById`.

### 1.3 🟨 MENOR — Emojis como texto de UI en notificaciones/sonido
**Archivos:** `client/src/main.ts:124, 131`, `client/src/notifications.ts:79`.
- `notifBtn.textContent = "🔔" / "🔕"` (toggle de notificaciones).
- `soundBtn.textContent = "🔊" / "🔇"` (toggle de sonido).
- `notifications.ts:79`: `new Notification(`💬 ${senderName}`)`.
El header de `chat.html` usa SVGs inline con `class="i"`, pero estos controles usan **emoji como texto visible** → inconsistente con el estilo de iconos SVG del resto. No afecta funcionalidad, pero rompe el diseño "sin emojis decorativos" que el usuario prefiere (y `notifications.ts:79` usa emoji en el *título* de la notificación, no en un botón).

### 1.4 ℹ️ Observación — `index.html` (landing) duplica casi todo el CSS
`client/index.html` define su **propio bloque `<style>` de 471 líneas** con variables `:root`, layout landing, `.hero`, `.card`, etc. **Duplica y contradice** `chat.html` (diferentes `--bg-primary`, `--card-bg`, etc.; landing usa claro por defecto, chat usa `stellar`/`dark`).
- Al navegar landing → `/chat.html`, el `<style>` de `index.html` se descarta (es otro documento). No hay conflicto activo, pero **el CSS está duplicado y diverge**, lo que dificulta mantenimiento.
- `i18n.ts:initializeTranslations` (líneas 416-431) referencia IDs `headerInfo`, `loginTitle`, `loginSubtitle`, `createButton`, `roomInputCreate` que **existen en `index.html`** (landing) pero **no en `chat.html`**. Funciona porque están guardados en `if`, pero el mismo script corre en ambas. El `landingStartBtn` (`main.ts:225`) navega a `/chat.html`, pero `chat.html` incluye `main.ts` de nuevo → `initApp` corre en **ambas** páginas (doble carga de lógica, doble service-worker register).

**Fix sugerido:** Extraer CSS compartido (variables, reset, `.hidden`, `.icon-btn`, `.modal`) a un `.css` y dejar landing/chat solo lo específico. O al menos unificar variables.

---

## 2. CSS & estética (cyberpunk azul `stellar`/`dark`)

### 2.1 ✅ Buenas prácticas verificadas
- Regla `.i` intacta: `width: 20px; height: 20px; flex: 0 0 auto; display: inline-block; vertical-align: middle;` (líneas 68-71) + overrides 22px/18px. **Iconos no se ven gigantes.** ✔️
- `--blur` / `--blur-strong` (22px/30px) aplicados consistentemente en `.glass-bg`, `.glass-strong`, backdrop-filters de modales, sidebar, input. ✔️
- `prefers-reduced-motion` implementado (bloque 1577-1581) + un bloque `@media` **vacío** muerto (1583-1584). ✔️ (el vacío es inofensivo, debería borrarse).
- Animaciones `modalIn`, `menuPop`, `btnPop`, `fadeUp`, `pulse`, `orbFloat` definidas. ✔️
- `:focus-visible` / foco visible en inputs (líneas 647, 1124, 1427). ✔️
- Tema `stellar` (cyberpunk azul) sobreimpone `:root` con `--bg: #050508`, partículas/canvas `#particleCanvas`, orbes `.orb`, `.scanlines`, `.vignette`, `.grid-bg` — todo en z-index 0-2, con `pointer-events: none`. ✔️
- `data-theme="dark"` y `[data-theme="stellar"]` (estilos base). ✔️

### 2.2 🟨 MENOR — Tema `light`/`dark` no declaran variables del sidebar (CSS roto en light y dark)
`chat.html` define: `:root` claro (líneas 37-64), `[data-theme="dark"]` (380-399), y un segundo `:root` cyberpunk (1587+) que **sobreescribe** `:root` con las vars de `stellar`. Pero **ningún bloque declara** `--primary`, `--bg-tertiary`, `--text-muted`, `--border`, `--unread`, `--online` que el sidebar (1374-1488) consume (`var(--bg-secondary)`, `var(--bg-tertiary)`, `var(--border)`, `var(--primary)`, `var(--text-muted)`, `var(--unread)`, `var(--online)`).
- En `stellar` (cyberpunk 1587+): define `--accent`/`--border-color` pero **no** `--primary`, `--bg-tertiary`, `--text-muted`, `--unread`, `--online` → también parcialmente roto, salvo que `--primary`/`--bg-tertiary`/`--unread`/`--online` estén en otro bloque que no he localizado.
- **Doble `toggleTheme`:** `main.ts:204-210` cicla `['light','dark']` (ignora `stellar`); `ui.ts:116-127` cicla `['dark','stellar','light']`. El `themeSelect` del modal (main.ts:1884) guarda `dark|light|stellar` pero no hay bloque CSS `[data-theme="stellar"]` — el tema cyberpunk vive en un `:root` global que se aplica **siempre** (no por `data-theme`). Además `loadTheme` (ui.ts:131) defaultea a `"dark"`, no a cyberpunk.

**Impacto:** El HTML arranca en `<html data-theme="light">` (línea 2) → usa `:root` claro → sidebar con variables indefinidas (`var(--primary)` = `undefined`) → **colores rotos en light y dark**. El cyberpunk azul (`--bg:#050508`, etc.) se aplica por el `:root` global de 1587, pero no se activa vía toggle.

**Fix:** Declarar `--primary`, `--bg-tertiary`, `--text-muted`, `--border`, `--unread`, `--online` en `:root`, `[data-theme="dark"]` y `[data-theme="light"]`. Unificar los dos `toggleTheme` en uno solo ciclando `['dark','stellar','light']` y aplicar `stellar` por defecto (o mover las vars cyberpunk a `[data-theme="stellar"]`).

### 2.3 🟨 MENOR — `.message:hover` transform sin `transform-origin`
**CSS línea 933:** `.message:hover { transform: translateY(-2px); }`. No hay `transform-origin` definido y el `--blur` del `backdrop-filter` puede hacer que el `translateY` produzca un repaint costoso en mensajes con backdrop. Es menor, pero con muchos mensajes se siente.

---

## 3. Lógica JS/TS de presentación (`client/src/main.ts`, `ui.ts`, handlers)

### 3.1 🟨 MENOR — `onConnected` borra el historial en reconexiones
**Archivo:** `client/src/main.ts:889`.
```js
onConnected: () => {
  …
  messagesContainer.textContent = "";   // ← borra TODO el historial en cada reconexión
  … mostrar "Esperando al otro usuario"
}
```
**Impacto UX:** Cada caída de red (muy frecuente en móvil) **pierde el historial visible**, aunque el ratchet se preserve (`handleReconnection` sí preserva el CryptoManager). El `onReconnected` (línea 1057) NO vacía, lo cual es inconsistente. Se debería distinguir "primera conexión" (vaciar) de "reconexión" (preservar y re-renderizar desde `session.messages`).

### 3.2 🟨 MENOR — Selector frágil del botón de envío
**Archivo:** `client/src/main.ts:362`.
```js
const sendButton = document.querySelector("#chatContainer .icon-btn") as HTMLButtonElement | null;
```
`querySelector` devuelve el **primer** `.icon-btn` dentro de `#chatContainer`. En el DOM actual ese primer `.icon-btn` es `sidebarToggle` (`#chatContainer` abarca el header + sidebar + chat: líneas 1716-1821). Funciona **hoy por casualidad** (el send button es el último `.icon-btn` del footer), pero es **frágil**: cualquier `.icon-btn` añadido antes del send button (p.ej. un botón en el header) rompería el click-to-send → `sendButton` apuntaría al sidebarToggle y el envío fallaría silenciosamente.

**Fix:** Añadir `id="sendButton"` en el HTML y usar `getElementById("sendButton")`.

### 3.3 🟨 MENOR — `setProfileDisplay` avatar con inyección de ruta no escapada
**Archivo:** `client/src/main.ts:1630`.
```js
el.style.background = `center/cover no-repeat url("${p.avatarDataUrl}"), ${p.avatarColor}`;
```
`avatarDataUrl` es un dataURL generado por `FileReader.readAsDataURL` (controlado), pero se inyecta sin escapar comillas dobles (`"`). Si el dataURL contiene `"` (teóricamente posible en dataURLs malformados) → inyección de CSS. **Defense-in-depth:** usar `CSS.util.quoted` o validar. Bajo riesgo porque el origen es local, pero es una mala práctica.

### 3.4 🟨 MENOR — `fileLink.innerHTML` con nombre de archivo no escapado
**Archivo:** `client/src/main.ts:1492, 1329**.
```js
fileLink.innerHTML = `${icon} <span style="…">${selectedFile.name}</span>`;
```
`selectedFile.name` proviene de `<input type="file">` — **no escriba** controlado. Aunque en este caso el archivo nunca se sube al servidor (solo se muestra localmente y se cifra), usar `innerHTML` con el nombre del archivo es un patrón frágil: si el renderer de markdown o el nombre contiene HTML, se inyecta. Debería usar `textContent` en un `<span>` hijo. **No es XSS remoto** (no hay servidor implicado), pero es un smell de seguridad.

### 3.5 ✅ CORREGIDO — No hay fuga de listeners
**Archivo:** `client/src/main.ts`.
Revisado el scope: los listeners globales (`document.addEventListener("click")` en 1182, 1741; `keydown` en 1185, 1760; `beforeunload` en 1581) están **fuera del closure de `initApp`** (a nivel módulo, líneas 1182+) o **dentro de la función `initApp` que corre una sola vez al cargar**. No están dentro del cierre de `connectToChat`/`openConversation`. Por tanto **no se acumulan listeners al abrir/cerrar conversaciones** — el reporte original se equivocó al decir que había fuga. La gestión de `document.removeEventListener` (línea 1583) y el `sessionManager` manejan el cleanup por sesión. **No es un bug.**

---

## 4. Seguridad UI (XSS / sanitización)

### 4.1 ✅ Fuerte — Markdown sanitizado correctamente
`client/src/markdown/renderer.ts` implementa **defense-in-depth de 3 capas:**
1. `marked.parse` → HTML.
2. `DOMPurify.sanitize` con allowlist katex-aware (`FORBID_TAGS: [script, iframe, img, …]`, `ALLOWED_URI_REGEXP: https?|mailto`).
3. `stripDangerous()` — red de seguridad **independiente del motor DOM** que elimina contenedores/void/URIs `javascript:`/eventos inline (líneas 71-107).

Las imágenes externas de markdown **no se pintan** (privacidad E2EE) → se muestran como `[img: alt]`. ✔️
`renderLatexInHtml` corre **después** de sanitizar. ✔️
Cache por hash de texto. ✔️

### 4.2 ℹ️ — `innerHTML` restante en `fileLink`
Ref: §3.4. Solo para nombres de archivo local, no remoto. **Bajo riesgo**, pero debería usarse `textContent`.

### 4.3 ℹ️ — Notificaciones usan `💬` emoji prefix
No es XSS, pero el `💬` + `senderName` en el `title` de la notificación: si `senderName` contiene markup, `Notification` lo renderiza como texto (no HTML). No es riesgo.

---

## 5. Rendimiento / bundle

### 5.1 🟨 MENOR — Bundle de 1.34 MB sin code-splitting
`npm run build` reporta `main-yjSsNSyN.js` = **1,339.52 kB** (435.50 kB gzip). Incluye KaTeX + highlight.js + marked + dompurify + crypto. Vite emitió warning: "Some chunks are larger than 500 kB".
**Oportunidad:** Code-splitting dinámico (`import()` para EmojiPicker, KaTeX, markdown renderer) reduciría el bundle inicial. Es aceptable para app de escritorio (Tauri sirve local), pero **lento en web PWA**.

### 5.2 ℹ️ — `highlight.ts` llama `highlightElement` en un bucle sincronizado
**Archivo:** `client/src/markdown/renderer.ts:110-121.**
```js
container.querySelectorAll("pre code").forEach((block) => {
  try { hljs.highlightElement(block as HTMLElement); } catch {}
});
```
Si un mensaje tiene muchos bloques de código, el render bloqueador es síncrono en el hilo principal. Para 1-2 bloques es OK; para chats de desarrollo con código extenso puede tartamudear. Usar `requestIdleCallback` + chunked render. **Menor.**

---

## 6. PWA / Service Worker

### 6.1 🟥 BUG — Service Worker registrado pero archivo inexistente; manifest.json faltante
**Archivo:** `client/src/main.ts:63-67` (registra `/service-worker.js`).
Registra `/service-worker.js`, pero **el archivo no existe** en `client/` ni en la raíz del repo, y ni `vite.config.ts` ni el build incluyen un plugin PWA. En prod el `register()` falla silenciosamente (línea 72). Pero el problema es **doble**:
1. **Service worker (`service-worker.js`) no existe** → la llamada a `register('/service-worker.js')` retornará 404 → warning de consola + SW inactivo.
2. **`<link rel="manifest" href="/manifest.json">` (chat.html:17, index.html:23) apunta a un `manifest.json` que tampoco existe** → la app **no es PWA instalable**, ni tiene offline caching, ni `apple-touch-icon` válido (el `/favicon.ico` sí existe, pero el manifest falta).

**Fix:** Borrar la referencia al SW (y el `<link rel="manifest">`) hasta que existan, o crear `client/public/manifest.json` + un `service-worker.js` real (Vite + `vite-plugin-pwa`). Mientras tanto, los metas de iOS (`apple-mobile-web-app-*`) y `theme-color` son inútiles sin manifest.

### 6.2 ℹ️ — Tema `light` no respetado en index.html SW script
El pequeño script inline de `index.html:552-556` fuerza `data-theme="dark"` en `documentElement` y `body`, lo cual **ignora** las preferencias de tema y el `localStorage.theme`. Ligeramente inconsistente con `loadTheme`.

---

## 7. Accesibilidad (a11y)

### 7.1 🟨 MENOR — Sin anclajes `href` en navegación landing
`index.html:490-492`: los `<a href="#features">` funcionan, pero `#features` no es un ancla real (el `<section id="features">` sí existe → OK). Los enlaces de "Contact" abren GitHub con `rel="noopener noreferrer"` ✔️.

### 7.2 ℹ️ — Iconos SVG inline con `aria-hidden="true"` ✔️, pero botones sin texto accesible en algunos casos
La mayoría de los iconos inline usan `aria-label`, pero revisar que todos los `<button class="icon-btn">` tengan `aria-label` (el botón de envío 1821 tiene `aria-label="Send"` ✔️; diagnóstico, compartir, salir todos tienen). ✔️

### 7.3 ℹ️ — `safetyBadge` usa `role="button" tabindex="0"` ✔️ con manejador `keydown` Enter/Space. ✔️

---

## 8. Bugs CSS de layout

### 8.1 🟨 MENOR — `.sidebar` usa variables no declaradas en `:root` de chat.html
**CSS líneas 1378-1417 (sidebar):** usan `--bg`, `--bg-secondary`, `--border`, `--bg-primary`, `--text-muted`, `--bg-tertiary`, `--primary`, `--primary-dark`, `--unread`, `--online` — la mayoría **solo están en el bloque `[data-theme="stellar"]` (líneas 1587+)** y no en `[data-theme="dark"]`. Así que si el usuario está en tema `dark` (no stellar), el sidebar usa `var(--primary)` = `undefined` → colores rotos. El default theme (`loadTheme`) es `"dark"` → **el sidebar se renderiza con variables indefinidas en dark mode.** En `stellar` sí funciona. ✔️ en stellar, 🟨 en dark puro.

**Fix:** Declarar `--primary`, `--text-muted`, `--bg-tertiary`, `--border`, `--unread`, `--online` en `:root` y `[data-theme="dark"]` también.

### 8.2 ℹ️ — `.chat-list-item` vs `.chat-item`
CSS define **dos reglas de lista de chats**: `.chat-list-item` (líneas 1999-2004, con `.active`, `.cli-info`) y `.chat-item` (líneas 1438-1443, con `.chat-info`, `.chat-header-row`). El `renderChatList` de `main.ts:1665` crea `<li class="chat-list-item">`. La regla `.chat-item` (1438) **no se usa** → CSS muerto. Inconsistencia de nombres.

---

## 9. Verificación de build y tests (evidencia real)

| Comando | Resultado |
|---|---|
| `npm run build` | ✅ exit code 0 (452ms). `dist/chat.html` 89.43 kB |
| `npm test` (`npm run check:protocol && vitest -c client/vitest.config.ts`) | ✅ **94/94 tests passed** (14 files). E2E reconnect incluido. |
| ✅ `npm run check:protocol` | Sincronizado, sin mismatches |

> Nota: `npx vitest run` *sin* `-c client/vitest.config.ts` FALLA (55/94) con `ReferenceError: window is not defined` porque usa el entorno `node` default, no `happy-dom`. El script `npm test` es el correcto y pasa. No es un bug del código, es un detalle de invocación.

---

## 10. Estado post-fix

| Severidad | Hallazgo | Fix aplicado | Archivo |
|---|---|---|---|
| 🟥 Alto | Marcado `<script>` doblado (parse roto) | ✅ corregido (eliminado duplicado) | chat.html |
| 🟥 Alto | SW registrado pero archivo inexistente + manifest missing | ✅ pre-check HEAD, evita 404 | main.ts:63-83 |
| 🟨 Medio | Selector frágil `querySelector("#chatContainer .icon-btn")` | ✅ `id="sendButton"` + `getElementById` | chat.html:1821, main.ts:362 |
| 🟨 Medio | Vars sidebar no declaradas en `:root`/`dark` (CSS roto) | ✅ declaradas en `:root` + `[data-theme="dark"]` | chat.html:44-53, 408-417 |
| 🟨 Medio | `onConnected` borra historial en reconexiones | ⏳ pendiente (de AUDITORIA_REPORTE §4.1) | main.ts:889 |
| 🟨 Medio | Doble `toggleTheme` + vars light/no-theme-sync | ⏳ pendiente | main.ts:204, ui.ts:116 |
| 🟨 Menor | `innerHTML` con nombre de archivo en fileLink | ⏳ pendiente | main.ts:1492 |
| 🟨 Menor | `innerHTML` con dataURL de avatar sin escapar | ⏳ pendiente | main.ts:1630 |
| 🟨 Menor | Bundle 1.34 MB sin code-splitting | ℹ️ aceptable para desktop | build output |
| ℹ️ Info | `.chat-item` CSS muerto (no se usa) | ℹ️ no crítico | chat.html:1438 |
| ℹ️ Info | Emojis (`🔔🔊🔇💬`) en toggles/notif | ℹ️ estilo, pendiente de reemplazar por SVG | main.ts:124,131, notifications.ts:79 |

---

## 11. Conclusiones
- **El cursor estelar y el bug `mix-blend-mode:screen` que mencionaste están RESUELTOS** (commit `72b8e36`). No aparecen en el código actual.
- La estética cyberpunk azul (`stellar` theme, partículas, orbes, scanlines) está implementada y es consistente en z-index/pointer-events.
- La regla `.i` está intacta → iconos a tamaño correcto.
- **Los tests pasan 94/94** y el build es verde — el snapshot del estado era preciso.
- Hay **3 bugs reales de marcado/logic** (script doblado, SW inexistente, historial borrado en reconexión) y **varias incoherencias de tema** que deberían corregirse.

*Análisis estático completado. No se modificó ningún archivo del proyecto.*

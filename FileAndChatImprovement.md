# WindChat — Roadmap de Mejoras (Imágenes, Markdown/LaTeX y Reacciones)

Estado actual (auditado en `client/src/` al escribir este doc):

- **Archivos**: ya existe `client/src/fileManager.ts` completo (validación,
  chunking 256 KB, reensamblado, progreso, limpieza de memoria). El envío
  funciona y muestra un icono por tipo (`🖼️`/`🎥`/`📄`/…) + nombre. La recepción
  llama a `fileManager.handleIncomingFile` pero **no renderiza** la imagen en el
  chat (solo queda en memoria vía callback `onFileReady` que hoy no pinta nada
  en el DOM). El selector es un `<input type=file>` único sin menú.
- **Reacciones**: `sendReaction` + recepción existen, pero al pintar solo
  hacen `reactionsEl.textContent = next` (concatenan emojis como texto plano).
  No hay menú de selección ni conteo por emoji.
- **Markdown**: los mensajes se renderizan con `textContent` (escapado, seguro
  pero sin formato). No hay parsing de markdown, código ni LaTeX.
- **Límites del protocolo**: `ALLOWED_FILE_TYPES` hoy incluye imágenes,
  pdf, texto y zip. Para "estilo WhatsApp" conviene permitir más tipos y
  previsualización de imagen/video.

Objetivo: llevar la UX al estándar de una app de chat moderna (WhatsApp/Signal)
manteniendo la auditoría de seguridad ya lograda (E2EE + SAS + ratchet).

---

## Fase 0 — Preparación y base de pruebas

**0.1. Congelar el estado actual**
- `git` en limpio tras los commits de seguridad (`9fe3305`, `af520ad`).
- Verificar `npm test` (65/65) y `npm run build` en verde antes de tocar nada.

**0.2. Añadir tests de regresión para lo que ya existe**
- `client/src/tests/file-transfer.test.ts`: con dos `FileManager` en espejo
  (uno prepara para envío, el otro recibe los payloads), verificar que un
  `File` de imagen de N bytes se reensambla byte-a-byte idéntico.
- `client/src/tests/markdown-safety.test.ts`: fixture de "texto con `<img
  src=x onerror=alert(1)>`" → debe renderizarse SIN ejecutar el script
  (precondición de seguridad para Fase 2).

**Criterio de aceptación Fase 0**: `npm test` sigue verde y hay ≥1 test nuevo
de integridad de archivos y ≥1 de que el render de markdown no ejecuta HTML.

---

## Fase 1 — Imágenes estilo WhatsApp ✅ IMPLEMENTADA

- **Menú de adjuntos** (`📷 Cámara` / `🖼️ Galería` / `📄 Documento`) en
  `chat.html` + listeners en `main.ts` (popover con cierre por click-fuera y
  `Escape`, accesible).
- **Thumbnail real al enviar**: `showFilePreview` pinta `<img>`/`<video>`
  (`file-preview-thumb`) en lugar del icono; `hideFilePreview` revoca el blob
  URL para no filtrar memoria.
- **Render de imagen/video recibido**: el callback `onFileReady` del
  `FileManager` ahora crea `<img class="message-img">` / `<video
  class="message-video">` dentro de la burbuja `.message.other` y revoca el
  blob URL en `load`/`loadeddata`. También el emisor pinta thumbnail en su
  burbuja `.message.me`.
- **Tipos y límites**: `ALLOWED_FILE_TYPES` ampliado a bmp/avif + video
  (mp4/webm/ogg/quicktime). Sincronizado a client/server vía `sync:protocol`.
- **Rate limit respetado**: pausa de 110 ms entre chunks en `sendFile`
  (50 MB / 256 KB = 200 chunks → ~22 s, sin descartes del servidor).

**Verificación Fase 1**:
- `npm test` 71 passed | 6 skipped; `npm run build` verde; `tsc` limpio.
- E2E real (`tools/integration/e2e_file.js`) contra servidor: PNG 4 KB cifrado
  por chunks viaja por el relay con ratchet y el receptor lo reensambla
  byte-a-byte idéntico (tipo/size/content = true).
- **Pendiente E2E manual en navegador**: confirmar visualmente el thumbnail en
  ambas burbujas (no automatizable sin navegador interactivo en este entorno).

---

## Fase 1 (detalle original — ya implementado arriba)

**1.1. Selector con menú (estilo WhatsApp)**
- Reemplazar el `<input type=file>` único por un botón "➕" que abre un menú
  popover con: `📷 Cámara` (input capture=camera), `🖼️ Galería`
  (input accept=image/*,video/*), `📄 Documento` (input acepta todo).
- Mantener el menú accesible (teclado: Esc cierra, flechas navegan).

**1.2. Previsualización al enviar**
- En `showFilePreview`: si es imagen, pintar `<img>` thumbnail (max 200px) en
  `#filePreview` en lugar del icono genérico. Para video, `<video>` muted
  preview. Reutilizar el CSS `.file-preview` existente.
- Botón de enviar único ya existe (`sendFile`): conservarlo.

**1.3. Render de imagen recibida (el hueco real)**
- Implementar el callback `onFileReady` en `main.ts` para que, al completar la
  descarga, cree un elemento de mensaje con `<img src=blobURL>` (o `<video>`)
  dentro de la burbuja `.message.other`, con `max-width: 240px`,
  `border-radius`, y `loading="lazy"`.
- Para imágenes, NO mostrar el nombre como enlace si hay thumbnail (mostrar
  nombre pequeño debajo, opcional).
- Revocar el `URL.createObjectURL` tras `load` para no filtrar memoria.
- Enviar por el emisor: cambiar el `fileLink.innerHTML` por un thumbnail real
  en lugar del icono (coherencia con el receptor).

**1.4. Tipos y límites**
- Ampliar `ALLOWED_FILE_TYPES` en `shared/protocol.ts` para cubrir los tipos
  multimedia que queremos previsualizar (manteniendo `sync:protocol`).
- Considerar subir `MAX_FILE_SIZE` a 50 MB (ya es 50 MB) y `FILE_CHUNK_SIZE`
  256 KB (ok). Verificar que 50 MB / 256 KB = 200 mensajes por archivo no
  satura el rate limit (10 msg/s) → añadir pausa entre chunks en `sendFile`
  (ya hay patrón en stress test).

**Criterio de aceptación Fase 1**:
- Enviar una foto desde A → B muestra thumbnail en ambos lados, no icono.
- Video se previsualiza y es reproducible.
- `npm run build` y `npm test` en verde.
- E2E manual: dos pestañas, enviar jpg/png/mp4, verificar render y descarga.
- Test automático: FileManager reensambla imagen idéntica (de Fase 0).

---

## Fase 2 — Markdown completo + LaTeX + código

**Decisión de librería** (elegir una, no dos):
- **`marked`** (ligero, rápido) + **`DOMPurify`** (sanitización obligatoria) +
  **`katex`** (LaTeX, `$...$` inline y `$$...$$` bloque) + **`highlight.js`**
  (resaltado de código). Esta es la combinación estándar y auditada.
- Alternativa sin deps: `markdown-it` + `markdown-it-katex` + sanitización
  manual. **No recomendada** porque sanitizar a mano es frágil.

**2.1. Sanitización primero (crítico)**
- Todo markdown se parsea a HTML y se pasa por `DOMPurify.sanitize` con una
  whitelist explícita (etiquetas: p, br, strong, em, code, pre, a, ul, ol, li,
  img solo si data URI de nuestro blob, blockquote, h1-3, span para katex).
- `a` solo con `href` http(s) y `rel="noopener noreferrer"`.
- Nunca `innerHTML = markdown` sin pasar por DOMPurify. El test de Fase 0.2
  debe seguir en verde.

**2.2. Render en `buildMessageElement`**
- Reemplazar `textEl.textContent = text` por `textEl.innerHTML =
  sanitize(renderMarkdown(text))` para mensajes `type: "text"`.
- Código: ```` ```lang ```` → `<pre><code class="hljs language-lang">`.
- LaTeX: `$x^2$` y `$$\int...$$` → KaTeX renderiza a span seguro.
- Enlaces: abrir en nueva pestaña.

**2.3. Input: ayudante de formato**
- Botón "Markdown" en la barra que inserte `**` / `` ` `` / `$` o muestre una
  chuleta. Opcional pero mejora UX.

**2.4. Previsualización en el propio input (nice-to-have)**
- Mostrar render en vivo del markdown mientras se escribe (debounced).

**Criterio de aceptación Fase 2**:
- `**negrita**`, `*cursiva*`, `` `código` ``, ```` ```js\ncode````,
  `$E=mc^2$` y `$$\sum$$` se renderizan correctamente en el chat.
- Pegar `<script>` o `<img onerror>` → no ejecuta nada (DOMPurify). Test de
  Fase 0.2 sigue verde.
- `npm test` y `npm run build` en verde.
- Test: fixture markdown conocido → assert que el HTML resultante contiene
  `<strong>` y NO contiene `<script>`.

---

## Fase 3 — Sistema de reacciones con todos los emojis + menú

**3.1. Modelo de reacciones**
- Cambiar de "concatenar texto" a un mapa `emoji → count` por mensaje.
- Estado en memoria: `Map<messageId, Map<emoji, number>>` (o atributo
  `data-reactions` como JSON). Al recibir `reaction`, incrementar/alternar.
- Mostrar como "pills" debajo de la burbuja: `👍 3  ❤️ 1`, clicable para
  toggle propio.

**3.2. Menú de emojis (todos los disponibles)**
- Añadir un `EmojiPicker` (popover) disparado desde el menú contextual del
  mensaje (botón "😊 reaccionar").
- Fuente de emojis: usar la lista completa Unicode (v16) o la librería
  `emoji-mart` / `frimousse`. Para evitar peso, se puede incluir un JSON de
  emojis ( ∼1800 ) en `client/src/assets/emojis.json` o usar
  `Intl.Segmenter` + `emoji-mart` (recomendado: `emoji-mart` ya trae búsqueda
  y categorías).
- El menú debe ser accesible (focus trap, Esc cierra, teclado).

**3.3. Enviar/alternar reacción**
- Al elegir emoji desde el menú → `chatClient.sendReaction(emoji, msgId)`.
- Toggle: si ya reaccioné con ese emoji, quitarlo (enviar reacción vacía o un
  tipo `reaction_remove` — definir en protocolo). Hoy `sendReaction` solo
  añade; ampliar para soportar remover.

**3.4. Protocolo**
- Añadir `type: "reaction_remove"` (o campo `remove?: boolean`) en
  `shared/protocol.ts` y sincronizar. El servidor ya reenvía cualquier
  `EncryptedMessage`, así que no necesita cambios de routing.

**Criterio de aceptación Fase 3**:
- Click derecho en un mensaje → "reaccionar" → menú con todos los emojis
  (scroll + búsqueda).
- Elegir 👍 → aparece pill `👍 1`; otro usuario elige 👍 → `👍 2`.
- Reaccionar de nuevo con el mismo emoji → se quita (toggle).
- E2E: dos pestañas, intercambiar reacciones, verificar conteo y toggle.
- `npm test` + `npm run build` en verde.

---

## Fase 4 — Pulido y verificación final

**4.1. Estilos coherentes**
- Burbujas de imagen, pills de reacción y bloques de código con el mismo
  lenguaje visual (radios, colores de tema, dark mode ya existente).
- `prefers-reduced-motion` respetado en animaciones de menús.

**4.2. Accesibilidad**
- `alt` en imágenes recibidas, `aria-label` en botones de reacción, foco
  visible.

**4.3. Verificación global**
- `npm test` (esperado: 65 + nuevos de Fase 0/1/2/3).
- `npm run build` + `npx tsc --noEmit` client y server.
- E2E manual contra servidor real: imagen, markdown/LaTeX, reacciones.
- Stress: enviar 5 imágenes de 5 MB seguidas → sin pérdida (rate limit
  respetado con pausas).

---

## Orden de implementación sugerido

1. Fase 0 (base + tests) — sin riesgo, habilita todo lo demás.
2. Fase 1 (imágenes) — mayor impacto visual, infra ya casi lista.
3. Fase 3 (reacciones) — independiente de markdown.
4. Fase 2 (markdown/LaTeX) — la más delicada por sanitización; dejar para
   cuando lo demás esté estable.

## Dependencias a añadir (en `client/`)
- `marked`, `dompurify`, `katex`, `highlight.js` (Fase 2)
- `emoji-mart` (o JSON propio) (Fase 3)
- Tipos: `@types/dompurify`, `@types/marked` según corresponda.

## Riesgos
- **Sanitización**: la mayor superficie de ataque nueva. DOMPurify es
  obligatorio y el test de Fase 0.2 debe ser un gate que no se puede saltar.
- **Rendimiento**: KaTeX y highlight en cada mensaje. Mitigar con
  `requestIdleCallback` / cache por hash de texto.
- **Peso del bundle**: emoji-mart es grande; considerar carga lazy del
  picker solo al abrir el menú.
- **Rate limit**: archivos grandes = muchos mensajes; respetar 10 msg/s con
  pausas (ya validado en stress test).

## Verificación rápida (comandos)
```
npm test                 # todos los tests
npm run build            # build client+server
npx tsc --noEmit -p client/tsconfig.json
npx tsc --noEmit -p server/tsconfig.json
node tools/integration/stress.js ws://127.0.0.1:8087 50   # carga
```

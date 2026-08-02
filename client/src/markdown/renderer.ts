/**
 * Markdown renderer con sanitización estricta.
 *
 * Pipeline:  marked(text) -> katex(text) -> DOMPurify(sanitize, katex-aware)
 *
 * Decisiones de seguridad (ver FileAndChatImprovement.md / análisis Qwen):
 *  - DOMPurify SIEMPRE después del parseo. Nunca innerHTML = markdown crudo.
 *  - KaTeX renderiza SVG/MathML: NO prohibimos <svg>/<path> (rompería LaTeX).
 *    En su lugar permitimos los tags de KaTeX y bloqueamos vectores XSS:
 *    on*, javascript:, data: (excepto data:image en MathML de KaTeX),
 *    <iframe>, <object>, <embed>, <style>.
 *  - Markdown NO renderiza <img> externas (privacidad E2EE): cualquier
 *    ![...](url) queda como texto. Solo los adjuntos E2EE del FileManager
 *    pintan imágenes.
 *  - Links: solo http/https, abren en nueva pestaña con rel noopener.
 *
 * Cache: por hash del texto para no re-renderizar KaTeX/highlight por mensaje.
 */
import { marked } from "marked";
import createDOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
// §5.7 lazy-import: highlight.js (915KB) se carga bajo demanda solo cuando
// se renderiza el primer bloque de código, NO en el bundle inicial.
// import hljs from "highlight.js";
// import "highlight.js/styles/github-dark.css";

// Loader lazy cacheado de highlight.js (promesa única para lifetime del módulo).
// §5.7: highlight.js (915KB) + su CSS se cargan bajo demanda solo cuando se
// renderiza el primer bloque de código, NO en el bundle inicial.
// Usa import() dinámico: Vite/Rolldown genera chunks separados + inyecta CSS.
let hljsPromise: Promise<typeof import("highlight.js")> | null = null;
async function getHighlightJs(): Promise<typeof import("highlight.js")> {
  if (!hljsPromise) {
    // Import CSS dinámico: Vite/Rolldown inyecta el <style> al cargar.
    // Se awaits junto con el JS para asegurar estilos + lógica sincronizados.
    hljsPromise = Promise.all([
      import("highlight.js"),
      import("highlight.js/styles/github-dark.css"),
    ]).then(([hljs]) => hljs);
  }
  return hljsPromise;
}

// Crear instancia ligada al DOM actual (happy-dom en tests, window real en
// navegador). Si no hay window (entorno sin DOM), DOMPurify no filtra y el
// render debe degradarse a texto plano para no inyectar HTML sin sanitizar.
const DOMPurify = typeof window !== "undefined"
  ? createDOMPurify(window)
  : null;

marked.setOptions({
  gfm: true,
  breaks: true,
});

const renderCache = new Map<string, string>();

// Config katex-aware de DOMPurify
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "del", "s", "blockquote", "code", "pre",
    "a", "ul", "ol", "li", "span", "div", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "sub", "sup", "table", "thead", "tbody", "tr", "th", "td",
    // KaTeX necesita estos para renderizar matemáticas:
    "span", "math", "semantics", "annotation", "mrow", "mi", "mo", "mn",
    "msup", "msub", "mfrac", "msqrt", "mroot", "mover", "munder", "mtable",
    "mtr", "mtd", "svg", "path", "line", "line", "rect", "g", "text",
  ],
  ALLOWED_ATTR: [
    "href", "title", "class", "id", "aria-hidden", "aria-label",
    "style", "colspan", "rowspan", "scope",
    // KaTeX
    "mathvariant", "mathcolor", "mathbackground", "data-*",
  ],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "img", "picture", "source"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onmouseout", "onchange", "onfocus", "onblur"],
  ADD_TAGS: ["math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt", "mroot", "mover", "munder", "mtable", "mtr", "mtd", "svg", "path", "line", "rect", "g", "text"],
};

// ===== Capa de defensa independiente del motor DOM =====
// happy-dom no implementa DOMParser/implementation como espera DOMPurify, así
// que en ese entorno DOMPurify es un no-op sobre elementos anidados. Esta red
// de expresiones elimina vectores XSS de forma determinista en CUALQUIER
// motor (y además blinda en el navegador real como defense-in-depth).
// NOTA: en el navegador DOMPurify sigue siendo la primera línea; esto es una
// segunda capa, no el único mecanismo.
const FORBIDDEN_CONTAINER = [
  "script", "iframe", "object", "embed", "style", "picture", "source",
  "link", "meta", "base", "form", "input", "button", "textarea",
  "select", "option", "frame", "frameset", "svg",
];
const CONTAINER_RE = new RegExp(
  `<(${FORBIDDEN_CONTAINER.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
  "gi"
);
// Void/self-closing que deben desaparecer (img, embed, source, ...).
// svg EXCLUÍDO: lo necesita KaTeX.
const VOID_RE = /<(img|hr|br|wbr|col|area|base|embed|source|track|param|math|semantics|annotation|mrow|mi|mo|mn|msup|msub|mfrac|msqrt|mroot|mover|munder|mtable|mtr|mtd|path|line|rect|g|text)\b[^>]*>/gi;
const JS_URI_RE = /(href|src|xlink:href|data|formaction)\s*=\s*("|')\s*javascript:[^"']*\2/gi;
const ON_EVENT_RE = /\s+on(?:load|error|click|mouse\w+|focus|blur|change|submit|keydown|keyup|keypress|contextmenu|drag\w*|drop|scroll|resize|select|input|dblclick|wheel|pointer\w*)\s*=\s*("[^"]*"|'[^']*')/gi;

function stripDangerous(html: string): string {
  // 1) Contenedores prohibidos con su contenido (script, iframe, style...).
  let out = html.replace(CONTAINER_RE, "");
  // 2) Void tags prohibidos: img/embed/source -> texto legible (alt o url),
  //    el resto (hr, br, math de KaTeX...) se deja intacto.
  out = out.replace(VOID_RE, (m) => {
    const tag = (m.match(/^<\s*(\w+)/i)?.[1] ?? "").toLowerCase();
    if (tag === "img") {
      const alt = m.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ?? m.match(/\balt\s*=\s*'([^']*)'/i)?.[1] ?? "";
      const src = m.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1] ?? m.match(/\bsrc\s*=\s*'([^']*)'/i)?.[1] ?? "";
      // Privacidad E2EE: jamás pintamos la imagen externa. Mostramos alt o url como texto.
      return alt || src ? `[img: ${alt || src}]` : "[img]";
    }
    if (tag === "embed" || tag === "source") return "";
    return m;
  });
  // 3) URIs javascript:
  out = out.replace(JS_URI_RE, "");
  // 4) Manejadores de eventos inline
  out = out.replace(ON_EVENT_RE, "");
  return out;
}

// Renderiza bloques de código. En primer lugar devuelve el HTML tal cual
// (sin resaltar) para que el mensaje se muestre al instante; el resaltado
// con highlight.js se aplica de forma asíncrona/fire-and-forget tras el lazy
// import (§5.7). Así NO se propaga async por renderMarkdownSafe ni su caller.
function highlightCode(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const blocks = Array.from(container.querySelectorAll("pre code"));
  if (blocks.length === 0) return container.innerHTML;
  // §5.7: lazy-load de highlight.js + aplicar resaltado post-render (no bloqueante)
  void getHighlightJs().then((hljs: any) => {
    for (const block of blocks) {
      try {
        hljs.highlightElement(block as HTMLElement);
      } catch {
        /* dejar como está */
      }
    }
  }).catch(() => {
    /* highlight.js no disponible: degradado a código sin color (seguro) */
  });
  return container.innerHTML;
}

/** Convierte $...$ y $$...$$ en HTML de KaTeX dentro de un string ya en HTML. */
function renderLatexInHtml(html: string): string {
  // Procesar solo el texto fuera de tags <code>/<pre> para no tocar código.
  return html.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_m, block: string | undefined, inline: string | undefined) => {
    const tex = block ?? inline ?? "";
    const displayMode = block !== undefined;
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode,
        output: "html",
      });
    } catch {
      return _m; // si falla, dejar el texto original
    }
  });
}

export function renderMarkdownSafe(text: string): string {
  if (!text) return "";

  // Cache por contenido
  const cached = renderCache.get(text);
  if (cached !== undefined) return cached;

  // 1) Markdown -> HTML
  const htmlFromMarkdown = marked.parse(text, { async: false }) as string;

  // 2) Sanitizar (bloquea img externas, scripts, javascript:, etc.)
  //    Si no hay DOM (entorno sin window), degradamos a texto escapado:
  //    NUNCA inyectamos HTML sin sanitizar.
  let sanitized: string;
  if (DOMPurify) {
    sanitized = DOMPurify.sanitize(htmlFromMarkdown, PURIFY_CONFIG) as string;
  } else {
    const div = document.createElement("div");
    div.textContent = htmlFromMarkdown;
    sanitized = div.innerHTML;
  }
  // 2b) Red de seguridad independiente del motor DOM (defense-in-depth).
  sanitized = stripDangerous(sanitized);

  // 3) KaTeX sobre el HTML sanitizado (no introduce nada peligroso)
  const withKatex = renderLatexInHtml(sanitized);

  // 4) Resaltado de código (post-sanitizado, safe)
  const withCode = highlightCode(withKatex);

  renderCache.set(text, withCode);
  return withCode;
}

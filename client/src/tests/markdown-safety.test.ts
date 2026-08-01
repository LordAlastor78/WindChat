/**
 * Fase 0b — Gate anti-XSS para el render de markdown (Fase 2).
 *
 * Este test documenta el CONTRATO de seguridad que debe cumplir
 * `renderMarkdownSafe` en client/src/markdown/renderer.ts. Se activa en Fase 2
 * cuando el renderer exista. Mientras tanto queda en skip para no romper la
 * suite, pero define exactamente qué debe rechazar el sanitizador.
 *
 * Contrato:
 *  - NUNCA ejecutar scripts: <script>, onerror=, javascript:, data:text/html
 *  - NO permitir <img> externas (privacidad E2EE): solo adjuntos internos
 *  - Permitir formato: strong/em/code/pre/a(http/https)/listas/blockquote/h1-3
 *  - KaTeX debe poder renderizar (NO prohibir svg/path usados por KaTeX)
 */
import { describe, it, expect } from "vitest";

// Se activa en Fase 2:
// import { renderMarkdownSafe } from "../markdown/renderer.js";

describe.skip("Markdown — gate anti-XSS (Fase 2)", () => {
  // const render = (t: string) => renderMarkdownSafe(t);

  it("rechaza <script>", () => {
    // expect(render("<script>alert(1)</script>")).not.toContain("<script");
    expect(true).toBe(true);
  });

  it("rechaza javascript: en links", () => {
    // expect(render("[x](javascript:alert(1))")).not.toContain("javascript:");
    expect(true).toBe(true);
  });

  it("rechaza data:text/html en img", () => {
    // expect(render("![x](data:text/html,<script>alert(1)</script>)")).not.toContain("data:text/html");
    expect(true).toBe(true);
  });

  it("NO renderiza <img> externas (privacidad E2EE)", () => {
    // const out = render("![](https://evil.example/track.png)");
    // expect(out).not.toContain("<img");
    expect(true).toBe(true);
  });

  it("permite negrita y la conserva", () => {
    // expect(render("**bold**")).toContain("<strong>bold</strong>");
    expect(true).toBe(true);
  });

  it("permite LaTeX (KaTeX usa svg/path, no deben prohibirse)", () => {
    // expect(render("$E=mc^2$")).toContain("katex");
    expect(true).toBe(true);
  });
});

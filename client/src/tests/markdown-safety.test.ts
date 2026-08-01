/**
 * Fase 2 — Gate anti-XSS del render de markdown.
 *
 * Valida que renderMarkdownSafe (client/src/markdown/renderer.ts) cumple el
 * contrato de seguridad: rechaza scripts/javascript:/data:, NO renderiza
 * <img> externas (privacidad E2EE), conserva formato y LaTeX (KaTeX usa
 * svg/path, no deben prohibirse).
 */
import { describe, it, expect } from "vitest";
import { renderMarkdownSafe } from "../markdown/renderer.js";

describe("Markdown — gate anti-XSS (Fase 2)", () => {
  it("rechaza <script>", () => {
    const out = renderMarkdownSafe("<script>alert(1)</script>");
    expect(out).not.toContain("<script");
  });

  it("rechaza javascript: en links", () => {
    const out = renderMarkdownSafe("[x](javascript:alert(1))");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a ");
  });

  it("rechaza data:text/html en img", () => {
    const out = renderMarkdownSafe("![x](data:text/html,<script>alert(1)</script>)");
    expect(out).not.toContain("data:text/html");
    // Markdown no debe pintar <img> externas
    expect(out).not.toContain("<img");
  });

  it("NO renderiza <img> externas (privacidad E2EE)", () => {
    const out = renderMarkdownSafe("![](https://evil.example/track.png)");
    expect(out).not.toContain("<img");
  });

  it("permite negrita", () => {
    expect(renderMarkdownSafe("**bold**")).toContain("<strong>bold</strong>");
  });

  it("permite LaTeX inline y bloque (KaTeX usa svg/path)", () => {
    const inline = renderMarkdownSafe("$\\sqrt{2}$");
    expect(inline).toContain("katex");
    const block = renderMarkdownSafe("$$\\sum_{i=1}^{n} i$$");
    expect(block).toContain("katex");
  });

  it("permite código con highlight", () => {
    const out = renderMarkdownSafe("```js\nconst x = 1;\n```");
    expect(out).toContain("<code");
    expect(out).toContain("x = 1");
  });

  it("cache: mismo input da mismo output", () => {
    const a = renderMarkdownSafe("**x**");
    const b = renderMarkdownSafe("**x**");
    expect(a).toBe(b);
  });
});

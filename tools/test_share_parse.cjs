// Test aislado de la lógica de captura de URL de cloudflared (Fase 3).
// Emula el stdout realista de `cloudflared tunnel --url ...` y verifica que el
// parser extrae la URL https://*.trycloudflare.com. No requiere cloudflared real.
const TRYCF_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// Stdout realista de cloudflared (quick tunnel).
const SAMPLE = [
  "2026-08-02T12:00:00Z INF Thank you for trying Cloudflare Tunnel.",
  "2026-08-02T12:00:01Z INF Your quick Tunnel has been created! Visit it:",
  "2026-08-02T12:00:01Z INF https://fugaz-quick-9x2k.trycloudflare.com",
  "2026-08-02T12:00:02Z INF Connected to BASD edge via Warp",
].join("\n");

function parseCloudflaredUrl(chunk) {
  const text = chunk.toString();
  const m = text.match(TRYCF_RE);
  return m ? m[0] : null;
}

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} (got: ${JSON.stringify(got)})`); }
}

console.log("== test_share_parse ==");
const url = parseCloudflaredUrl(SAMPLE);
check("extrae URL https://*.trycloudflare.com", !!url, url);
check("URL empieza por https://", url && url.startsWith("https://"), url);
check("URL contiene .trycloudflare.com", url && url.includes(".trycloudflare.com"), url);
check("URL NO es localhost", url && !/localhost/.test(url), url);

// Caso: sin URL (todavía arrancando)
const noUrl = "2026-08-02T12:00:00Z INF Connecting...";
check("sin URL todavía → null", parseCloudflaredUrl(noUrl) === null, parseCloudflaredUrl(noUrl));

// Caso: formato alternativo "yourUrl = ..."
const alt = parseCloudflaredUrl("yourUrl = https://abc-123.trycloudflare.com");
check("formato yourUrl = ...", alt === "https://abc-123.trycloudflare.com", alt);

console.log(`\nResultado: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

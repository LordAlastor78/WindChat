// Launcher local para la Fase 3 (web-first). Actúa de puente entre la UI web y
// cloudflared: expone POST /share (lanza el túnel y devuelve la URL) y POST /stop
// (mata el túnel). En el .exe de Tauri, este launcher NO se usa (el comando Rust
// share_link hace lo mismo). Solo para verificar la Fase 3 en navegador.
//
// Uso: node tools/link_launcher.cjs  (opcional: CLOUDFLARED_STUB=1 para emular)
const http = require("http");
const { spawn } = require("child_process");

const PORT = 4300;
const RELAY_URL = process.env.RELAY_URL || "http://localhost:8080";

// Regex que captura la URL *.trycloudflare.com del stdout de cloudflared.
// Ejemplos reales:
//   "yourUrl = https://abc-123.trycloudflare.com"
//   "https://abc-123.trycloudflare.com"
const TRYCF_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

let cloudflaredProc = null;
let capturedUrl = null;

function parseCloudflaredUrl(chunk) {
  const text = chunk.toString();
  const m = text.match(TRYCF_RE);
  return m ? m[0] : null;
}

// Stub: emula el stdout de cloudflared para verificar la lógica sin el binario.
function startStub() {
  console.log("[link_launcher] CLOUDFLARED_STUB=1 → emulando túnel");
  const fake = "2026-08-02T12:00:00Z INF Thank you for trying Cloudflare Tunnel.\n" +
    "2026-08-02T12:00:01Z INF Your quick Tunnel has been created! Visit it:\n" +
    "2026-08-02T12:00:01Z INF https://fugaz-quick-9x2k.trycloudflare.com\n";
  // emitir de forma asíncrona para simular stdout
  setTimeout(() => {
    capturedUrl = parseCloudflaredUrl(fake);
    console.log("[link_launcher] URL capturada (stub):", capturedUrl);
  }, 400);
}

function startCloudflared() {
  const args = ["tunnel", "--url", RELAY_URL];
  console.log("[link_launcher] spawn cloudflared", args.join(" "));
  cloudflaredProc = spawn("cloudflared", args, { windowsHide: true });
  cloudflaredProc.stdout.on("data", (d) => {
    const url = parseCloudflaredUrl(d);
    if (url && !capturedUrl) {
      capturedUrl = url;
      console.log("[link_launcher] URL capturada:", capturedUrl);
    }
  });
  cloudflaredProc.stderr.on("data", (d) => {
    console.warn("[link_launcher][cloudflared stderr]", d.toString().trim());
  });
  cloudflaredProc.on("exit", (code) => {
    console.log("[link_launcher] cloudflared exit", code);
    cloudflaredProc = null;
    capturedUrl = null;
  });
}

function stopCloudflared() {
  if (cloudflaredProc) {
    try { cloudflaredProc.kill("SIGTERM"); } catch (e) {}
    cloudflaredProc = null;
  }
  capturedUrl = null;
}

const server = http.createServer((req, res) => {
  // CORS para que la UI web (en otro origen/puerto) pueda llamar al launcher.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "POST" && req.url === "/share") {
    if (capturedUrl) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: capturedUrl }));
      return;
    }
    if (process.env.CLOUDFLARED_STUB === "1") {
      startStub();
    } else {
      startCloudflared();
    }
    // esperar hasta 8s a que aparezca la URL
    const deadline = Date.now() + 8000;
    const poll = setInterval(() => {
      if (capturedUrl || Date.now() > deadline) {
        clearInterval(poll);
        if (capturedUrl) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ url: capturedUrl }));
        } else {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "timeout" }));
        }
      }
    }, 200);
    return;
  }
  if (req.method === "POST" && req.url === "/stop") {
    stopCloudflared();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ active: capturedUrl !== null, url: capturedUrl }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[link_launcher] en http://localhost:${PORT} (relay ${RELAY_URL})`);
});

process.on("exit", stopCloudflared);
process.on("SIGINT", () => { stopCloudflared(); process.exit(0); });
process.on("SIGTERM", () => { stopCloudflared(); process.exit(0); });

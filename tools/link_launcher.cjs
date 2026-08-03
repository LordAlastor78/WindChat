// Launcher local para la Fase 3 (web-first). Actúa de puente entre la UI web y
// cloudflared: expone POST /share (lanza el túnel y devuelve la URL) y POST /stop
// (mata el túnel). En el .exe de Tauri, este launcher NO se usa (el comando Rust
// share_link hace lo mismo). Solo para verificar la Fase 3 en navegador.
//
// Uso: node tools/link_launcher.cjs  (opcional: CLOUDFLARED_STUB=1 para emular)
const http = require("http");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");

const PORT = 4300;
const RELAY_URL = process.env.RELAY_URL || "http://localhost:8080";
const RELAY_PORT = 8080;
const ROOT = process.env.WC_ROOT || require("path").resolve(__dirname, "..");

let cloudflaredProc = null;
let capturedUrl = null;
let relayChild = null;

// ¿Está escuchando algo en un puerto?
function portListening(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    const done = (ok) => { try { s.destroy(); } catch (e) {} resolve(ok); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 600);
  });
}

// §fix 502: asegurar que el relay Rust (:8080) está UP antes de crear el túnel.
// Sin relay, cloudflared apunta a un backend muerto -> 502 Bad Gateway.
async function ensureRelay() {
  if (await portListening(RELAY_PORT)) return true;
  const exe = require("path").join(ROOT, "relay-rust", "target", "release", "relay-rust.exe");
  const debugExe = require("path").join(ROOT, "relay-rust", "target", "debug", "relay-rust.exe");
  const relExe = fs.existsSync(exe) ? exe : (fs.existsSync(debugExe) ? debugExe : null);
  if (!relExe) {
    console.warn("[link_launcher] relay-rust.exe no encontrado; túnel apuntará a :8080 vacío -> posible 502");
    return false;
  }
  relayChild = spawn(relExe, [], { cwd: require("path").join(ROOT, "relay-rust"), windowsHide: true, stdio: "ignore" });
  relayChild.on("exit", () => { relayChild = null; });
  console.log("[link_launcher] relay Rust lanzado como hijo en :8080");
  for (let i = 0; i < 15; i++) {
    if (await portListening(RELAY_PORT)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Regex que captura la URL *.trycloudflare.com del stdout/stderr de cloudflared.
const TRYCF_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function parseCloudflaredUrl(chunk) {
  const text = chunk.toString();
  const m = text.match(TRYCF_RE);
  return m ? m[0] : null;
}

// Stub: emula el stdout/stderr de cloudflared para verificar la lógica sin el binario.
function startStub() {
  console.log("[link_launcher] CLOUDFLARED_STUB=1 → emulando túnel");
  const fake =
    "2026-08-02T12:00:00Z INF Thank you for trying Cloudflare Tunnel.\n" +
    "2026-08-02T12:00:01Z INF Your quick Tunnel has been created! Visit it:\n" +
    "2026-08-02T12:00:01Z INF https://fugaz-quick-9x2k.trycloudflare.com\n";
  setTimeout(() => {
    capturedUrl = parseCloudflaredUrl(fake);
    console.log("[link_launcher] URL capturada (stub):", capturedUrl);
  }, 400);
}

function startCloudflared() {
  // §fix 502: re-verificar relay justo antes de tunelar (puede haber caído desde el arranque).
  // Si está caído, re-lanzar para evitar 502 Bad Gateway (cloudflared apuntando a :8080 muerto).
  portListening(RELAY_PORT).then((up) => {
    if (!up && !relayChild) {
      console.warn("[link_launcher] relay :8080 cayó antes del túnel; re-lanzando §fix-502");
      ensureRelay().catch((e) => console.warn("[link_launcher] re-ensureRelay falló:", e));
    }
  }).catch(() => {});
  const args = ["tunnel", "--url", RELAY_URL];
  console.log("[link_launcher] spawn cloudflared", args.join(" "));
  cloudflaredProc = spawn("cloudflared", args, { windowsHide: true });
  // cloudflared 2026.x escribe TODOS sus logs (incluida la URL del quick tunnel)
  // en STDERR, no en stdout. Parsear ambos streams para no perder la URL.
  const onData = (d) => {
    const url = parseCloudflaredUrl(d);
    if (url && !capturedUrl) {
      capturedUrl = url;
      console.log("[link_launcher] URL capturada:", capturedUrl);
    }
  };
  cloudflaredProc.stdout.on("data", (d) => { onData(d); });
  cloudflaredProc.stderr.on("data", (d) => { onData(d); });
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
  // también limpiar el relay que hayamos lanzado
  if (relayChild) {
    try { relayChild.kill("SIGTERM"); } catch (e) {}
    relayChild = null;
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
    // esperar hasta 15s a que aparezca la URL (cloudflared 2026.x puede tardar
    // hasta ~11s en emitir el quick tunnel URL). §fix timing
    const deadline = Date.now() + 15000;
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

server.listen(PORT, async () => {
  console.log(`[link_launcher] en http://localhost:${PORT} (relay ${RELAY_URL})`);
  // §fix 502: lanzar el relay Rust al arranque (no dentro del handler) para no bloquear el event loop.
  await ensureRelay().catch((e) => console.warn("[link_launcher] ensureRelay falló:", e));
});

process.on("exit", stopCloudflared);
process.on("SIGINT", () => { stopCloudflared(); process.exit(0); });
process.on("SIGTERM", () => { stopCloudflared(); process.exit(0); });

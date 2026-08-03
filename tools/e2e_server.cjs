// Server de prueba E2E: sirve estáticos de client/dist en 4183 y proxya
// SOLO las conexiones WebSocket (upgrade) al relay Rust en 8080.
// Además: si no hay relay vivo en :8080, lo lanza como hijo; expone
// POST /quit para matar el relay y cerrar el server (así la web puede
// "salir" de todo sin dejar procesos en 2o plano).
// Usa solo 'ws' (ya disponible) + http nativo. No afecta la app de producción.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const { WebSocket } = require('ws');

const STATIC_DIR = path.resolve(__dirname, '..', 'client', 'dist');
const RELAY_WS = 'ws://localhost:8080';
const PORT = 4183;
const RELAY_PORT = 8080;
const ROOT = path.resolve(__dirname, '..');

let relayChild = null;
let launcherChild = null;
const LAUNCHER_PORT = 4300;
const LAUNCHER_URL = `http://localhost:${LAUNCHER_PORT}`;

// ¿Hay ya un proceso escuchando en un puerto? (para no duplicar relay/launcher)
function portListening(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), 600);
  });
}

// ¿Hay ya un relay escuchando en :8080? (para no duplicar en E2E)
function relayListening() {
  return portListening(RELAY_PORT);
}

// §Fase 3 fix: el launcher de share link (link_launcher.cjs) debe arrancar como
// hijo del server, porque el cliente web llama a http://localhost:4300/share.
// Antes se lanzaba en una terminal separada; ahora el server lo gestiona.
async function ensureLauncher() {
  if (await portListening(LAUNCHER_PORT)) {
    console.log(`[e2e_server] launcher ya vivo en :${LAUNCHER_PORT}, no se lanza otro`);
    return;
  }
  const launcherScript = path.join(ROOT, 'tools', 'link_launcher.cjs');
  if (!fs.existsSync(launcherScript)) {
    console.warn('[e2e_server] link_launcher.cjs no encontrado; el botón Crear enlace no funcionará en web');
    return;
  }
  // Si cloudflared no está en PATH, usar STUB para que al menos la UI web no falle.
  const hasCloudflared = await new Promise((resolve) => {
    const probe = spawn('cloudflared', ['--version'], { windowsHide: true });
    probe.on('error', () => resolve(false));
    probe.on('exit', (code) => resolve(code === 0));
  });
  const launchEnv = { ...process.env };
  if (!hasCloudflared) {
    console.log('[e2e_server] cloudflared no está en PATH → launcher arranca en modo STUB');
    launchEnv.CLOUDFLARED_STUB = '1';
  }
  launcherChild = spawn('node', [launcherScript], {
    cwd: ROOT, env: launchEnv, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],  // stdout/stderr al server para poder debuggear 502
  });
  launcherChild.on('exit', (code) => {
    launcherChild = null;
    if (code !== 0 && code !== null) {
      console.warn(`[e2e_server] WARNING: launcher hijo murió (exit ${code}); se reiniciará en 2s §fix-502`);
      setTimeout(() => { ensureLauncher(); }, 2000);
    }
  });
  // loggear salida del launcher hijo (evita que muera en silencio y deje relay muerto → 502)
  launcherChild.stdout?.on('data', (d) => console.log('[launcher]', d.toString().trim()));
  launcherChild.stderr?.on('data', (d) => console.warn('[launcher:err]', d.toString().trim()));
  console.log(`[e2e_server] launcher (share link) lanzado como hijo en :${LAUNCHER_PORT}`);
  await new Promise((r) => setTimeout(r, 800));
}

async function ensureRelay() {
  if (await relayListening()) {
    console.log('[e2e_server] relay ya vivo en :8080, no se lanza otro');
    return;
  }
  // §5.9: buscar tanto release como debug build del relay Rust
  const exe = path.join(ROOT, 'relay-rust', 'target', 'release', 'relay-rust.exe');
  const debugExe = path.join(ROOT, 'relay-rust', 'target', 'debug', 'relay-rust.exe');
  const relExe = fs.existsSync(exe) ? exe : (fs.existsSync(debugExe) ? debugExe : null);
  if (!relExe) {
    console.warn('[e2e_server] relay-rust.exe no encontrado en release ni debug, el chat no conectará');
    return;
  }
  relayChild = spawn(relExe, [], { cwd: path.join(ROOT, 'relay-rust'), windowsHide: true, stdio: 'ignore' });
  relayChild.on('exit', () => { relayChild = null; });
  console.log('[e2e_server] relay Rust lanzado como hijo en :8080');
  await new Promise((r) => setTimeout(r, 800));
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

// Timer global para /quit (clearTimeout si se llama de nuevo). §fix-leak
let __quitTimer = null;

const server = http.createServer((req, res) => {
  // Cerrar todo (relay + server + launcher/túnel) a petición de la web
  if (req.method === 'POST' && req.url === '/quit') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    // §fix-leak: matar el relay primero, luego el launcher hijo con SIGINT (que
    // ejecuta su handler -> stopCloudflared() mata cloudflared limpio). SIGTERM
    // mata en cadena sin darle tiempo al launcher; 800ms da tiempo a cloudflared
    // a cerrar el túnel antes de process.exit (evita túnel zombie -> 502).
    try { if (relayChild) relayChild.kill('SIGTERM'); } catch {}
    if (launcherChild) {
      try { launcherChild.kill('SIGINT'); } catch {}
    }
    clearTimeout(__quitTimer);
    __quitTimer = setTimeout(() => process.exit(0), 800);
    return;
  }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/chat.html';
  const safePath = path.normalize(path.join(STATIC_DIR, urlPath));
  if (!safePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(safePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(STATIC_DIR, 'chat.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d2); }
      });
      return;
    }
    const ext = path.extname(safePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket, head) => {
  const clientWs = new WebSocket(RELAY_WS);
  let relaySocketAttached = false;

  clientWs.on('open', () => {
    // Hacer upgrade del socket del navegador hacia el relay manualmente
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + computeAccept(req.headers['sec-websocket-key']) + '\r\n\r\n'
    );
    relaySocketAttached = true;
    if (head && head.length) clientWs.send(head);
    socket.on('data', (chunk) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(chunk); });
    clientWs.on('message', (chunk) => { if (socket.writable) socket.write(chunk); });
    socket.on('close', () => clientWs.close());
    clientWs.on('close', () => socket.end());
    socket.on('error', () => clientWs.close());
    clientWs.on('error', () => socket.end());
  });
  clientWs.on('error', () => socket.destroy());
});

function computeAccept(key) {
  const crypto = require('crypto');
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

server.listen(PORT, async () => {
  console.log(`E2E server en http://localhost:${PORT} (proxy WS -> ${RELAY_WS})`);
  await ensureRelay();
  await ensureLauncher();
});

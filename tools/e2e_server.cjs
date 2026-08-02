// Server de prueba E2E: sirve estáticos de client/dist en 4183 y proxya
// SOLO las conexiones WebSocket (upgrade) al relay Rust en 8080.
// Usa solo 'ws' (ya disponible) + http nativo. No afecta la app de producción.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const STATIC_DIR = path.resolve(__dirname, '..', 'client', 'dist');
const RELAY_WS = 'ws://localhost:8080';
const PORT = 4183;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
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

server.listen(PORT, () => {
  console.log(`E2E server en http://localhost:${PORT} (proxy WS -> ${RELAY_WS})`);
});

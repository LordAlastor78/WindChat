/**
 * WindChat Server - WebSocket Server
 *
 * Responsabilidades:
 * - Gestionar rooms efímeras (Map en memoria)
 * - Intercambiar claves públicas P-256
 * - Reenviar mensajes cifrados (broadcast)
 * - Validar tamaño de mensajes
 * - Hard limit: máximo 2 usuarios por room
 *
 * QUE NO HACE:
 * - No almacena mensajes
 * - No ve claves privadas
 * - No descifra nada
 * - No persiste en BD
 */

import dotenv from 'dotenv';
import express, { type Request, type Response } from "express";
import fs from "fs";
import helmet from "helmet";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";
import type {
  EncryptedMessage,
  HandshakeMessage,
  ServerToClientMessage
} from "./protocol.js";
import {
  MAX_MESSAGE_SIZE,
  MAX_USERS_PER_ROOM,
  P256_RAW_PUBLIC_KEY_SIZE,
} from "./protocol.js";
import { getSecurityHeaders } from "./security-headers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Estructura de datos para cada conexión
interface ClientConnection {
  ws: WebSocket;
  roomId?: string;
  publicKey?: string;
  displayName?: string;
  connectionId?: string; // ID de conexión del handshake (para ecos)
  lastSeen?: number; // timestamp ms of last activity or pong
  isAlive?: boolean; // for server-initiated ping/pong
}

// Estructura de room
interface Room {
  clients: Map<WebSocket, ClientConnection>;
  /**
   * connectionIds ya vistos en esta room. Sirve para distinguir un NUEVO par
   * (handshake ECDH) de una RECONEXIÓN de transporte del mismo dispositivo.
   * El ratchet es estado de sesión y debe sobrevivir a caídas de red: si el
   * connectionId ya se vio, NO reenviamos peer_joined (eso reiniciaría el
   * ratchet y desincronizaría a los peers — el bug que fallaba en móvil).
   */
  seenConnectionIds: Set<string>;
}

// §FIX-F3: default 8081 para evitar colisión con el relay Rust (que usa 8080).
// El server Node es el relay "tonto" de referencia; en el flujo de producción
// local/desktop quien escucha 8080 es el relay Rust. Nunca ambos a la vez.
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8081;

// Map global: roomId → Room
const rooms = new Map<string, Room>();

// ============== RATE LIMITING ==============
// Configuración
const RATE_LIMIT_WINDOW = 1000; // 1 segundo
const MAX_MESSAGES_PER_WINDOW = 10; // máximo 10 mensajes/segundo
const MAX_JOINS_PER_WINDOW = 3; // máximo 3 joins/segundo (anti spam reconnect)

// Estructura: WebSocket → array de timestamps
const messageTimestamps = new Map<WebSocket, number[]>();
const joinTimestamps = new Map<WebSocket, number[]>();

/**
 * Verificar rate limit para un cliente
 * @returns true si está dentro del límite, false si excede
 */
function checkRateLimit(
  ws: WebSocket,
  type: "message" | "join"
): boolean {
  const now = Date.now();
  const timestamps = type === "message" ? messageTimestamps : joinTimestamps;
  const maxMessages = type === "message" ? MAX_MESSAGES_PER_WINDOW : MAX_JOINS_PER_WINDOW;

  // Obtener timestamps del cliente
  let clientTimestamps = timestamps.get(ws);
  if (!clientTimestamps) {
    clientTimestamps = [];
    timestamps.set(ws, clientTimestamps);
  }

  // Filtrar timestamps dentro de la ventana
  const windowStart = now - RATE_LIMIT_WINDOW;
  const recentTimestamps = clientTimestamps.filter(t => t > windowStart);

  // Verificar si excede el límite
  if (recentTimestamps.length >= maxMessages) {
    // Actualizar el Map con timestamps filtrados para prevenir memory leak
    timestamps.set(ws, recentTimestamps);
    return false; // Límite excedido
  }

  // Añadir timestamp actual y actualizar
  recentTimestamps.push(now);
  timestamps.set(ws, recentTimestamps);

  return true; // Dentro del límite
}

/**
 * Limpiar timestamps de un cliente desconectado
 */
function cleanupRateLimit(ws: WebSocket): void {
  messageTimestamps.delete(ws);
  joinTimestamps.delete(ws);
}

// ============================================

// Load .env early so env-driven tuning is available
dotenv.config();

// ============== LOGGING ==============
// Zero-telemetría: por defecto el servidor NO registra metadatos por mensaje
// (quién habla con quién, cuándo, cuánto). Poner VERBOSE_LOGS=true solo para
// depurar en local.
const VERBOSE_LOGS = ["true", "1", "yes"].includes(
  (process.env.VERBOSE_LOGS || "").toLowerCase()
);

function debugLog(...args: unknown[]): void {
  if (VERBOSE_LOGS) console.log(...args);
}

// ============== SERVER HEALTH ==============
const SERVER_EVENT_WINDOW = process.env.HEALTH_WINDOW_MS ? parseInt(process.env.HEALTH_WINDOW_MS) : 60 * 1000; // window for events
// Nota: el barrido de heartbeat es de dos fases (marcar / cerrar en el siguiente
// barrido), así que la tolerancia efectiva antes de cerrar un socket muerto es
// SERVER_PING_INTERVAL, no un timeout aparte.
const SERVER_PING_INTERVAL = process.env.HEARTBEAT_INTERVAL_MS ? parseInt(process.env.HEARTBEAT_INTERVAL_MS) : 30_000; // ms between ping sweeps
const EVALUATE_INTERVAL_MS = process.env.EVALUATE_INTERVAL_MS ? parseInt(process.env.EVALUATE_INTERVAL_MS) : 15_000; // health evaluation frequency

const DEGRADED_THRESHOLD = process.env.DEGRADED_THRESHOLD ? parseInt(process.env.DEGRADED_THRESHOLD) : 5;
const ALERT_THRESHOLD = process.env.ALERT_THRESHOLD ? parseInt(process.env.ALERT_THRESHOLD) : 10;

let serverHealth: "ok" | "degraded" | "alert" = "ok";
const serverEvents: { connections: number[]; disconnects: number[]; errors: number[]; rejected_origin: number[] } = {
  connections: [],
  disconnects: [],
  errors: [],
  rejected_origin: [],
};

function recordServerEvent(kind: keyof typeof serverEvents) {
  serverEvents[kind].push(Date.now());
}

function countRecent(kind: keyof typeof serverEvents, windowMs = SERVER_EVENT_WINDOW) {
  const now = Date.now();
  const arr = serverEvents[kind].filter(ts => ts > now - windowMs);
  serverEvents[kind] = arr; // prune old
  return arr.length;
}

function evaluateServerHealth() {
  const disconnects = countRecent('disconnects', SERVER_EVENT_WINDOW);
  const connections = countRecent('connections', SERVER_EVENT_WINDOW);
  const errors = countRecent('errors', SERVER_EVENT_WINDOW);

  const prev = serverHealth;
  // Use tunable thresholds from env
  if (disconnects >= ALERT_THRESHOLD || errors >= ALERT_THRESHOLD) serverHealth = 'alert';
  else if (disconnects >= DEGRADED_THRESHOLD || errors >= DEGRADED_THRESHOLD || connections >= (process.env.CONNECTIONS_DEGRADED_THRESHOLD ? parseInt(process.env.CONNECTIONS_DEGRADED_THRESHOLD) : 20)) serverHealth = 'degraded';
  else serverHealth = 'ok';

  if (prev !== serverHealth) {
    console.log(`⚕️ Server health changed: ${prev} -> ${serverHealth}`);
    broadcastServerStatus(serverHealth, `disconnects=${disconnects} errors=${errors} connections=${connections}`);
  }
}

function broadcastServerStatus(level: typeof serverHealth, message?: string) {
  const payload = JSON.stringify({ type: 'server_status', level, message });
  wss.clients.forEach((c) => {
    if ((c as WebSocket).readyState === WebSocket.OPEN) {
      try { (c as WebSocket).send(payload); } catch (e) { /* ignore */ }
    }
  });
}

// Periodic evaluation
setInterval(evaluateServerHealth, EVALUATE_INTERVAL_MS);

// Server-initiated ping/pong sweep.
// Marca cada socket como no-vivo, envía ping y en el siguiente barrido cierra
// los que no respondieron. Sin búsquedas O(n²) ni un setTimeout por cliente.
setInterval(() => {
  wss.clients.forEach((c) => {
    const wsClient = c as WebSocket;

    // Si no respondió al ping del barrido anterior, está muerto
    if ((wsClient as any).__isAlive === false) {
      console.warn("⚠️ Closing stale client (no pong)");
      try {
        wsClient.terminate();
      } catch (e) {
        try { wsClient.close(); } catch (e2) { /* ignore */ }
      }
      recordServerEvent("disconnects");
      return;
    }

    (wsClient as any).__isAlive = false;
    try {
      wsClient.ping();
    } catch (e) {
      // fallback: ping a nivel de aplicación
      try { wsClient.send(JSON.stringify({ type: "ping" })); } catch (e2) { /* ignore */ }
    }
  });
}, SERVER_PING_INTERVAL);

// Listen for ws-level pong events to mark alive
// We'll attach per-socket handler on connection
// ============================================

// MIME types
const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Headers de seguridad para todas las respuestas HTTP
 */
// security headers are provided by server/src/security-headers.ts

const isProduction = process.env.NODE_ENV === "production";
const clientDistPath = path.join(__dirname, "../../client/dist");
const useLocalHttps = ["true", "1", "yes"].includes((process.env.LOCAL_HTTPS || "").toLowerCase());
const httpsKeyPath = process.env.HTTPS_KEY_PATH || process.env.TLS_KEY_PATH;
const httpsCertPath = process.env.HTTPS_CERT_PATH || process.env.TLS_CERT_PATH;
const httpsCaPath = process.env.HTTPS_CA_PATH || process.env.TLS_CA_PATH;
const httpsPassphrase = process.env.HTTPS_PASSPHRASE || process.env.TLS_PASSPHRASE;

const app = express();
app.disable("x-powered-by");

const DEBUG_USER = process.env.DEBUG_USER;
const DEBUG_PASS = process.env.DEBUG_PASS;

function sendUnauthorized(res: Response) {
  res.setHeader('WWW-Authenticate', 'Basic realm="WindChat Debug"');
  return res.status(401).set(getSecurityHeaders('text/plain')).send('Unauthorized');
}

function checkDebugAuth(req: Request, res: Response, next: () => void) {
  if (!DEBUG_USER || !DEBUG_PASS) {
    console.warn('⚠️ Debug credentials not configured');
    return sendUnauthorized(res);
  }

  const auth = req.headers['authorization'];
  if (!auth || typeof auth !== 'string' || !auth.startsWith('Basic ')) {
    return sendUnauthorized(res);
  }

  try {
    const token = auth.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    if (sepIndex === -1) return sendUnauthorized(res);
    const user = decoded.slice(0, sepIndex);
    const pass = decoded.slice(sepIndex + 1);

    if (user === DEBUG_USER && pass === DEBUG_PASS) {
      return next();
    }
    return sendUnauthorized(res);
  } catch (err) {
    console.warn('⚠️ Error decoding auth header', err);
    return sendUnauthorized(res);
  }
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: isProduction,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// §H3.1 FIX: endpoint POST /quit + graceful shutdown handler.
// Antes no existía en el server Node real → solo e2e_server.cjs lo manejaba,
// bloqueando el apago cuando se ejecuta el server Node directamente.
// Movido AQUÍ (antes de express.static) para que no interfiera con el SPA
// fallback ni el WS upgrade.
let shuttingDown = false;
function gracefulShutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("🛑 Shutting down gracefully...");
  try {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, "server shutting down");
      }
    });
  } catch {
    /* clients may not be initialized */
  }
  wss.close(() => {
    server.close(() => process.exit(code));
    setTimeout(() => process.exit(code), 2000).unref();
  });
}
process.on("SIGTERM", () => gracefulShutdown(0));
// §H3.2 FIX: SIGINT no era manejado → Ctrl+C dejaba sockets WS en 'closing' → proceso zombie.
process.on("SIGINT", () => gracefulShutdown(0));

app.use((req, res, next) => {
  // Allow body parsing minimal para /quit sin inflar el server.
  if (req.url === "/quit" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024) req.destroy();
    });
    req.on("end", () => {
      gracefulShutdown(0);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  next();
});

app.use((req, res, next) => {
  const rawContentLength = req.headers["content-length"];
  if (rawContentLength) {
    const contentLength = parseInt(
      Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength,
      10
    );
    if (!Number.isNaN(contentLength) && contentLength > MAX_MESSAGE_SIZE * 10) {
      res.status(413).set(getSecurityHeaders("text/plain")).send("413 Payload Too Large");
      return;
    }
  }

  next();
});

// Debug endpoint: show active rooms and clients (protected by Basic Auth)
app.get('/debug/rooms', (req: Request, res: Response) => checkDebugAuth(req, res, () => {
  const out: any[] = [];
  rooms.forEach((room, id) => {
    const clients: any[] = [];
    room.clients.forEach((conn) => {
      clients.push({ displayName: conn.displayName || 'Anon' });
    });
    out.push({ roomId: id, clientsCount: room.clients.size, clients });
  });
  res.status(200).set(getSecurityHeaders('application/json')).json({ rooms: out });
}));

// Debug health endpoint
app.get('/debug/health', (req: Request, res: Response) => checkDebugAuth(req, res, () => {
  const health = serverHealth;
  const now = Date.now();
  const recent = {
    connections: serverEvents.connections.filter(ts => ts > now - SERVER_EVENT_WINDOW).length,
    disconnects: serverEvents.disconnects.filter(ts => ts > now - SERVER_EVENT_WINDOW).length,
    errors: serverEvents.errors.filter(ts => ts > now - SERVER_EVENT_WINDOW).length,
  };

  // sample rooms info (light)
  const roomsSummary: any[] = [];
  rooms.forEach((room, id) => {
    roomsSummary.push({ roomId: id, clients: room.clients.size });
  });

  res.status(200).set(getSecurityHeaders('application/json')).json({
    serverHealth: health,
    recent,
    rooms: roomsSummary,
  });
}));

// Servido estático seguro: express.static resuelve y normaliza la ruta,
// bloqueando path traversal (../, %2e%2e, bytes nulos) por sí mismo.
// El handler manual anterior hacía path.join con la URL cruda.
app.use(
  express.static(clientDistPath, {
    index: false,
    dotfiles: "ignore",
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath);
      const contentType = mimeTypes[ext] || "application/octet-stream";
      res.set(getSecurityHeaders(contentType));
    },
  })
);

// Fallback SPA: cualquier ruta no resuelta devuelve index.html.
// No se construye ninguna ruta a partir de la URL del cliente.
app.get("*", (_req: Request, res: Response) => {
  const indexPath = path.join(clientDistPath, "index.html");

  if (!fs.existsSync(indexPath)) {
    res.status(404).set(getSecurityHeaders("text/plain")).send("404 Not Found");
    return;
  }

  res.status(200).set(getSecurityHeaders("text/html")).sendFile(indexPath);
});



function createServer() {
  if (useLocalHttps) {
    if (!httpsKeyPath || !httpsCertPath) {
      console.warn("⚠️ LOCAL_HTTPS está activo, pero faltan HTTPS_KEY_PATH y/o HTTPS_CERT_PATH. Se usará HTTP.");
    } else {
      try {
        const tlsOptions: https.ServerOptions = {
          key: fs.readFileSync(httpsKeyPath),
          cert: fs.readFileSync(httpsCertPath),
        };

        if (httpsCaPath) {
          tlsOptions.ca = fs.readFileSync(httpsCaPath);
        }

        if (httpsPassphrase) {
          tlsOptions.passphrase = httpsPassphrase;
        }

        console.log(`🔐 TLS local habilitado con cert: ${httpsCertPath}`);
        return https.createServer(tlsOptions, app);
      } catch (error) {
        console.warn("⚠️ No se pudo inicializar HTTPS local, se usará HTTP:", error);
      }
    }
  }

  return http.createServer(app);
}

const server = createServer();
const serverScheme = server instanceof https.Server ? "https" : "http";
const wsScheme = serverScheme === "https" ? "wss" : "ws";

// WebSocket Server montado sobre el HTTP server de Express
const wss = new WebSocketServer({ server });


function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Validar que un base64 codifica una clave pública P-256 sin comprimir:
 * 65 bytes exactos, empezando por 0x04. El cliente ya lo comprueba, pero el
 * servidor no debe reenviar basura que rompa al peer.
 */
function isValidP256PublicKey(value: string): boolean {
  if (!isValidBase64(value)) return false;
  try {
    const raw = Buffer.from(value, "base64");
    return raw.length === P256_RAW_PUBLIC_KEY_SIZE && raw[0] === 0x04;
  } catch {
    return false;
  }
}

// §H2.2/H1.3 FIX: validar Origin en el WS handshake para prevenir CSRF.
const ALLOWED_ORIGINS = new Set(
  [
    "http://localhost:4183",
    "https://localhost:4183",
    "http://127.0.0.1:4183",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "tauri://localhost",
  ].map((o) => o.toLowerCase())
);
function isValidOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // conexiones server-side (Node tests) no envían Origin
  const o = origin.toLowerCase();
  if (ALLOWED_ORIGINS.has(o)) return true;
  if (o.startsWith("https://") && o.endsWith(".trycloudflare.com")) return true;
  return false;
}

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  // §H2.2 FIX: rechazar conexiones WS con Origin hostig (CSRF).
  const origin = req.headers.origin as string | undefined;
  if (!isValidOrigin(origin)) {
    console.warn(`⚠️ WS rechazado por Origin inválido: ${origin ?? "(none)"}`);
    ws.close(1008, "Forbidden origin");
    recordServerEvent("rejected_origin");
    return;
  }
  const remoteAddr = (ws as any)?._socket?.remoteAddress || 'unknown';
  console.log("✅ Nuevo cliente conectado");
  debugLog(`   from ${remoteAddr}`);
  const client: ClientConnection = { ws, lastSeen: Date.now(), isAlive: true };
  recordServerEvent('connections');

  // Attach pong handler for ws-level pings
  try {
    ws.on('pong', () => {
      (ws as any).__isAlive = true;
      client.lastSeen = Date.now();
      client.isAlive = true;
    });
  } catch (e) {
    // some transports may not support pong events
  }

  ws.on("message", (data: WebSocket.Data) => {
    try {
      // update last seen on any incoming data
      client.lastSeen = Date.now();

      // Validar tamaño ANTES de parsear: no gastar CPU parseando 10MB de JSON
      // solo para descubrir después que era demasiado grande.
      const raw = data.toString();
      if (raw.length > MAX_MESSAGE_SIZE) {
        console.warn(`⚠️ Mensaje demasiado grande: ${raw.length} bytes`);
        ws.close(1009, "Message too large");
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        console.warn("⚠️ Mensaje JSON inválido");
        ws.close(1008, "Invalid JSON");
        return;
      }

      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
        console.warn("⚠️ Mensaje sin tipo válido");
        return;
      }

      // Procesar según tipo de mensaje
      switch (msg.type) {
        case "join":
          handleJoin(ws, msg as HandshakeMessage, client);
          break;
        case "message":
          handleMessage(ws, msg as EncryptedMessage, client);
          break;
        case "typing":
          handleTyping(ws, msg, client);
          break;
        // ✅ NUEVA: Handler para heartbeat/ping-pong
        case "ping":
          try {
            ws.send(JSON.stringify({ type: "pong" }));
            debugLog("💓 Ping recibido, pong enviado");
          } catch (err) {
            console.error("❌ Error enviando pong:", err);
          }
          break;
        case "pong":
          try {
            (ws as any).__isAlive = true;
            client.lastSeen = Date.now();
            debugLog('💓 Pong application-level recibido');
          } catch (e) { }
          break;
        case "disconnect":
          handleDisconnect(ws, client);
          break;
        default:
          console.warn(`⚠️ Tipo de mensaje desconocido: ${msg.type}`);
      }
    } catch (err) {
      console.error("❌ Error procesando mensaje:", err);
      recordServerEvent('errors');
    }
  });

  ws.on("close", () => {
    cleanupRateLimit(ws);
    handleDisconnect(ws, client);
    recordServerEvent('disconnects');
  });

  ws.on("error", (err: Error) => {
    console.error("❌ WebSocket error:", err);
  });
});

/**
 * Handler: Join/Handshake
 * El cliente envía su clave pública
 * Si hay 2do cliente en la room, intercambiar claves
 */
function handleJoin(
  ws: WebSocket,
  msg: HandshakeMessage,
  client: ClientConnection
) {
  const { roomId, publicKey, connectionId } = msg;
  const displayName =
    typeof msg.displayName === "string" && msg.displayName.trim().length > 0
      ? msg.displayName.trim().slice(0, 24)
      : "Anon";

  // Rate limit check
  if (!checkRateLimit(ws, "join")) {
    console.warn("⚠️ Rate limit excedido en join");
    ws.close(1008, "Rate limit exceeded");
    return;
  }

  // Validar
  if (
    typeof roomId !== "string" ||
    typeof publicKey !== "string" ||
    roomId.trim().length === 0 ||
    roomId.length > 128 ||
    !isValidP256PublicKey(publicKey)
  ) {
    console.warn("⚠️ Handshake incompleto");
    ws.close(1008, "Invalid handshake");
    return;
  }

  // Obtener o crear room
  let room = rooms.get(roomId);
  if (!room) {
    room = { clients: new Map(), seenConnectionIds: new Set() };
    rooms.set(roomId, room);
      debugLog(`📍 Nueva room creada: ${roomId}`);
  }

  // Hard limit: máximo 2 conexiones
  if (room.clients.size >= MAX_USERS_PER_ROOM) {
    console.warn(`⚠️ Room llena: ${roomId}`);
    ws.close(1008, "Room full");
    return;
  }

  // Guardar cliente
  client.roomId = roomId;
  client.publicKey = publicKey;
  client.displayName = displayName;
  client.connectionId = connectionId;

  room.clients.set(ws, client);

  const isReconnect = connectionId && room.seenConnectionIds.has(connectionId);
  if (connectionId) room.seenConnectionIds.add(connectionId);

  console.log(`✅ Cliente se unió a una room (${room.clients.size}/${MAX_USERS_PER_ROOM})`);
  debugLog(`   room=${roomId} displayName=${displayName}${isReconnect ? " [reconexión]" : ""}`);

  // Solo hacer handshake ECDH cuando entramos a una room recién emparejada
  // (1→2). En reconexiones del mismo connectionId NO reenviamos peer_joined:
  // el ratchet ya existe en ambos lados y re-negociarlo los desincronizaría
  // (el bug que fallaba en móvil por señal inestable).
  if (room.clients.size === 2 && !isReconnect) {
    broadcastPeerJoined(room);
    debugLog(`👥 Room ${roomId} activa (2/2 clientes)`);
  }
}

/**
 * Handler: Mensaje cifrado
 * Solo retransmite el blob sin descifrar
 */
function handleMessage(
  ws: WebSocket,
  msg: EncryptedMessage,
  client: ClientConnection
) {
  if (!client.roomId) {
    console.warn("⚠️ Mensaje de cliente no unido a room");
    return;
  }

  // Rate limit check
  if (!checkRateLimit(ws, "message")) {
    console.warn("⚠️ Rate limit excedido en mensaje");
    return; // Silenciosamente ignorar (no cerrar conexión)
  }

  const room = rooms.get(client.roomId);
  if (!room) return;

  // Validar estructura
  if (
    typeof msg.iv !== "string" ||
    typeof msg.ciphertext !== "string" ||
    !isValidBase64(msg.iv) ||
    !isValidBase64(msg.ciphertext)
  ) {
    console.warn("⚠️ Mensaje incompleto");
    return;
  }

  // El contador del ratchet debe ser un entero no negativo.
  // El servidor no puede leerlo ni falsificarlo de forma útil (va autenticado
  // como AAD del GCM), pero sí valida el tipo para no reenviar basura.
  if (
    typeof msg.counter !== "number" ||
    !Number.isInteger(msg.counter) ||
    msg.counter < 0
  ) {
    console.warn("⚠️ Contador de ratchet inválido");
    return;
  }

  // Broadcast a todos EXCEPTO el sender
  // §H3.3 FIX: senderId debe ser explícitamente null cuando connectionId es undefined.
  // Antes se asignaba `client.connectionId` (string | undefined) → JSON.stringify
  // OMITÍA la key cuando era undefined → el cliente (websocket.ts:343) no filtraba el eco →
  // desincronizaba el ratchet. El relay Rust envía `null` (serde Option<String>).
  // Normalizamos a null para que ambas capas sean consistentes.
  const response: ServerToClientMessage = {
    type: "message",
    iv: msg.iv,
    ciphertext: msg.ciphertext,
    counter: msg.counter,
    senderId: client.connectionId ?? null,
  };

  let sent = 0;
  debugLog(`📨 Mensaje cifrado recibido en room ${client.roomId}`);
  room.clients.forEach((_, clientWs) => {
    if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(JSON.stringify(response));
        sent++;
      } catch (err) {
        console.warn("⚠️ Failed to send message to a client:", err);
      }
    }
  });
  debugLog(`📡 Broadcast a ${sent} destinatario(s)`);
}

/**
 * Handler: Typing indicator
 * Relay a otros clientes en la room
 */
function handleTyping(ws: WebSocket, msg: any, client: ClientConnection) {
  if (!client.roomId) return;

  // Rate limit check (menos estricto, usa el límite de mensajes)
  if (!checkRateLimit(ws, "message")) {
    return; // Silenciosamente ignorar
  }

  if (typeof msg?.isTyping !== "boolean") {
    return;
  }

  const room = rooms.get(client.roomId);
  if (!room) return;

  let sent = 0;
  room.clients.forEach((_, clientWs) => {
    if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(JSON.stringify({ type: "typing", isTyping: msg.isTyping }));
        sent++;
      } catch (err) {
        console.warn("⚠️ Failed to send typing event:", err);
      }
    }
  });
  debugLog(`⌨️ Relayed typing=${msg.isTyping} to ${sent} peers`);
}

/**
 * Handler: Desconexión
 */
function handleDisconnect(ws: WebSocket, client: ClientConnection) {
  // Limpiar rate limit
  cleanupRateLimit(ws);

  if (!client.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) return;

  // §FIX-F1: limpiar el connectionId del set de reconexión al desconectar.
  // Sin esto, seenConnectionIds crece sin límite y una reconexión REAL del
  // peer (tras caída completa) se trata como "blip" y no reenvía peer_joined
  // → el peer restante queda ciego y sin poder re-handshakear (bug F-1).
  if (client.connectionId) room.seenConnectionIds.delete(client.connectionId);

  room.clients.delete(ws);
  debugLog(`👋 Cliente desconectado. Quedan ${room.clients.size} en room`);

  // Si room vacía, eliminar
  if (room.clients.size === 0) {
    rooms.delete(client.roomId);
    debugLog(`🗑️ Room ${client.roomId} eliminada (vacía)`);
  }
  // Si 1 cliente, notificar que peer se fue
  else {
    room.clients.forEach((_, clientWs) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "peer_disconnected" }));
        // Ensure typing indicator is cleared on peer disconnect
        try {
          clientWs.send(JSON.stringify({ type: "typing", isTyping: false }));
        } catch (err) {
          console.warn("⚠️ Failed to send typing:false on disconnect:", err);
        }
      }
    });
  }
}

/**
 * Intercambiar claves públicas entre ambos clientes
 */
function broadcastPeerJoined(room: Room) {
  const clients = Array.from(room.clients.entries());

  // Enviar clave del otro a cada uno
  clients.forEach(([ws, client]) => {
    const other = clients.find(([otherWs]) => otherWs !== ws);
    if (other) {
      const otherKey = other[1].publicKey;
      ws.send(
        JSON.stringify({
          type: "peer_joined",
          theirPublicKey: otherKey,
          theirDisplayName: other[1].displayName || "Anon",
        })
      );
      debugLog(`📤 Clave pública intercambiada para ${client.roomId}`);
    }
  });
}

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 WindChat Server (Express + ${serverScheme.toUpperCase()} + WebSocket) en puerto ${PORT}`);
  console.log(`📁 Sirviendo archivos desde: ${clientDistPath}`);
  console.log(`📡 WebSocket listo en ${wsScheme}://localhost:${PORT}`);
  console.log(`🌐 ${serverScheme.toUpperCase()} listo en ${serverScheme}://localhost:${PORT}`);
});

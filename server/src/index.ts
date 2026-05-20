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
}

// Estructura de room
interface Room {
  clients: Map<WebSocket, ClientConnection>;
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

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

app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: isProduction,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

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

app.get("*", (req: Request, res: Response) => {
  let requestUrl = req.originalUrl || "/";

  if (requestUrl.includes("://")) {
    try {
      const urlObj = new URL("http://dummy" + requestUrl);
      requestUrl = urlObj.pathname;
    } catch (error) {
      const match = requestUrl.match(/https?:\/\/[^/]+(\/.*)/) || requestUrl.match(/\/https?:\/\/[^/]+(\/.*)/);
      if (match && match[1]) {
        requestUrl = match[1];
      }
    }
  }

  console.log(`📥 HTTP ${req.method} ${requestUrl}`);

  let filePath = path.join(clientDistPath, requestUrl === "/" ? "index.html" : requestUrl);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).set(getSecurityHeaders("text/plain")).send("404 Not Found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(500).set(getSecurityHeaders("text/plain")).send("500 Internal Server Error");
      return;
    }

    res.status(200).set(getSecurityHeaders(contentType)).send(data);
  });
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

wss.on("connection", (ws: WebSocket) => {
  console.log("✅ Nuevo cliente conectado");

  const client: ClientConnection = { ws };

  ws.on("message", (data: WebSocket.Data) => {
    try {
      // Parsear JSON
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn("⚠️ Mensaje JSON inválido");
        ws.close(1008, "Invalid JSON");
        return;
      }

      // Validar tamaño del mensaje
      const dataSize = data.toString().length;
      if (dataSize > MAX_MESSAGE_SIZE) {
        console.warn(`⚠️ Mensaje demasiado grande: ${dataSize} bytes`);
        ws.close(1009, "Message too large");
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
            console.log("💓 Ping recibido, pong enviado");
          } catch (err) {
            console.error("❌ Error enviando pong:", err);
          }
          break;
        case "disconnect":
          handleDisconnect(ws, client);
          break;
        default:
          console.warn(`⚠️ Tipo de mensaje desconocido: ${msg.type}`);
      }
    } catch (err) {
      console.error("❌ Error procesando mensaje:", err);
    }
  });

  ws.on("close", () => {
    cleanupRateLimit(ws);
    handleDisconnect(ws, client);
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
  const { roomId, publicKey } = msg;
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
    !isValidBase64(publicKey)
  ) {
    console.warn("⚠️ Handshake incompleto");
    ws.close(1008, "Invalid handshake");
    return;
  }

  // Obtener o crear room
  let room = rooms.get(roomId);
  if (!room) {
    room = { clients: new Map() };
    rooms.set(roomId, room);
    console.log(`📍 Nueva room creada: ${roomId}`);
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
  room.clients.set(ws, client);

  console.log(`✅ Cliente se unió a room ${roomId}. Total: ${room.clients.size}`);

  // Si hay otro cliente, intercambiar claves públicas
  if (room.clients.size === 2) {
    broadcastPeerJoined(room);
    console.log(`👥 Room ${roomId} activa (2/2 clientes)`);
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

  // Broadcast a todos EXCEPTO el sender
  const response: ServerToClientMessage = {
    type: "message",
    iv: msg.iv,
    ciphertext: msg.ciphertext,
  };

  room.clients.forEach((_, clientWs) => {
    if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(response));
    }
  });
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

  room.clients.forEach((_, clientWs) => {
    if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "typing", isTyping: msg.isTyping }));
    }
  });
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

  room.clients.delete(ws);
  console.log(`👋 Cliente desconectado. Quedan ${room.clients.size} en room`);

  // Si room vacía, eliminar
  if (room.clients.size === 0) {
    rooms.delete(client.roomId);
    console.log(`🗑️ Room ${client.roomId} eliminada (vacía)`);
  }
  // Si 1 cliente, notificar que peer se fue
  else {
    room.clients.forEach((_, clientWs) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "peer_disconnected" }));
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
      console.log(`📤 Clave pública intercambiada para ${client.roomId}`);
    }
  });
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Shutting down...");
  wss.close();
  server.close();
  process.exit(0);
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 WindChat Server (Express + ${serverScheme.toUpperCase()} + WebSocket) en puerto ${PORT}`);
  console.log(`📁 Sirviendo archivos desde: ${clientDistPath}`);
  console.log(`📡 WebSocket listo en ${wsScheme}://localhost:${PORT}`);
  console.log(`🌐 ${serverScheme.toUpperCase()} listo en ${serverScheme}://localhost:${PORT}`);
});

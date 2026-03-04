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

import WebSocket, { WebSocketServer } from "ws";
import type {
  ClientToServerMessage,
  ServerToClientMessage,
  HandshakeMessage,
  EncryptedMessage,
} from "./protocol.js";
import {
  MAX_MESSAGE_SIZE,
  MAX_USERS_PER_ROOM,
  ROOM_TIMEOUT,
} from "./protocol.js";

// Estructura de datos para cada conexión
interface ClientConnection {
  ws: WebSocket;
  roomId?: string;
  publicKey?: string;
}

// Estructura de room
interface Room {
  clients: Map<WebSocket, ClientConnection>;
  timeout?: NodeJS.Timeout;
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

const wss = new WebSocketServer({ port: PORT });

// Map global: roomId → Room
const rooms = new Map<string, Room>();

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

console.log(`🚀 WindChat Server iniciado en puerto ${PORT}`);
console.log(`📡 Esperando conexiones WebSocket...`);

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
  room.clients.set(ws, client);

  console.log(`✅ Cliente se unió a room ${roomId}. Total: ${room.clients.size}`);

  // Si hay otro cliente, intercambiar claves públicas
  if (room.clients.size === 2) {
    broadcastPeerJoined(room);
    console.log(`👥 Room ${roomId} activa (2/2 clientes)`);

    // Limpiar room al timeout
    if (room.timeout) clearTimeout(room.timeout);
    room.timeout = setTimeout(() => {
      console.log(`⏰ Room ${roomId} timeout. Limpiando...`);
      room.clients.forEach((_, clientWs) => {
        clientWs.close(1000, "Room timeout");
      });
      rooms.delete(roomId);
    }, ROOM_TIMEOUT);
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
  if (!client.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) return;

  room.clients.delete(ws);
  console.log(`👋 Cliente desconectado. Quedan ${room.clients.size} en room`);

  // Si room vacía, eliminar
  if (room.clients.size === 0) {
    if (room.timeout) clearTimeout(room.timeout);
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
  process.exit(0);
});

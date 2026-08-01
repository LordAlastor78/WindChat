/**
 * WindChat Protocol - Tipos compartidos entre servidor y cliente
 *
 * ⚠️ FUENTE ÚNICA DE VERDAD.
 * `client/src/protocol.ts` y `server/src/protocol.ts` son copias generadas
 * por `npm run sync:protocol` (scripts/sync-protocol.js). NO las edites a mano:
 * cualquier cambio debe hacerse aquí y luego sincronizarse.
 *
 * Especificación E2EE:
 * - ECDH P-256 para intercambio de claves
 * - HKDF-SHA256 para derivar el root secret del ratchet
 * - Ratchet simétrico HMAC-SHA256: clave AES-256 de UN SOLO USO por mensaje
 *   (forward secrecy: comprometer el estado actual no descifra lo anterior)
 * - AES-256-GCM para cifrado con autenticación
 * - IV de 12 bytes aleatorio POR MENSAJE
 * - Contador del ratchet autenticado como AAD (no manipulable)
 * - Timestamp DENTRO del ciphertext (no visible al servidor)
 * - SAS (safety number) derivado de ambas claves públicas para detectar MITM
 */

// ===== HANDSHAKE MESSAGES =====

export interface HandshakeMessage {
  type: "join";
  roomId: string;           // ej: "abc123xyz" (random 128 bits B64)
  publicKey: string;        // base64 encoded raw P-256 public key
  displayName?: string;
}

export interface PeerJoinedMessage {
  type: "peer_joined";
  theirPublicKey: string;   // base64 encoded raw P-256 public key
  theirDisplayName?: string;
}

export interface PeerDisconnectedMessage {
  type: "peer_disconnected";
}

// ===== ENCRYPTED MESSAGE =====

/**
 * Mensaje cifrado transmitido por el servidor
 * El servidor NUNCA ve el contenido de ciphertext
 */
export interface EncryptedMessage {
  type: "message";
  iv: string;               // base64 encoded, 12 bytes (DEBE SER RANDOM SIEMPRE)
  ciphertext: string;       // base64 encoded AES-GCM(messageKey, payload, iv)
  /**
   * Índice del mensaje en la cadena del ratchet del emisor.
   *
   * Va en claro (el servidor lo reenvía tal cual) pero se autentica como
   * AAD de GCM: manipularlo invalida el tag y el descifrado falla.
   * El receptor lo necesita para saber cuántos pasos avanzar la cadena
   * cuando los mensajes llegan fuera de orden.
   */
  counter: number;
}

/**
 * Estructura DENTRO del ciphertext
 * Solo visible después de descifrar
 */
export interface MessagePayload {
  id?: string;
  type?: "text" | "reaction" | "receipt" | "file_metadata" | "file_chunk" | "file_complete";
  text: string;
  displayName?: string;
  reactionToId?: string;
  replyToId?: string;
  receiptForId?: string;
  receiptState?: "sent" | "delivered" | "read";
  timestamp: number;        // milisegundos desde epoch

  // File metadata (type: "file_metadata")
  fileId?: string;          // UUID para identificar el archivo
  fileName?: string;        // Nombre original del archivo
  fileSize?: number;        // Tamaño total en bytes
  fileType?: string;        // MIME type (ej: "image/png")
  totalChunks?: number;     // Número total de chunks

  // File chunk (type: "file_chunk")
  chunkIndex?: number;      // Índice del chunk (0-based)
  chunkData?: string;       // Base64 del chunk cifrado

  // Progress tracking
  chunksReceived?: number;  // Cuántos chunks se han recibido
}

// ===== UI INDICATORS =====

export interface TypingIndicator {
  type: "typing";
  isTyping: boolean;
}

export interface DisconnectMessage {
  type: "disconnect";
  reason?: string;
}

// ===== HEARTBEAT MESSAGES =====

/**
 * Ping enviado por el cliente para verificar conexión activa
 */
export interface PingMessage {
  type: "ping";
}

/**
 * Pong respondido por el servidor confirmando conexión activa
 */
export interface PongMessage {
  type: "pong";
}

// ===== SERVER HEALTH =====

/**
 * Aviso de salud del servidor difundido a todos los clientes.
 * No contiene datos de conversación.
 */
export interface ServerStatusMessage {
  type: "server_status";
  level: "ok" | "degraded" | "alert";
  message?: string;
}

// ===== UNION TYPES =====

export type ClientToServerMessage =
  | HandshakeMessage
  | EncryptedMessage
  | TypingIndicator
  | DisconnectMessage
  | PingMessage;

export type ServerToClientMessage =
  | PeerJoinedMessage
  | PeerDisconnectedMessage
  | EncryptedMessage
  | TypingIndicator
  | PongMessage
  | ServerStatusMessage;

// ===== CONSTANTS =====

export const PROTOCOL_VERSION = "1.0.0";
export const IV_SIZE = 12;              // bytes
export const KEY_SIZE = 256;            // bits
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_USERS_PER_ROOM = 2;    // Hard limit

/** Longitud exacta de una clave pública P-256 sin comprimir: 0x04 + X(32) + Y(32) */
export const P256_RAW_PUBLIC_KEY_SIZE = 65;

/**
 * Máximo salto permitido en el contador del ratchet.
 * Limita cuántas claves intermedias se derivan y guardan cuando llegan
 * mensajes fuera de orden: sin este tope, un peer podría mandar
 * counter=2^31 y forzar millones de HMAC (DoS de CPU/memoria).
 */
export const MAX_RATCHET_SKIP = 256;

// File sharing constants
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const FILE_CHUNK_SIZE = 256 * 1024;     // 256 KB por chunk
export const ALLOWED_FILE_TYPES = [
  // Imágenes
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "image/svg+xml",
  // Video
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  // Documentos
  "application/pdf",
  "text/plain",
  // Comprimidos
  "application/zip",
  "application/x-zip-compressed",
]; // null = permitir todos

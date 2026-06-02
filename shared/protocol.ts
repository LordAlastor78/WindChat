/**
 * WindChat Protocol - Tipos compartidos entre servidor y cliente
 *
 * Especificación E2EE:
 * - ECDH P-256 para intercambio de claves
 * - HKDF-SHA256 para derivación de clave AES
 * - AES-256-GCM para cifrado con autenticación
 * - IV de 12 bytes aleatorio POR MENSAJE
 * - Timestamp DENTRO del ciphertext (no visible al servidor)
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
  ciphertext: string;       // base64 encoded AES-GCM(key, payload, iv)
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

// ===== ✅ NUEVA: HEARTBEAT MESSAGES =====

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

// ===== UNION TYPES =====

export type ClientToServerMessage =
  | HandshakeMessage
  | EncryptedMessage
  | TypingIndicator
  | DisconnectMessage
  | PingMessage;  // ✅ NUEVA: Agregar ping

export type ServerToClientMessage =
  | PeerJoinedMessage
  | PeerDisconnectedMessage
  | EncryptedMessage
  | TypingIndicator
  | PongMessage;  // ✅ NUEVA: Agregar pong

// ===== CONSTANTS =====

export const PROTOCOL_VERSION = "1.0.0";
export const IV_SIZE = 12;              // bytes
export const KEY_SIZE = 256;            // bits
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_USERS_PER_ROOM = 2;    // Hard limit

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
  "image/svg+xml",
  // Documentos
  "application/pdf",
  "text/plain",
  // Comprimidos
  "application/zip",
  "application/x-zip-compressed",
]; // null = permitir todos

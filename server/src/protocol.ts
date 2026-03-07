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
  type?: "text" | "reaction";
  text: string;
  displayName?: string;
  reactionToId?: string;
  replyToId?: string;
  timestamp: number;        // milisegundos desde epoch
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

// ===== UNION TYPES =====

export type ClientToServerMessage = 
  | HandshakeMessage 
  | EncryptedMessage 
  | TypingIndicator 
  | DisconnectMessage;

export type ServerToClientMessage = 
  | PeerJoinedMessage 
  | PeerDisconnectedMessage
  | EncryptedMessage 
  | TypingIndicator;

// ===== CONSTANTS =====

export const PROTOCOL_VERSION = "1.0.0";
export const IV_SIZE = 12;              // bytes
export const KEY_SIZE = 256;            // bits
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_USERS_PER_ROOM = 2;    // Hard limit

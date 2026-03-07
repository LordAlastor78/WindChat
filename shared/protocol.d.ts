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
export interface HandshakeMessage {
    type: "join";
    roomId: string;
    publicKey: string;
    displayName?: string;
}
export interface PeerJoinedMessage {
    type: "peer_joined";
    theirPublicKey: string;
    theirDisplayName?: string;
}
export interface PeerDisconnectedMessage {
    type: "peer_disconnected";
}
/**
 * Mensaje cifrado transmitido por el servidor
 * El servidor NUNCA ve el contenido de ciphertext
 */
export interface EncryptedMessage {
    type: "message";
    iv: string;
    ciphertext: string;
}
/**
 * Estructura DENTRO del ciphertext
 * Solo visible después de descifrar
 */
export interface MessagePayload {
    id?: string;
    type?: "text" | "reaction" | "file_metadata" | "file_chunk" | "file_complete";
    text: string;
    displayName?: string;
    reactionToId?: string;
    replyToId?: string;
    timestamp: number;
    fileId?: string;
    fileName?: string;
    fileSize?: number;
    fileType?: string;
    totalChunks?: number;
    chunkIndex?: number;
    chunkData?: string;
    chunksReceived?: number;
}
export interface TypingIndicator {
    type: "typing";
    isTyping: boolean;
}
export interface DisconnectMessage {
    type: "disconnect";
    reason?: string;
}
export type ClientToServerMessage = HandshakeMessage | EncryptedMessage | TypingIndicator | DisconnectMessage;
export type ServerToClientMessage = PeerJoinedMessage | PeerDisconnectedMessage | EncryptedMessage | TypingIndicator;
export declare const PROTOCOL_VERSION = "1.0.0";
export declare const IV_SIZE = 12;
export declare const KEY_SIZE = 256;
export declare const MAX_MESSAGE_SIZE: number;
export declare const MAX_USERS_PER_ROOM = 2;
export declare const MAX_FILE_SIZE: number;
export declare const FILE_CHUNK_SIZE: number;
export declare const ALLOWED_FILE_TYPES: string[];
//# sourceMappingURL=protocol.d.ts.map
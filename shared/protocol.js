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
// ===== CONSTANTS =====
export const PROTOCOL_VERSION = "1.0.0";
export const IV_SIZE = 12; // bytes
export const KEY_SIZE = 256; // bits
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_USERS_PER_ROOM = 2; // Hard limit
// File sharing constants
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const FILE_CHUNK_SIZE = 256 * 1024; // 256 KB por chunk
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
//# sourceMappingURL=protocol.js.map
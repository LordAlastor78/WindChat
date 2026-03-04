/**
 * CryptoManager - Gestor criptográfico para WindChat
 * 
 * Responsabilidades:
 * - Generar pares de claves ECDH P-256
 * - Derivar secreto compartido (ECDH)
 * - Derivar clave AES mediante HKDF
 * - Cifrar/descifrar mensajes con AES-256-GCM
 * - Conversión base64 ↔ ArrayBuffer
 * 
 * REGLAS CRÍTICAS:
 * 1. IV debe ser aleatorio SIEMPRE (de lo contrario: inseguro completamente)
 * 2. HKDF es obligatoria (nunca usar sharedSecret directamente)
 * 3. Limpiar claves al destruir
 */

import type { MessagePayload } from "../shared/protocol";
import { IV_SIZE, KEY_SIZE } from "../shared/protocol";

export interface EncryptedData {
  iv: string;
  ciphertext: string;
}

export class CryptoManager {
  private keyPair?: CryptoKeyPair;
  private sharedKey?: CryptoKey;

  /**
   * Generar par de claves ECDH P-256
   * @returns ArrayBuffer con clave pública en formato raw (para exportar)
   */
  async generateKeyPair(): Promise<ArrayBuffer> {
    try {
      this.keyPair = await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,  // extractable: permitir exportar
        ["deriveKey"]  // uso: derivar claves
      );

      const rawPublic = await window.crypto.subtle.exportKey(
        "raw",
        this.keyPair.publicKey
      );

      console.log("✅ KeyPair generado. Clave pública lista para exportar");
      return rawPublic;
    } catch (err) {
      console.error("❌ Error generando KeyPair:", err);
      throw err;
    }
  }

  /**
   * Derivar secreto compartido y clave AES
   * 
   * Flujo:
   * 1. Importar clave pública del otro usuario (raw format)
   * 2. ECDH: combinar nuestra privada + su pública = sharedSecret
   * 3. HKDF: derivar clave AES-256 a partir del sharedSecret
   * 4. Salt: hash(roomId) para contexto único
   * 5. Info: "WindChat AES-256-GCM Key" para separación
   */
  async deriveSharedKey(
    theirPublicKeyRaw: ArrayBuffer,
    roomId: string
  ): Promise<void> {
    try {
      if (!this.keyPair) {
        throw new Error("❌ KeyPair no generado. Llama generateKeyPair() primero");
      }

      // Paso 1: Importar clave pública del otro usuario
      const theirPublicKey = await window.crypto.subtle.importKey(
        "raw",
        theirPublicKeyRaw,
        { name: "ECDH", namedCurve: "P-256" },
        false,  // no extractable
        []      // sin uso específico
      );

      // Paso 2: ECDH - deriva secreto compartido
      const sharedSecret = await window.crypto.subtle.deriveKey(
        { name: "ECDH", public: theirPublicKey },
        this.keyPair.privateKey,
        { name: "HKDF" },
        false,
        ["deriveKey"]
      );

      // Paso 3: Derivar salt a partir del roomId
      const encoder = new TextEncoder();
      const saltMaterial = encoder.encode(`WindChat-v1-${roomId}`);
      const saltHash = await window.crypto.subtle.digest("SHA-256", saltMaterial);
      const salt = new Uint8Array(saltHash);

      // Paso 4: HKDF - derive AES-256 key
      this.sharedKey = await window.crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt,
          info: encoder.encode("WindChat AES-256-GCM Key")
        },
        sharedSecret,
        { name: "AES-GCM", length: KEY_SIZE },
        false,  // no extractable
        ["encrypt", "decrypt"]
      );

      console.log("✅ Secreto compartido derivado. AES-256 key lista");
    } catch (err) {
      console.error("❌ Error derivando clave compartida:", err);
      throw err;
    }
  }

  /**
   * Cifrar mensaje con AES-256-GCM
   * 
   * CRÍTICO:
   * - IV DEBE SER ALEATORIO SIEMPRE
   * - Reutilizar IV = catastrófico (rompe seguridad)
   * - Payload se serializa y se cifra COMPLETO (incluyendo timestamp)
   * - Retorna {iv, ciphertext} ambos en base64
   */
  async encrypt(plaintext: string): Promise<EncryptedData> {
    try {
      if (!this.sharedKey) {
        throw new Error("❌ Clave compartida no derivada. Llama deriveSharedKey() primero");
      }

      // Crear payload con timestamp DENTRO del cifrado
      const payload: MessagePayload = {
        text: plaintext,
        timestamp: Date.now()
      };

      // CRÍTICO: IV nuevo SIEMPRE
      const iv = window.crypto.getRandomValues(new Uint8Array(IV_SIZE));

      // Serializar y codificar payload
      const encoded = new TextEncoder().encode(JSON.stringify(payload));

      // AES-256-GCM encrypt
      const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        this.sharedKey,
        encoded
      );

      // Convertir a base64 para transmisión JSON
      const ivB64 = this.arrayBufferToBase64(iv);
      const ciphertextB64 = this.arrayBufferToBase64(ciphertextBuffer);

      console.log("✅ Mensaje cifrado");
      return { iv: ivB64, ciphertext: ciphertextB64 };
    } catch (err) {
      console.error("❌ Error cifrando:", err);
      throw err;
    }
  }

  /**
   * Descifrar mensaje con AES-256-GCM
   * 
   * Valida:
   * - Formato base64 correcto
   * - Autenticidad mediante GCM tag
   * - Retorna MessagePayload con text y timestamp
   */
  async decrypt(ivB64: string, ciphertextB64: string): Promise<MessagePayload> {
    try {
      if (!this.sharedKey) {
        throw new Error("❌ Clave compartida no derivada");
      }

      // Convertir de base64
      const iv = new Uint8Array(this.base64ToArrayBuffer(ivB64));
      const ciphertext = this.base64ToArrayBuffer(ciphertextB64);

      // AES-256-GCM decrypt
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        this.sharedKey,
        ciphertext
      );

      // Decodificar
      const decryptedText = new TextDecoder().decode(decryptedBuffer);
      const payload: MessagePayload = JSON.parse(decryptedText);

      console.log("✅ Mensaje descifrado");
      return payload;
    } catch (err) {
      console.error("❌ Error descifrando:", err);
      throw err;
    }
  }

  /**
   * Conversión ArrayBuffer → base64
   * Necesario para transmitir datos binarios en JSON
   */
  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    return btoa(String.fromCharCode(...bytes));
  }

  /**
   * Conversión base64 → ArrayBuffer
   * Necesario para recibir datos binarios de JSON
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Limpiar claves de memoria
   * Llamar al cerrar sesión
   */
  destroy(): void {
    this.keyPair = undefined;
    this.sharedKey = undefined;
    console.log("🗑️ Claves criptográficas destruidas");
  }
}

export default CryptoManager;

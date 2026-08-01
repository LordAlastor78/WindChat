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

import type { MessagePayload } from "./protocol.js";
import { IV_SIZE, KEY_SIZE } from "./protocol.js";

export interface EncryptedData {
  iv: string;
  ciphertext: string;
}

/**
 * Short Authentication String (SAS) de la sesión.
 *
 * Se deriva de AMBAS claves públicas + roomId, por lo que un servidor que
 * intente un doble handshake (MITM) producirá SAS distintos en cada lado.
 * Los usuarios DEBEN compararlo por un canal fuera de banda.
 */
export interface SafetyNumber {
  /** 6 grupos de 5 dígitos, estilo Signal safety number */
  digits: string;
  /** 5 emojis para comparación visual rápida */
  emojis: string[];
  /** Primeros 8 bytes en hex, agrupados */
  hex: string;
}

/**
 * Alfabeto de 64 emojis para el SAS visual.
 * Elegidos por ser visualmente distintos entre sí (evita confusiones).
 */
const SAS_EMOJI: readonly string[] = [
  "🐶", "🐱", "🦁", "🐴", "🦄", "🐮", "🐷", "🐸",
  "🐵", "🐔", "🐧", "🦉", "🦋", "🐢", "🐬", "🐳",
  "🦀", "🐝", "🌵", "🌲", "🍄", "🌻", "🍎", "🍌",
  "🍇", "🍉", "🍒", "🥕", "🌽", "🍕", "🍔", "🍿",
  "🎂", "☕", "🍺", "⚽", "🏀", "🎾", "🏆", "🎸",
  "🎺", "🎨", "🎤", "🎧", "🔔", "🎯", "🎲", "🚗",
  "🚂", "✈️", "🚀", "⚓", "🏠", "⌛", "💡", "📷",
  "🔑", "🔒", "🔨", "⚙️", "💎", "🌙", "⭐", "🔥",
];

export class CryptoManager {
  private keyPair?: CryptoKeyPair;
  private sharedKey?: CryptoKey;
  private myPublicKeyRaw?: Uint8Array;
  private safetyNumber?: SafetyNumber;

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

      // Guardar nuestra clave pública para poder derivar el SAS después
      this.myPublicKeyRaw = new Uint8Array(rawPublic.slice(0));

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

      // Derivar el SAS (safety number) a partir de AMBAS claves públicas.
      // Esto es lo que permite detectar un MITM del servidor.
      await this.computeSafetyNumber(new Uint8Array(theirPublicKeyRaw), roomId);
    } catch (err) {
      console.error("❌ Error derivando clave compartida:", err);
      throw err;
    }
  }

  /**
   * Calcular el Short Authentication String de la sesión.
   *
   * Las claves se ordenan lexicográficamente ANTES de hashear para que
   * ambos extremos obtengan el mismo resultado sin negociar roles.
   *
   * Si un servidor malicioso hace doble handshake (una clave suya con cada
   * cliente), cada extremo verá un SAS diferente → los usuarios lo detectan
   * comparándolo por un canal fuera de banda (voz, presencial, Signal...).
   */
  private async computeSafetyNumber(
    theirPublicKeyRaw: Uint8Array,
    roomId: string
  ): Promise<void> {
    if (!this.myPublicKeyRaw) {
      throw new Error("❌ No hay clave pública propia para derivar el SAS");
    }

    const mine = this.myPublicKeyRaw;
    const theirs = theirPublicKeyRaw;

    // Orden canónico: comparación byte a byte para que ambos lados coincidan
    const mineFirst = CryptoManager.compareBytes(mine, theirs) <= 0;
    const first = mineFirst ? mine : theirs;
    const second = mineFirst ? theirs : mine;

    const context = new TextEncoder().encode(`WindChat-SAS-v1|${roomId}|`);
    const material = new Uint8Array(context.length + first.length + second.length);
    material.set(context, 0);
    material.set(first, context.length);
    material.set(second, context.length + first.length);

    const digest = await window.crypto.subtle.digest("SHA-256", material);
    const bytes = new Uint8Array(digest);

    this.safetyNumber = {
      digits: CryptoManager.bytesToDigitGroups(bytes),
      emojis: CryptoManager.bytesToEmojis(bytes),
      hex: CryptoManager.bytesToHexGroups(bytes),
    };

    console.log("🔐 Safety number de sesión calculado");
  }

  /**
   * Obtener el safety number de la sesión activa.
   * Devuelve undefined si aún no hay peer / clave derivada.
   */
  getSafetyNumber(): SafetyNumber | undefined {
    return this.safetyNumber;
  }

  /** Comparación lexicográfica de dos arrays de bytes */
  private static compareBytes(a: Uint8Array, b: Uint8Array): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  }

  /**
   * 6 grupos de 5 dígitos (estilo Signal).
   * Cada grupo consume 3 bytes → módulo 100000.
   */
  private static bytesToDigitGroups(bytes: Uint8Array): string {
    const groups: string[] = [];
    for (let i = 0; i < 6; i++) {
      const offset = i * 3;
      const value =
        (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
      groups.push(String(value % 100000).padStart(5, "0"));
    }
    return groups.join(" ");
  }

  /** 5 emojis, 6 bits de entropía cada uno tomados de bytes distintos */
  private static bytesToEmojis(bytes: Uint8Array): string[] {
    const out: string[] = [];
    for (let i = 0; i < 5; i++) {
      out.push(SAS_EMOJI[bytes[18 + i] % SAS_EMOJI.length]);
    }
    return out;
  }

  /** Primeros 8 bytes en hex, en grupos de 4 caracteres */
  private static bytesToHexGroups(bytes: Uint8Array): string {
    const hex = Array.from(bytes.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return (hex.match(/.{1,4}/g) || []).join(" ");
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
  async encrypt(plaintextOrPayload: string | Partial<MessagePayload>): Promise<EncryptedData> {
    try {
      if (!this.sharedKey) {
        throw new Error("❌ Clave compartida no derivada. Llama deriveSharedKey() primero");
      }

      // Crear payload con timestamp DENTRO del cifrado
      const payload: MessagePayload =
        typeof plaintextOrPayload === "string"
          ? {
            id: crypto.randomUUID(),
            type: "text",
            text: plaintextOrPayload,
            timestamp: Date.now(),
          }
          : {
            id: plaintextOrPayload.id || crypto.randomUUID(),
            type: plaintextOrPayload.type || "text",
            text: plaintextOrPayload.text || "",
            displayName: plaintextOrPayload.displayName,
            reactionToId: plaintextOrPayload.reactionToId,
            replyToId: plaintextOrPayload.replyToId,
            receiptForId: plaintextOrPayload.receiptForId,
            receiptState: plaintextOrPayload.receiptState,
            fileId: plaintextOrPayload.fileId,
            fileName: plaintextOrPayload.fileName,
            fileSize: plaintextOrPayload.fileSize,
            fileType: plaintextOrPayload.fileType,
            totalChunks: plaintextOrPayload.totalChunks,
            chunkIndex: plaintextOrPayload.chunkIndex,
            chunkData: plaintextOrPayload.chunkData,
            chunksReceived: plaintextOrPayload.chunksReceived,
            timestamp: plaintextOrPayload.timestamp || Date.now(),
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
      const rawPayload = JSON.parse(decryptedText) as MessagePayload;
      const payload: MessagePayload = {
        id: rawPayload.id,
        type: rawPayload.type || "text",
        text: rawPayload.text,
        displayName: rawPayload.displayName,
        reactionToId: rawPayload.reactionToId,
        replyToId: rawPayload.replyToId,
        receiptForId: rawPayload.receiptForId,
        receiptState: rawPayload.receiptState,
        fileId: rawPayload.fileId,
        fileName: rawPayload.fileName,
        fileSize: rawPayload.fileSize,
        fileType: rawPayload.fileType,
        totalChunks: rawPayload.totalChunks,
        chunkIndex: rawPayload.chunkIndex,
        chunkData: rawPayload.chunkData,
        chunksReceived: rawPayload.chunksReceived,
        timestamp: rawPayload.timestamp,
      };

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
    this.myPublicKeyRaw = undefined;
    this.safetyNumber = undefined;
    console.log("🗑️ Claves criptográficas destruidas");
  }
}

export default CryptoManager;

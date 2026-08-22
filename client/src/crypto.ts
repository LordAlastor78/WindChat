/**
 * CryptoManager - Gestor criptográfico para WindChat
 *
 * Responsabilidades:
 * - Generar pares de claves ECDH P-256
 * - Derivar secreto compartido (ECDH)
 * - Derivar el root del ratchet mediante HKDF
 * - Ratchet simétrico: clave AES de un solo uso por mensaje (forward secrecy)
 * - Cifrar/descifrar mensajes con AES-256-GCM
 * - Conversión base64 ↔ ArrayBuffer
 *
 * REGLAS CRÍTICAS:
 * 1. IV debe ser aleatorio SIEMPRE (de lo contrario: inseguro completamente)
 * 2. HKDF es obligatoria (nunca usar sharedSecret directamente)
 * 3. Cada mensaje usa una clave distinta y la anterior se borra (fill(0))
 * 4. El contador del ratchet va autenticado como AAD
 * 5. Limpiar claves al destruir
 */

import type { MessagePayload } from "./protocol.js";
import { IV_SIZE, KEY_SIZE, MAX_RATCHET_SKIP } from "./protocol.js";

export interface EncryptedData {
  iv: string;
  ciphertext: string;
  /** Índice del mensaje en la cadena del ratchet (necesario para descifrar) */
  counter: number;
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

// ===== RATCHET (forward secrecy por mensaje) =====

/**
 * Máximo de claves de mensaje que se guardan cuando llegan mensajes
 * fuera de orden. Evita que un peer malicioso nos haga derivar millones
 * de claves mandando un contador enorme (DoS de CPU/memoria).
 */
const MAX_SKIPPED_KEYS = MAX_RATCHET_SKIP;

/** Etiquetas HMAC para separar la clave de mensaje del avance de cadena */
const MSG_KEY_LABEL = new Uint8Array([0x01]);
const CHAIN_KEY_LABEL = new Uint8Array([0x02]);

/** Estado de una cadena de ratchet (una por dirección) */
interface ChainState {
  /** Clave de cadena actual, 32 bytes. Se sobrescribe en cada avance. */
  key: Uint8Array<ArrayBuffer>;
  /** Índice del próximo mensaje de esta cadena */
  counter: number;
}

export class CryptoManager {
  private keyPair?: CryptoKeyPair;
  private myPublicKeyRaw?: Uint8Array;
  private safetyNumber?: SafetyNumber;

  // §H4.2 FIX: flag que indica que ya hubo una negociación (KeyPair generado +
  // claves derivadas al menos una vez). `isReady()` verifica sendChain/recvChain,
  // que pueden estar undefined tras un error transitorio (p.ej. ratchet skip
  // demasiado grande) → falsos negativos que disparaban destroy() + recreación
  // de CryptoManager en handleReconnection → counter 0 → desincronización.
  private initialized = false;

  /** Cadena de envío: sólo yo derivo estas claves */
  private sendChain?: ChainState;
  /** Cadena de recepción: refleja la cadena de envío del peer */
  private recvChain?: ChainState;

  /**
   * Claves de mensajes que aún no han llegado (out-of-order).
   * Clave del mapa: índice del mensaje. Se borran al usarse.
   */
  private skippedKeys = new Map<number, Uint8Array<ArrayBuffer>>();

  /** Mutex secuencial para serializar operaciones de cifrado y evitar condiciones de carrera */
  private encryptLock: Promise<void> = Promise.resolve();
  /** Mutex secuencial para serializar operaciones de descifrado y evitar condiciones de carrera */
  private decryptLock: Promise<void> = Promise.resolve();

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
        ["deriveKey", "deriveBits"]
      );

      // Paso 3: Derivar salt a partir del roomId
      const encoder = new TextEncoder();
      const saltMaterial = encoder.encode(`WindChat-v1-${roomId}`);
      const saltHash = await window.crypto.subtle.digest("SHA-256", saltMaterial);
      const salt = new Uint8Array(saltHash);

      // Paso 4: HKDF - derivar el ROOT SECRET (no una clave AES directa).
      // De aquí salen las dos cadenas del ratchet.
      const rootBits = await window.crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt,
          info: encoder.encode("WindChat Ratchet Root v1")
        },
        sharedSecret,
        512 // 2 x 32 bytes: una cadena por dirección
      );

      const root = new Uint8Array(rootBits);
      // .slice() en TS 5.7 devuelve Uint8Array<ArrayBufferLike>; las Web
      // Crypto APIs exigen Uint8Array<ArrayBuffer>, así que copiamos a un
      // buffer propio (no compartido).
      const chainA = new Uint8Array(root.slice(0, 32));
      const chainB = new Uint8Array(root.slice(32, 64));

      // Cada lado necesita usar como cadena de ENVÍO la que el otro usa
      // como cadena de RECEPCIÓN. Se resuelve con el mismo orden canónico
      // que el SAS: quien tiene la clave pública "menor" envía por chainA.
      const mine = this.myPublicKeyRaw;
      if (!mine) {
        throw new Error("❌ No hay clave pública propia para inicializar el ratchet");
      }
      const theirs = new Uint8Array(theirPublicKeyRaw);
      const iAmFirst = CryptoManager.compareBytes(mine, theirs) <= 0;

      this.sendChain = { key: iAmFirst ? chainA : chainB, counter: 0 };
      this.recvChain = { key: iAmFirst ? chainB : chainA, counter: 0 };
      this.skippedKeys.clear();

      console.log("✅ Secreto compartido derivado. Ratchet inicializado");

      // Derivar el SAS (safety number) a partir de AMBAS claves públicas.
      // Esto es lo que permite detectar un MITM del servidor.
      await this.computeSafetyNumber(new Uint8Array(theirPublicKeyRaw), roomId);

      // §H4.2 FIX: marcar que la negociación ECDH+HKDF+SAS completó trun time.
      // Este flag persiste aunque sendChain/recvChain se reinicien tras un error
      // transitorio, evitando recrear el CryptoManager en handleReconnection.
      this.initialized = true;
    } catch (err) {
      console.error("❌ Error derivando clave compartida:", err);
      throw err;
    }
  }

  // ===== RATCHET =====

  /**
   * HMAC-SHA256 sobre una etiqueta de un byte.
   * Es la primitiva del ratchet simétrico: de una chain key salen dos
   * valores independientes (clave de mensaje y siguiente chain key) que
   * no permiten recuperar la chain key anterior.
   */
  private static async hmacStep(
    chainKey: Uint8Array<ArrayBuffer>,
    label: Uint8Array<ArrayBuffer>
  ): Promise<Uint8Array<ArrayBuffer>> {
    const key = await window.crypto.subtle.importKey(
      "raw",
      chainKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await window.crypto.subtle.sign("HMAC", key, label);
    return new Uint8Array(sig);
  }

  /**
   * Avanzar una cadena un paso.
   *
   * messageKey = HMAC(chainKey, 0x01)
   * nextChain  = HMAC(chainKey, 0x02)
   *
   * La chain key anterior se sobrescribe con ceros: por eso hay forward
   * secrecy. Quien capture el estado actual NO puede derivar hacia atrás,
   * porque HMAC-SHA256 no es invertible.
   */
  private static async advanceChain(
    chain: ChainState
  ): Promise<Uint8Array<ArrayBuffer>> {
    const messageKey = await CryptoManager.hmacStep(chain.key, MSG_KEY_LABEL);
    const nextChainKey = await CryptoManager.hmacStep(chain.key, CHAIN_KEY_LABEL);

    // Borrar la clave de cadena anterior de memoria
    chain.key.fill(0);

    chain.key = nextChainKey;
    chain.counter += 1;

    return messageKey;
  }

  /** Importar una clave de mensaje de 32 bytes como AES-256-GCM */
  private static async importMessageKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: KEY_SIZE },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Obtener la clave para descifrar el mensaje número `counter`.
   *
   * - Si ya pasó (llegó tarde), se busca entre las claves guardadas.
   * - Si es el siguiente, se avanza la cadena un paso.
   * - Si viene del futuro (se perdieron mensajes), se avanzan y guardan
   *   las claves intermedias hasta MAX_SKIPPED_KEYS.
   */
  private async messageKeyForCounter(counter: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.recvChain) {
      throw new Error("❌ Ratchet no inicializado");
    }

    // Mensaje retrasado: la clave debería estar guardada
    if (counter < this.recvChain.counter) {
      const saved = this.skippedKeys.get(counter);
      if (!saved) {
        throw new Error(
          `❌ Clave de mensaje ${counter} no disponible (ya usada o descartada)`
        );
      }
      this.skippedKeys.delete(counter);
      return saved;
    }

    const gap = counter - this.recvChain.counter;
    if (gap > MAX_SKIPPED_KEYS) {
      throw new Error(
        `❌ Salto de ratchet demasiado grande (${gap} > ${MAX_SKIPPED_KEYS})`
      );
    }

    // Avanzar guardando las claves de los mensajes que aún no llegaron
    while (this.recvChain.counter < counter) {
      const idx = this.recvChain.counter;
      const skipped = await CryptoManager.advanceChain(this.recvChain);
      this.skippedKeys.set(idx, skipped);
    }

    // Podar por si acaso (no debería crecer más que MAX_SKIPPED_KEYS)
    while (this.skippedKeys.size > MAX_SKIPPED_KEYS) {
      const oldest = this.skippedKeys.keys().next().value;
      if (oldest === undefined) break;
      const k = this.skippedKeys.get(oldest);
      k?.fill(0);
      this.skippedKeys.delete(oldest);
    }

    // Ahora sí: la clave del mensaje pedido
    return CryptoManager.advanceChain(this.recvChain);
  }

  /** Número de mensajes ya recibidos/descifrados en esta sesión */
  getRecvCounter(): number {
    return this.recvChain?.counter ?? 0;
  }

  /** Número de mensajes ya enviados en esta sesión */
  getSendCounter(): number {
    return this.sendChain?.counter ?? 0;
  }

  /** Número de claves guardadas por mensajes fuera de orden */
  getSkippedKeyCount(): number {
    return this.skippedKeys.size;
  }

  /** ¿Está el ratchet listo para cifrar/descifrar? */
  isReady(): boolean {
    return this.sendChain !== undefined && this.recvChain !== undefined;
  }

  /**
   * §H4.2 FIX: indica si hubo una negociación completa (ECDH + HKDF + SAS).
   * A diferencia de isReady(), este flag persiste aunque sendChain/recvChain
   * se reinicien tras un error transitorio → evita recrear el CryptoManager
   * en handleReconnection (que destruiría el ratchet → counter 0 → desincronización).
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Clave pública raw (Uint8Array) para reusarla en reconexiones de transporte
   * sin regenerar el par ECDH (preservando así el ratchet ya negociado).
   * undefined si aún no se generó el par.
   */
  getPublicKeyRaw(): Uint8Array | undefined {
    return this.myPublicKeyRaw;
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
    const prev = this.encryptLock;
    let release: () => void = () => {};
    this.encryptLock = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    try {
      return await this.encryptInternal(plaintextOrPayload);
    } finally {
      release();
    }
  }

  private async encryptInternal(plaintextOrPayload: string | Partial<MessagePayload>): Promise<EncryptedData> {
    try {
      if (!this.sendChain) {
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

      // Ratchet: clave de un solo uso para ESTE mensaje.
      // El índice se toma antes de avanzar la cadena.
      const counter = this.sendChain.counter;
      const messageKeyRaw = await CryptoManager.advanceChain(this.sendChain);
      const messageKey = await CryptoManager.importMessageKey(messageKeyRaw);
      messageKeyRaw.fill(0); // ya está importada, borrar el material crudo

      // El contador viaja en claro, así que se autentica como AAD:
      // manipularlo invalida el tag de GCM.
      const aad = new TextEncoder().encode(String(counter));

      // AES-256-GCM encrypt
      const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        messageKey,
        encoded
      );

      // Convertir a base64 para transmisión JSON
      const ivB64 = this.arrayBufferToBase64(iv);
      const ciphertextB64 = this.arrayBufferToBase64(ciphertextBuffer);

      console.log(`✅ Mensaje cifrado (ratchet #${counter})`);
      return { iv: ivB64, ciphertext: ciphertextB64, counter };
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
  async decrypt(ivB64: string, ciphertextB64: string, counter = 0): Promise<MessagePayload> {
    const prev = this.decryptLock;
    let release: () => void = () => {};
    this.decryptLock = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    try {
      return await this.decryptInternal(ivB64, ciphertextB64, counter);
    } finally {
      release();
    }
  }

  private async decryptInternal(ivB64: string, ciphertextB64: string, counter = 0): Promise<MessagePayload> {
    try {
      if (!this.recvChain) {
        throw new Error("❌ Clave compartida no derivada");
      }

      if (!Number.isInteger(counter) || counter < 0) {
        throw new Error(`❌ Contador de ratchet inválido: ${counter}`);
      }

      // Convertir de base64
      const iv = new Uint8Array(this.base64ToArrayBuffer(ivB64));
      const ciphertext = this.base64ToArrayBuffer(ciphertextB64);

      // Ratchet: recuperar/derivar la clave de un solo uso de este mensaje
      const messageKeyRaw = await this.messageKeyForCounter(counter);
      const messageKey = await CryptoManager.importMessageKey(messageKeyRaw);
      messageKeyRaw.fill(0);

      const aad = new TextEncoder().encode(String(counter));

      // AES-256-GCM decrypt
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        messageKey,
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
    // FIX §4.6: usar bucle `for` en vez de `btoa(String.fromCharCode(...bytes))`
    // para evitar stack overflow (límite V8 ~50MB) en datos grandes.
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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
    this.myPublicKeyRaw = undefined;
    this.safetyNumber = undefined;
    // §H4.2 FIX: resetear el flag de negociación — un CryptoManager destruido
    // debe volver a hacer keygen+derive antes de que isInitialized() sea true.
    this.initialized = false;

    // Sobrescribir el material del ratchet antes de soltarlo
    this.sendChain?.key.fill(0);
    this.recvChain?.key.fill(0);
    this.sendChain = undefined;
    this.recvChain = undefined;

    this.skippedKeys.forEach((k) => k.fill(0));
    this.skippedKeys.clear();

    this.encryptLock = Promise.resolve();
    this.decryptLock = Promise.resolve();

    console.log("🗑️ Claves criptográficas destruidas");
  }
}

export default CryptoManager;

/**
 * ChatClient - Cliente WebSocket para WindChat
 *
 * Responsabilidades:
 * - Conectar a servidor WebSocket
 * - Enviar handshake con clave pública
 * - Recibir clave pública del peer
 * - Integrar CryptoManager para cifrado
 * - Enviar/recibir mensajes cifrados
 * - Callbacks para eventos
 */

import CryptoManager from "./crypto";
import type {
  ClientToServerMessage,
  MessagePayload,
  ServerToClientMessage,
} from "./protocol.js";
import { MAX_MESSAGE_SIZE } from "./protocol.js";

export interface ChatClientCallbacks {
  onPeerJoined?: () => void;
  onPeerDisconnected?: () => void;
  onMessageReceived?: (payload: MessagePayload) => void;
  onTyping?: (isTyping: boolean) => void;
  onError?: (error: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onReconnected?: () => void;
  onReconnectFailed?: () => void;
  onServerStatus?: (level: "ok" | "degraded" | "alert", message?: string) => void;
}

export class ChatClient {
  private ws?: WebSocket;
  private crypto = new CryptoManager();
  private roomId?: string;
  private serverUrl?: string;
  private callbacks: ChatClientCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isReconnecting = false;
  private shouldReconnect = true;
  private publicKeyB64?: string;
  private displayName = "Anon";

  constructor(callbacks?: ChatClientCallbacks) {
    this.callbacks = callbacks || {};
  }

  onMessage(callback: (payload: MessagePayload) => void): void {
    this.callbacks.onMessageReceived = callback;
  }

  setDisplayName(name: string): void {
    const normalized = name.trim();
    this.displayName = normalized.length > 0 ? normalized.slice(0, 24) : "Anon";
  }

  /**
   * Conectar a servidor y realizar handshake
   */
  async connect(serverUrl: string, roomId: string): Promise<void> {
    try {
      this.roomId = roomId;
      this.serverUrl = serverUrl;
      this.shouldReconnect = true;

      console.log(`🔗 Conectando a ${serverUrl} (room: ${roomId})`);

      // Generar par de claves
      const publicKeyRaw = await this.crypto.generateKeyPair();
      this.publicKeyB64 = this.arrayBufferToBase64(publicKeyRaw);

      // Conectar WebSocket (normalizar protocolo para wss en entornos HTTPS)
      const wsUrl = this.normalizeWebSocketUrl(serverUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("✅ WebSocket conectado");
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        // Enviar handshake
        const handshake: ClientToServerMessage = {
          type: "join",
          roomId,
          publicKey: this.publicKeyB64!,
          displayName: this.displayName,
        };

        this.ws!.send(JSON.stringify(handshake));
        console.log("📤 Handshake enviado");

        if (this.callbacks.onConnected) {
          this.callbacks.onConnected();
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event: Event) => {
        console.error("❌ WebSocket error:", event);
        if (this.callbacks.onError) {
          this.callbacks.onError("WebSocket error");
        }
      };

      this.ws.onclose = (event) => {
        console.log(`👋 WebSocket cerrado (code: ${event.code}, reason: ${event.reason || 'none'})`);

        // Solo omitir reconexión cuando fue una desconexión explícita del cliente
        if (!this.shouldReconnect) {
          console.log("Desconexión intencional, no se reconectará");
          this.crypto.destroy();
          if (this.callbacks.onDisconnected) {
            this.callbacks.onDisconnected();
          }
          return;
        }

        // Si ya estamos reconectando, no iniciar otro intento
        if (this.isReconnecting) {
          return;
        }

        // Intentar reconexión automática
        console.log("⚠️ Conexión perdida, intentando reconectar...");
        if (this.callbacks.onDisconnected) {
          this.callbacks.onDisconnected();
        }
        this.handleReconnection();
      };
    } catch (err) {
      console.error("❌ Error conectando:", err);
      if (this.callbacks.onError) {
        this.callbacks.onError(
          err instanceof Error ? err.message : "Connection failed"
        );
      }
      throw err;
    }
  }

  /**
   * Normalize a server URL to a websocket URL.
   * - If given an http(s) URL, convert to ws(s)
   * - If given ws(s) URL, ensure it matches current page protocol (upgrade to wss on https)
   * - If relative path, build absolute ws/wss URL from window.location
   */
  private normalizeWebSocketUrl(url: string): string {
    try {
      // If it's an absolute HTTP/HTTPS URL
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url.replace(/^http/, 'ws');
      }

      // If already ws:// or wss://
      if (url.startsWith('ws://') || url.startsWith('wss://')) {
        // Upgrade to wss if page is served over HTTPS
        if (window.location.protocol === 'https:' && url.startsWith('ws://')) {
          return url.replace(/^ws:/, 'wss:');
        }
        return url;
      }

      // Relative path (e.g. '/ws' or '/'), build full URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      // Ensure leading slash
      const path = url.startsWith('/') ? url : `/${url}`;
      return `${protocol}//${host}${path}`;
    } catch (err) {
      // Fallback: attempt simple ws replacement
      if (window.location.protocol === 'https:') {
        if (url.startsWith('ws://')) return url.replace(/^ws:/, 'wss:');
        return `wss://${window.location.host}${url.startsWith('/') ? url : `/${url}`}`;
      }
      if (url.startsWith('wss://')) return url.replace(/^wss:/, 'ws:');
      return `ws://${window.location.host}${url.startsWith('/') ? url : `/${url}`}`;
    }
  }

  /**
   * Procesar mensajes del servidor
   */
  private async handleMessage(data: string) {
    try {
      // CRÍTICO: Validar tamaño ANTES de parsear (evitar DoS con mensajes gigantes)
      const sizeInBytes = new TextEncoder().encode(data).length;
      if (sizeInBytes > MAX_MESSAGE_SIZE * 2) { // x2 por overhead de base64 + JSON
        throw new Error(`Message too large: ${sizeInBytes} bytes (max: ${MAX_MESSAGE_SIZE * 2})`);
      }

      const parsed = JSON.parse(data) as unknown;
      if (!this.isValidServerMessage(parsed)) {
        throw new Error("Invalid server message format");
      }

      // @ts-ignore - Manejo de tipo "pong" que fue agregado
      const msg = parsed as (ServerToClientMessage | { type: "pong" });

      // ✅ Type guard explícito para TypeScript
      if (msg.type === "peer_joined") {
        await this.handlePeerJoined(msg);
      } else if (msg.type === "peer_disconnected") {
        if (this.callbacks.onPeerDisconnected) {
          this.callbacks.onPeerDisconnected();
        }
      } else if (msg.type === "message") {
        await this.handleEncryptedMessage(msg);
      } else if (msg.type === "typing") {
        if (this.callbacks.onTyping) {
          this.callbacks.onTyping(msg.isTyping);
        }
      } else if ((msg as any).type === "server_status") {
        // notify UI about server health (cast because ServerToClientMessage union doesn't include server_status)
        const s = msg as any;
        if (this.callbacks.onServerStatus) {
          this.callbacks.onServerStatus(s.level, s.message);
        }
      } else if (msg.type === "pong") {
        console.log("💓 Pong recibido, conexión activa");
      }
    } catch (err) {
      console.error("❌ Error procesando mensaje:", err);
      if (this.callbacks.onError && err instanceof Error) {
        this.callbacks.onError(err.message);
      }
    }
  }

  private isValidServerMessage(message: unknown): message is ServerToClientMessage {
    if (!message || typeof message !== "object") return false;

    const msg = message as Record<string, unknown>;
    if (typeof msg.type !== "string") return false;

    switch (msg.type) {
      case "peer_joined":
        return (
          typeof msg.theirPublicKey === "string" &&
          this.isValidBase64(msg.theirPublicKey) &&
          (typeof msg.theirDisplayName === "undefined" || typeof msg.theirDisplayName === "string")
        );
      case "peer_disconnected":
        return true;
      case "message":
        return (
          typeof msg.iv === "string" &&
          typeof msg.ciphertext === "string" &&
          this.isValidBase64(msg.iv) &&
          this.isValidBase64(msg.ciphertext)
        );
      case "typing":
        return typeof msg.isTyping === "boolean";
      // ✅ NUEVA: Validar pong
      case "pong":
        return true;
      case "server_status":
        return typeof msg.level === 'string' && ['ok', 'degraded', 'alert'].includes(msg.level);
      default:
        return false;
    }
  }

  private isValidBase64(value: string): boolean {
    if (value.length === 0 || value.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  /**
   * Cuando el peer se une: recibir su clave pública
   * y derivar secreto compartido
   */
  private async handlePeerJoined(msg: any) {
    try {
      if (!msg.theirPublicKey) {
        throw new Error("No public key from peer");
      }

      console.log("👥 Peer se unió");

      // Convertir clave pública del peer de base64
      const theirPublicKeyRaw = this.base64ToArrayBuffer(msg.theirPublicKey);

      // CRÍTICO: Validar tamaño de clave P-256 (debe ser exactamente 65 bytes)
      // Formato: 0x04 (1 byte) + X coordinate (32 bytes) + Y coordinate (32 bytes)
      if (theirPublicKeyRaw.byteLength !== 65) {
        throw new Error(
          `Invalid P-256 public key size: expected 65 bytes, got ${theirPublicKeyRaw.byteLength}`
        );
      }

      // Verificar que comienza con 0x04 (uncompressed point format)
      const firstByte = new Uint8Array(theirPublicKeyRaw)[0];
      if (firstByte !== 0x04) {
        throw new Error(
          `Invalid P-256 public key format: expected uncompressed (0x04), got 0x${firstByte.toString(16)}`
        );
      }

      // Derivar secreto compartido
      if (!this.roomId) throw new Error("No roomId");
      await this.crypto.deriveSharedKey(theirPublicKeyRaw, this.roomId);

      console.log("✅ Secreto compartido derivado");

      if (this.callbacks.onPeerJoined) {
        this.callbacks.onPeerJoined();
      }
    } catch (err) {
      console.error("❌ Error con peer join:", err);
      if (this.callbacks.onError) {
        this.callbacks.onError(
          err instanceof Error ? err.message : "Peer join failed"
        );
      }
    }
  }

  /**
   * Recibir mensaje cifrado, descifrar y callback
   */
  private async handleEncryptedMessage(msg: any) {
    try {
      const payload = await this.crypto.decrypt(msg.iv, msg.ciphertext);

      console.log("📥 Mensaje cifrado recibido y descifrado", {
        id: payload.id,
        type: payload.type,
        from: payload.displayName || "Peer",
      });

      if (payload.type === "text" && payload.id) {
        void this.sendReceipt(payload.id, "delivered").catch((err) => {
          console.warn("⚠️ No se pudo enviar el acuse delivered:", err);
        });
      }

      if (this.callbacks.onMessageReceived) {
        this.callbacks.onMessageReceived(payload);
      }
    } catch (err) {
      console.error("❌ Error descifrando:", err);
      if (this.callbacks.onError) {
        this.callbacks.onError(err instanceof Error ? err.message : "Decrypt failed");
      }
    }
  }

  /**
   * Enviar mensaje de texto
   * Cifra automáticamente antes de enviar
   */
  async sendMessage(
    text: string,
    messageId?: string,
    replyToId?: string
  ): Promise<void> {
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
      }

      const normalized = text.trim();
      if (!normalized) {
        throw new Error("Empty message is not allowed");
      }

      const sizeInBytes = new TextEncoder().encode(normalized).length;
      if (sizeInBytes > MAX_MESSAGE_SIZE) {
        throw new Error("Message exceeds maximum allowed size");
      }

      // Cifrar payload enriquecido con displayName
      const encrypted = await this.crypto.encrypt({
        id: messageId,
        type: "text",
        text: normalized,
        displayName: this.displayName,
        replyToId,
      });

      // Enviar
      const msg: ClientToServerMessage = {
        type: "message",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      };

      this.ws.send(JSON.stringify(msg));
      console.log("📤 Mensaje cifrado enviado", {
        id: messageId,
        replyToId,
        bytes: sizeInBytes,
      });
    } catch (err) {
      console.error("❌ Error enviando:", err);
      if (this.callbacks.onError) {
        this.callbacks.onError(err instanceof Error ? err.message : "Send failed");
      }
      throw err;
    }
  }

  /**
   * Enviar reacción como evento real cifrado
   */
  async sendReaction(emoji: string, reactionToId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const encrypted = await this.crypto.encrypt({
      type: "reaction",
      text: emoji,
      displayName: this.displayName,
      reactionToId,
    });

    const msg: ClientToServerMessage = {
      type: "message",
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    };

    this.ws.send(JSON.stringify(msg));
    console.log("📤 Reacción cifrada enviada", { reactionToId, emoji });
  }

  /**
   * Enviar acuse cifrado para actualizar estado del mensaje original.
   */
  async sendReceipt(messageId: string, receiptState: "delivered" | "read"): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    if (!messageId.trim()) {
      throw new Error("Message id is required for receipts");
    }

    const encrypted = await this.crypto.encrypt({
      type: "receipt",
      text: "",
      displayName: this.displayName,
      receiptForId: messageId,
      receiptState,
    });

    const msg: ClientToServerMessage = {
      type: "message",
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    };

    this.ws.send(JSON.stringify(msg));
    console.log(`📨 Acuse ${receiptState} enviado para mensaje ${messageId}`);
  }

  /**
   * Enviar payload de archivo (metadata o chunk)
   */
  async sendFilePayload(payload: MessagePayload): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    try {
      // Cifrar el payload completo del archivo
      const encrypted = await this.crypto.encrypt({
        ...payload,
        displayName: this.displayName,
      });

      const msg: ClientToServerMessage = {
        type: "message",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      };

      this.ws.send(JSON.stringify(msg));
      console.log(`📤 Payload de archivo enviado (type: ${payload.type})`);
    } catch (err) {
      console.error("❌ Error enviando payload de archivo:", err);
      throw err;
    }
  }

  /**
   * Indicador de escritura
   */
  sendTyping(isTyping: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: ClientToServerMessage = {
      type: "typing",
      isTyping,
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Desconectar intencionalmente (sin reconexión)
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close(1000, "User disconnect");
    }
    this.crypto.destroy();
  }

  /**
   * Verificar si el WebSocket está conectado
   */
  isConnected(): boolean {
    return this.ws !== undefined && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Reconexión automática con backoff exponencial
   * CRÍTICO: Regenera claves antes de reconectar
   */
  private async handleReconnection(): Promise<void> {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;

    while (this.reconnectAttempts < this.maxReconnectAttempts && this.shouldReconnect) {
      this.reconnectAttempts++;

      console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      // Notificar a la UI
      if (this.callbacks.onReconnecting) {
        this.callbacks.onReconnecting(this.reconnectAttempts, this.maxReconnectAttempts);
      }

      // 1. CRÍTICO: Destruir claves antiguas
      this.crypto.destroy();
      this.crypto = new CryptoManager();

      // 2. Backoff exponencial: 1s, 2s, 4s, 8s, 16s
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
      console.log(`⏳ Esperando ${delay}ms antes de reconectar...`);
      await this.sleep(delay);

      if (!this.shouldReconnect) {
        console.log("⚠️ Reconexión cancelada por usuario");
        break;
      }

      // 3. Generar NUEVAS claves ECDH
      try {
        const publicKeyRaw = await this.crypto.generateKeyPair();
        this.publicKeyB64 = this.arrayBufferToBase64(publicKeyRaw);
        console.log("✅ Nuevas claves generadas");
      } catch (err) {
        console.error("❌ Error generando nuevas claves:", err);
        continue;
      }

      // 4. Reconectar WebSocket
      try {
        if (!this.serverUrl || !this.roomId) {
          throw new Error("Missing serverUrl or roomId");
        }

        console.log(`🔗 Reconectando a ${this.serverUrl}...`);
        // Use normalized URL to match initial connect behavior (ws/wss)
        const wsUrl = this.normalizeWebSocketUrl(this.serverUrl!);
        this.ws = new WebSocket(wsUrl);

        // Esperar a que se conecte
        const connected = await this.waitForConnection(this.ws);

        if (connected) {
          // 5. Re-hacer handshake completo
          console.log("✅ Reconectado. Enviando nuevo handshake...");

          const handshake: ClientToServerMessage = {
            type: "join",
            roomId: this.roomId,
            publicKey: this.publicKeyB64,
            displayName: this.displayName,
          };

          this.ws.send(JSON.stringify(handshake));

          // Re-configurar handlers
          this.setupHandlers();

          // Notificar éxito
          if (this.callbacks.onReconnected) {
            this.callbacks.onReconnected();
          }
          if (this.callbacks.onConnected) {
            this.callbacks.onConnected();
          }

          this.isReconnecting = false;
          this.reconnectAttempts = 0;
          return;
        }
      } catch (err) {
        console.error(`❌ Intento ${this.reconnectAttempts} falló:`, err);
      }
    }

    // Si llegamos aquí, todos los intentos fallaron
    console.error("❌ Reconexión fallida después de todos los intentos");
    this.isReconnecting = false;

    if (this.callbacks.onReconnectFailed) {
      this.callbacks.onReconnectFailed();
    }
    if (this.callbacks.onDisconnected) {
      this.callbacks.onDisconnected();
    }
  }

  /**
   * Esperar a que el WebSocket se conecte o falle
   */
  private waitForConnection(ws: WebSocket): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 5000); // 5 segundos timeout

      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  }

  /**
   * Configurar handlers del WebSocket (separado para reutilizar en reconexión)
   */
  private setupHandlers(): void {
    if (!this.ws) return;

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (event: Event) => {
      console.error("❌ WebSocket error:", event);
      if (this.callbacks.onError) {
        this.callbacks.onError("WebSocket error");
      }
    };

    this.ws.onclose = (event) => {
      console.log(`👋 WebSocket cerrado (code: ${event.code})`);

      if (!this.shouldReconnect) {
        console.log("Desconexión intencional, no se reconectará");
        this.crypto.destroy();
        if (this.callbacks.onDisconnected) {
          this.callbacks.onDisconnected();
        }
        return;
      }

      if (this.isReconnecting) {
        return;
      }

      console.log("⚠️ Conexión perdida, intentando reconectar...");
      this.handleReconnection();
    };
  }

  /**
   * Utilidad: Sleep asíncrono
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Utility: ArrayBuffer → base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return btoa(String.fromCharCode(...bytes));
  }

  /**
   * Utility: base64 → ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export default ChatClient;

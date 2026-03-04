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
  ServerToClientMessage,
} from "../shared/protocol";

export interface ChatClientCallbacks {
  onPeerJoined?: () => void;
  onMessageReceived?: (text: string, timestamp: number) => void;
  onTyping?: (isTyping: boolean) => void;
  onError?: (error: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class ChatClient {
  private ws?: WebSocket;
  private crypto = new CryptoManager();
  private roomId?: string;
  private callbacks: ChatClientCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(callbacks?: ChatClientCallbacks) {
    this.callbacks = callbacks || {};
  }

  /**
   * Conectar a servidor y realizar handshake
   */
  async connect(serverUrl: string, roomId: string): Promise<void> {
    try {
      this.roomId = roomId;

      console.log(`🔗 Conectando a ${serverUrl} (room: ${roomId})`);

      // Generar par de claves
      const publicKeyRaw = await this.crypto.generateKeyPair();
      const publicKeyB64 = this.arrayBufferToBase64(publicKeyRaw);

      // Conectar WebSocket
      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = () => {
        console.log("✅ WebSocket conectado");

        // Enviar handshake
        const handshake: ClientToServerMessage = {
          type: "join",
          roomId,
          publicKey: publicKeyB64,
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

      this.ws.onclose = () => {
        console.log("👋 WebSocket cerrado");
        this.crypto.destroy();
        if (this.callbacks.onDisconnected) {
          this.callbacks.onDisconnected();
        }
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
   * Procesar mensajes del servidor
   */
  private async handleMessage(data: string) {
    try {
      const msg = JSON.parse(data) as ServerToClientMessage;

      switch (msg.type) {
        case "peer_joined":
          await this.handlePeerJoined(msg);
          break;
        case "message":
          await this.handleEncryptedMessage(msg);
          break;
        case "typing":
          if (this.callbacks.onTyping) {
            this.callbacks.onTyping(msg.isTyping);
          }
          break;
      }
    } catch (err) {
      console.error("❌ Error procesando mensaje:", err);
    }
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

      if (this.callbacks.onMessageReceived) {
        this.callbacks.onMessageReceived(payload.text, payload.timestamp);
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
  async sendMessage(text: string): Promise<void> {
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
      }

      // Cifrar
      const encrypted = await this.crypto.encrypt(text);

      // Enviar
      const msg: ClientToServerMessage = {
        type: "message",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      };

      this.ws.send(JSON.stringify(msg));
      console.log("📤 Mensaje cifrado enviado");
    } catch (err) {
      console.error("❌ Error enviando:", err);
      if (this.callbacks.onError) {
        this.callbacks.onError(err instanceof Error ? err.message : "Send failed");
      }
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
   * Desconectar
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, "User disconnect");
    }
    this.crypto.destroy();
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

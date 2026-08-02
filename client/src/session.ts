/**
 * WindChat — Gestión de sesiones de chat (session.ts)
 *
 * Cada "chat abierto" es una `ChatSession` con su propio `ChatClient`
 * (su propio WebSocket + ratchet E2EE) y su propio contenedor DOM clonado.
 * Así se pueden tener VARIOS chats abiertos a la vez (cada uno es una room
 * independiente en el relay) y alternar entre ellos, como en una app completa.
 *
 * El motor de mensajes (enviar/recibir/reacciones/archivos) vive en
 * `connectToChat` (main.ts), parametrizado por un `root` (el contenedor de la
 * sesión). Aquí solo guardamos el estado y el búfer de mensajes por sesión.
 */

import ChatClient from "./websocket.js";
import CryptoManager from "./crypto.js";
import Store, { Conversation } from "./store.js";

export interface SessionMessage {
  id?: string;
  side: "me" | "other";
  displayName: string;
  text: string;
  timestamp: number;
  replyToId?: string;
  status?: "sent" | "delivered" | "read";
  isFile?: boolean;
}

export class ChatSession {
  conv: Conversation;
  client: ChatClient;
  crypto: CryptoManager;
  /** Mensajes descifrados (copia local; el servidor es efímero). */
  messages: SessionMessage[] = [];
  unread = 0;
  active = false;
  peerPublicKey?: string;
  peerDisplayName?: string;
  /** Indica si es la primera conexión (vs reconexión). Para no vaciar historial (§4.1b). */
  isFirstConnect = true;

  constructor(conv: Conversation, client: ChatClient, crypto: CryptoManager) {
    this.conv = conv;
    this.client = client;
    this.crypto = crypto;
  }

  pushMessage(msg: SessionMessage): void {
    this.messages.push(msg);
    // Conservar solo los últimos N para no crecer sin límite en localStorage.
    if (this.messages.length > 500) this.messages.shift();
  }
}

/**
 * Administra las sesiones abiertas y la sesión activa.
 * Mantiene el contenedor DOM de cada sesión (clonado del template) y los
 * metadatos de conversación en el Store.
 */
export class SessionManager {
  private sessions = new Map<string, ChatSession>();
  private roots = new Map<string, HTMLElement>();
  private stage: HTMLElement;
  activeConvId: string | null = null;

  constructor(stage: HTMLElement) {
    this.stage = stage;
  }

  has(convId: string): boolean {
    return this.sessions.has(convId);
  }

  get(convId: string): ChatSession | undefined {
    return this.sessions.get(convId);
  }

  getActive(): ChatSession | undefined {
    return this.activeConvId ? this.sessions.get(this.activeConvId) : undefined;
  }

  all(): ChatSession[] {
    return [...this.sessions.values()];
  }

  setRoot(convId: string, root: HTMLElement): void {
    this.roots.set(convId, root);
  }

  getRoot(convId: string): HTMLElement | undefined {
    return this.roots.get(convId);
  }

  register(session: ChatSession): void {
    this.sessions.set(session.conv.id, session);
  }

  unregister(convId: string): void {
    this.sessions.delete(convId);
    this.roots.delete(convId);
  }

  setActive(convId: string): void {
    for (const s of this.sessions.values()) s.active = false;
    const s = this.sessions.get(convId);
    if (s) {
      s.active = true;
      s.unread = 0;
    }
    this.activeConvId = convId;
  }

  /** Persiste el preview de último mensaje en los metadatos de la conversación. */
  touchConversation(convId: string, preview: string): void {
    const conv = Store.getConversation(convId);
    if (conv) {
      Store.updateConversation(convId, {
        lastMessagePreview: preview,
        lastActivity: Date.now(),
      });
    }
  }
}

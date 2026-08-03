/**
 * WindChat — Capa de persistencia local (store.ts)
 *
 * Almacena perfil, contactos, conversaciones y ajustes en `localStorage`.
 * Sin telemetría, sin red. Funciona también en Node (tests) usando un
 * respaldo en memoria si `localStorage` no existe.
 *
 * Nota: los mensajes cifrados son efímeros en el servidor; aquí guardamos
 * SOLO una copia local de los metadatos y del texto descifrado (para que la
 * app se sienta "completa" offline), nunca claves ni ciphertext del servidor.
 */

export type ThemeName = "dark" | "light" | "stellar";

export interface Profile {
  displayName: string;
  avatarColor: string; // hex, p.ej. "#7db4ff"
  status: string; // mensaje de estado libre
  identityPublicKey?: string; // base64 raw P-256 (la identidad del usuario)
  avatarDataUrl?: string; // foto de perfil en dataURL (opcional)
}

export interface Contact {
  id: string;
  displayName: string;
  identityPublicKey?: string; // base64 raw P-256 del peer (para SAS)
  publicKey?: string; // alias de identityPublicKey usado por el shell
  safetyNumber?: string; // dígitos SAS una vez que se ha chateado
  addedAt: number;
  lastSeen?: number;
  roomId?: string; // última room usada con este contacto
  note?: string;
}

export const AVATAR_COLORS = [
  "#7db4ff", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#fb7185",
];

export interface Conversation {
  id: string; // uuid
  type: "direct" | "group";
  title: string;
  peerIdentityPublicKey?: string;
  roomId: string; // room actual (efímera)
  contactId?: string; // si está ligada a un contacto
  ephemeral: boolean;
  createdAt: number;
  lastMessagePreview?: string;
  lastActivity?: number;
  unreadCount: number;
  color?: string;
}

export interface Settings {
  theme: ThemeName;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  language: "es" | "en";
}

const DEFAULT_PROFILE: Profile = {
  displayName: "Anon",
  avatarColor: "#7db4ff",
  status: "",
};

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  soundEnabled: true,
  notificationsEnabled: true,
  language: "es",
};

// Respaldo en memoria para entornos sin localStorage (tests Node).
const memoryFallback = new Map<string, string>();
function lsGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  return memoryFallback.has(key) ? (memoryFallback.get(key) as string) : null;
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* ignore */
  }
  memoryFallback.set(key, value);
}
function lsRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
      return;
    }
  } catch {
    /* ignore */
  }
  memoryFallback.delete(key);
}

const K_PROFILE = "windchat_profile";
const K_CONTACTS = "windchat_contacts";
const K_CONVERSATIONS = "windchat_conversations";
const K_SETTINGS = "windchat_settings";

function readJSON<T>(key: string, fallback: T): T {
  const raw = lsGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown): void {
  lsSet(key, JSON.stringify(value));
}

export const Store = {
  // ---- Profile ----
  getProfile(): Profile {
    return readJSON<Profile>(K_PROFILE, DEFAULT_PROFILE);
  },
  saveProfile(p: Partial<Profile>): Profile {
    const merged = { ...this.getProfile(), ...p };
    writeJSON(K_PROFILE, merged);
    return merged;
  },

  // ---- Settings ----
  getSettings(): Settings {
    return readJSON<Settings>(K_SETTINGS, DEFAULT_SETTINGS);
  },
  saveSettings(s: Partial<Settings>): Settings {
    const merged = { ...this.getSettings(), ...s };
    writeJSON(K_SETTINGS, merged);
    return merged;
  },

  // ---- Contacts ----
  getContacts(): Contact[] {
    return readJSON<Contact[]>(K_CONTACTS, []);
  },
  getContact(id: string): Contact | undefined {
    return this.getContacts().find((c) => c.id === id);
  },
  getContactByPublicKey(pub: string): Contact | undefined {
    return this.getContacts().find((c) => c.identityPublicKey === pub);
  },
  saveContact(c: Contact): Contact {
    const list = this.getContacts();
    const idx = list.findIndex((x) => x.id === c.id);
    if (idx >= 0) list[idx] = c;
    else list.push(c);
    writeJSON(K_CONTACTS, list);
    return c;
  },
  upsertContactByPublicKey(pub: string, partial: Partial<Contact>): Contact {
    const existing = this.getContactByPublicKey(pub);
    if (existing) {
      return this.saveContact({ ...existing, ...partial });
    }
    const c: Contact = {
      id: crypto.randomUUID(),
      displayName: partial.displayName ?? "Peer",
      identityPublicKey: pub,
      addedAt: Date.now(),
      ...partial,
    };
    return this.saveContact(c);
  },
  removeContact(id: string): void {
    writeJSON(
      K_CONTACTS,
      this.getContacts().filter((c) => c.id !== id)
    );
  },

  // ---- Conversations ----
  getConversations(): Conversation[] {
    return readJSON<Conversation[]>(K_CONVERSATIONS, []);
  },
  getConversation(id: string): Conversation | undefined {
    return this.getConversations().find((c) => c.id === id);
  },
  getConversationByRoom(roomId: string): Conversation | undefined {
    return this.getConversations().find((c) => c.roomId === roomId);
  },
  createConversation(c: Omit<Conversation, "id" | "createdAt" | "unreadCount"> & Partial<Pick<Conversation, "id" | "createdAt" | "unreadCount">>): Conversation {
    const conv: Conversation = {
      id: c.id ?? crypto.randomUUID(),
      createdAt: c.createdAt ?? Date.now(),
      unreadCount: c.unreadCount ?? 0,
      ...c,
    };
    const list = this.getConversations();
    const idx = list.findIndex((x) => x.id === conv.id);
    if (idx >= 0) list[idx] = conv;
    else list.push(conv);
    writeJSON(K_CONVERSATIONS, list);
    return conv;
  },
  updateConversation(id: string, partial: Partial<Conversation>): Conversation | undefined {
    const list = this.getConversations();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return undefined;
    list[idx] = { ...list[idx], ...partial };
    writeJSON(K_CONVERSATIONS, list);
    return list[idx];
  },
  removeConversation(id: string): void {
    writeJSON(
      K_CONVERSATIONS,
      this.getConversations().filter((c) => c.id !== id)
    );
  },
  clearConversations(): void {
    writeJSON(K_CONVERSATIONS, []);
  },
  /** Upsert de conversación por id (usado por el shell). */
  saveConversation(c: Conversation): Conversation {
    const list = this.getConversations();
    const idx = list.findIndex((x) => x.id === c.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...c };
    else list.push(c);
    writeJSON(K_CONVERSATIONS, list);
    return c;
  },

  // ---- Bulk (para sync) ----
  /** Reemplaza perfil + contactos con los del backup (merge por id). */
  applySyncData(profile: Profile, contacts: Contact[]): void {
    writeJSON(K_PROFILE, profile);
    writeJSON(K_CONTACTS, contacts);
  },

  clearAll(): void {
    lsRemove(K_PROFILE);
    lsRemove(K_CONTACTS);
    lsRemove(K_CONVERSATIONS);
    lsRemove(K_SETTINGS);
    // §4.9 FIX: incluir claves persistidas fuera del Store (legacy displayName)
    lsRemove("windchat_display_name");
  },
};

export default Store;

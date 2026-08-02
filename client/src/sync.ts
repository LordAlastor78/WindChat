/**
 * WindChat — Sincronización de perfil y contactos entre dispositivos (sync.ts)
 *
 * Modelo tipo Session/Signal pero offline y sin servidores:
 * el perfil + los contactos se cifran con una clave derivada de un
 * "código de sincronización" (passphrase que el usuario elige/comparta).
 * El resultado es un blob (base64) que se puede:
 *   - pegar en otro dispositivo (importar), o
 *   - guardar como archivo de respaldo cifrado.
 *
 * El blob NUNCA contiene mensajes (esos son efímeros en el servidor) ni
 * claves privadas. Solo metadatos de la identidad y la libreta de contactos.
 */

import type { Contact, Profile } from "./store";

const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function getCrypto(): Crypto {
  const c = (globalThis as any).crypto;
  if (!c || !c.subtle) {
    throw new Error("Web Crypto no disponible en este entorno");
  }
  return c as Crypto;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Copia a un Uint8Array respaldado por ArrayBuffer plano (TS 5.7: Uint8Array<ArrayBuffer>).
function toBuf(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(u.length);
  out.set(u);
  return out as Uint8Array<ArrayBuffer>;
}

export interface SyncPayload {
  v: 1;
  profile: Profile;
  contacts: Contact[];
}

/**
 * Exporta (cifra) perfil + contactos bajo un código de sincronización.
 * Devuelve un string compacto y portable (base64 de JSON cifrado + salt + iv).
 */
export async function exportSync(
  profile: Profile,
  contacts: Contact[],
  syncCode: string
): Promise<string> {
  if (!syncCode || syncCode.length < 4) {
    throw new Error("El código de sincronización es demasiado corto");
  }
  const c = getCrypto();
  const enc = new TextEncoder();

  const salt = toBuf(c.getRandomValues(new Uint8Array(SALT_BYTES)));
  const iv = toBuf(c.getRandomValues(new Uint8Array(IV_BYTES)));

  const keyMaterial = await c.subtle.importKey(
    "raw",
    toBuf(enc.encode(syncCode)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const aesKey = await c.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const payload: SyncPayload = { v: 1, profile, contacts };
  const plaintext = enc.encode(JSON.stringify(payload));

  const ct = new Uint8Array(
    await c.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext)
  );

  // Formato: base64(salt) + "." + base64(iv) + "." + base64(ciphertext)
  return `${toBase64(salt)}.${toBase64(iv)}.${toBase64(ct)}`;
}

/**
 * Importa (descifra) un blob de sincronización.
 * Lanza si el código es incorrecto o el blob está corrupto.
 */
export async function importSync(
  blob: string,
  syncCode: string
): Promise<SyncPayload> {
  if (!syncCode || syncCode.length < 4) {
    throw new Error("El código de sincronización es demasiado corto");
  }
  const parts = blob.split(".");
  if (parts.length !== 3) {
    throw new Error("Blob de sincronización inválido");
  }
  const [saltB64, ivB64, ctB64] = parts;
  const c = getCrypto();
  const enc = new TextEncoder();

  const salt = toBuf(fromBase64(saltB64));
  const iv = toBuf(fromBase64(ivB64));
  const ct = toBuf(fromBase64(ctB64));

  const keyMaterial = await c.subtle.importKey(
    "raw",
    toBuf(enc.encode(syncCode)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const aesKey = await c.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  let plain: ArrayBuffer;
  try {
    plain = await c.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  } catch {
    throw new Error("Código de sincronización incorrecto o blob corrupto");
  }

  const text = new TextDecoder().decode(plain);
  const parsed = JSON.parse(text) as SyncPayload;
  if (parsed.v !== 1 || !parsed.profile) {
    throw new Error("Versión de blob no soportada");
  }
  return parsed;
}

/** Genera un código de sincronización legible (4 palabras) para mostrar al usuario. */
export function generateSyncCode(): string {
  const words = [
    "viento", "astro", "nube", "fugaz", "orbita", "nebla", "cometa", "senda",
    "bruma", "eclips", "polar", "quantum", "helix", "nexo", "pulsar", "cifra",
    "ruido", "cifrado", "llave", "marea",
  ];
  const pick = () =>
    words[Math.floor(Math.random() * words.length)];
  return [pick(), pick(), pick(), pick()].join("-");
}

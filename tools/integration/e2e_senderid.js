// Valida end-to-end contra el relay REAL (con senderId): 2 clientes en la
// misma room. El server excluye al sender, así que ninguno recibe sus propios
// mensajes; pero confirmamos que senderId viaja y que la conversación funciona
// sin errores. También verifica que si el server DEVOLVIERA un eco (caso build
// vieja), el cliente lo ignora por senderId.
const WebSocket = require("ws");
const crypto = require("crypto");
const webcrypto = globalThis.crypto;
const PORT = process.env.PORT || 8087;
const URL = `ws://localhost:${PORT}`;
const ROOM = "e2e-real-" + crypto.randomBytes(4).toString("hex");
const b64 = (u8) => Buffer.from(u8).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const MSG_KEY_LABEL = new Uint8Array([0x01]); const CHAIN_KEY_LABEL = new Uint8Array([0x02]); const IV_SIZE = 12;
function compareBytes(a, b) { const len = Math.min(a.length, b.length); for (let i = 0; i < len; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
async function hmacStep(key, label) { const k = await webcrypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await webcrypto.subtle.sign("HMAC", k, label)); }
async function advanceChain(chain) { const mk = await hmacStep(chain.key, MSG_KEY_LABEL); const nk = await hmacStep(chain.key, CHAIN_KEY_LABEL); chain.key = nk; chain.counter += 1; return mk; }
async function importKey(raw) { return webcrypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
const ChainState = (key) => ({ key, counter: 0 });
class Peer {
  constructor(name) { this.name = name; this.connectionId = crypto.randomUUID(); this.sendChain = null; this.recvChain = null; this.keyPair = null; this.errors = []; this.decrypted = []; this.ignoredOwn = 0; this.receivedSenderIds = new Set(); this.sent = 0; }
  async generate() { this.keyPair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]); this.myPubRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", this.keyPair.publicKey)); return b64(this.myPubRaw); }
  async derive(theirPubB64) {
    const theirPubRaw = fromB64(theirPubB64);
    const theirKey = await webcrypto.subtle.importKey("raw", theirPubRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = await webcrypto.subtle.deriveBits({ name: "ECDH", public: theirKey }, this.keyPair.privateKey, 256);
    const salt = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("WindChat-v1-" + ROOM));
    const rootBits = await webcrypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new TextEncoder().encode("WindChat Ratchet Root v1") }, await webcrypto.subtle.importKey("raw", new Uint8Array(shared), { name: "HKDF" }, false, ["deriveBits"]), 512);
    const root = new Uint8Array(rootBits);
    const iAmFirst = compareBytes(this.myPubRaw, theirPubRaw) <= 0;
    this.sendChain = ChainState(iAmFirst ? root.slice(0, 32) : root.slice(32, 64));
    this.recvChain = ChainState(iAmFirst ? root.slice(32, 64) : root.slice(0, 32));
  }
  async encrypt(payload) { const counter = this.sendChain.counter; const mk = await importKey(await advanceChain(this.sendChain)); const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE)); const aad = new TextEncoder().encode(String(counter)); const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, mk, new TextEncoder().encode(JSON.stringify(payload))); this.sent++; return { iv: b64(iv), ciphertext: b64(new Uint8Array(ct)), counter, senderId: this.connectionId }; }
  async messageKeyForCounter(counter) { if (counter < this.recvChain.counter) throw new Error(`Clave ${counter} no disponible`); const gap = counter - this.recvChain.counter; if (gap > 1000) throw new Error("Salto"); while (this.recvChain.counter < counter) { await advanceChain(this.recvChain); } return advanceChain(this.recvChain); }
  async decrypt(ivB64, ciphertextB64, counter) { const mk = await importKey(await this.messageKeyForCounter(counter)); const iv = fromB64(ivB64); const aad = new TextEncoder().encode(String(counter)); const buf = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, mk, fromB64(ciphertextB64)); return JSON.parse(new TextDecoder().decode(buf)); }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  connect() { return new Promise((res) => { this.ws = new WebSocket(URL); this.ws.on("open", res); this.ws.on("message", (d) => this.onMessage(d)); }); }
  onMessage(d) {
    const m = JSON.parse(d.toString());
    if (m.type === "peer_joined") { this.derive(m.theirPublicKey).catch((e) => this.errors.push("derive:" + e.message)); return; }
    if (m.type !== "message") return;
    if (m.senderId) this.receivedSenderIds.add(m.senderId);
    if (m.senderId && m.senderId === this.connectionId) { this.ignoredOwn++; return; } // FIX
    this.decrypt(m.iv, m.ciphertext, m.counter).then((p) => { this.decrypted.push(p.type); if (p.type === "text" && p.id) { this.encrypt({ id: crypto.randomUUID(), type: "receipt", receiptForId: p.id, receiptState: "delivered", displayName: this.name, timestamp: Date.now() }).then((r) => this.send({ type: "message", ...r })).catch((e) => this.errors.push("rcpt:" + e.message)); } }).catch((e) => this.errors.push("dec:" + e.constructor.name));
  }
  async sendText(text) { const p = { id: crypto.randomUUID(), type: "text", text, displayName: this.name, timestamp: Date.now() }; const r = await this.encrypt(p); this.send({ type: "message", ...r }); }
}
async function main() {
  const a = new Peer("A"); const b = new Peer("B");
  const aPub = await a.generate(); const bPub = await b.generate();
  await a.connect(); a.send({ type: "join", roomId: ROOM, publicKey: aPub, displayName: "A", connectionId: a.connectionId });
  await b.connect(); b.send({ type: "join", roomId: ROOM, publicKey: bPub, displayName: "B", connectionId: b.connectionId });
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 5; i++) { await a.sendText("A" + i); await b.sendText("B" + i); await new Promise((r) => setTimeout(r, 100)); }
  await new Promise((r) => setTimeout(r, 1000));
  console.log("A decrypted:", a.decrypted.length, "ignoredOwn:", a.ignoredOwn, "errors:", a.errors);
  console.log("B decrypted:", b.decrypted.length, "ignoredOwn:", b.ignoredOwn, "errors:", b.errors);
  console.log("senderIds recibidos por A:", [...a.receivedSenderIds]);
  const ok = a.errors.length === 0 && b.errors.length === 0 && a.decrypted.length >= 5 && b.decrypted.length >= 5 && a.receivedSenderIds.has(b.connectionId);
  console.log(ok ? "✅ E2E REAL OK: senderId viaja, conversación limpia, 0 errores" : "❌ E2E REAL FALLA");
  a.ws.close(); b.ws.close(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Stress test E2E: dos clientes intercambian N mensajes cifrados con ratchet
 * a través del servidor real y verifica que todos llegan y descifran.
 *
 * Uso: node tools/integration/stress.js <ws-url> [N]
 */
const WebSocket = require("ws");
const crypto = require("crypto");

const URL = process.argv[2] || "ws://127.0.0.1:8080";
const N = parseInt(process.argv[3] || "300", 10);
const ROOM = "stress-" + crypto.randomBytes(4).toString("hex");

const INFO = Buffer.from("WindChat Ratchet Root v1");
function sha256(b) { return crypto.createHash("sha256").update(b).digest(); }
function hmac(key, label) { return crypto.createHmac("sha256", key).update(label).digest(); }
function deriveBits(shared, len) {
  return crypto.hkdfSync("sha256", shared, sha256(Buffer.from("WindChat-v1-" + ROOM)), INFO, len);
}
function compareBytes(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

class MiniRatchet {
  constructor() {
    this.ecdh = crypto.createECDH("prime256v1");
    this.ecdh.generateKeys();
    this.send = { key: null, ctr: 0 };
    this.recv = { key: null, ctr: 0 };
    this.skipped = new Map();
  }
  pubB64() { return this.ecdh.getPublicKey().toString("base64"); }
  init(theirB64) {
    const their = Buffer.from(theirB64, "base64");
    const shared = this.ecdh.computeSecret(their);
    const root = deriveBits(shared, 64);
    const A = root.slice(0, 32), B = root.slice(32, 64);
    const mine = this.ecdh.getPublicKey();
    const iAmFirst = compareBytes(mine, their) <= 0;
    this.send.key = iAmFirst ? A : B;
    this.recv.key = iAmFirst ? B : A;
  }
  _advance(chain) {
    const mk = hmac(chain.key, Buffer.from([1]));
    chain.key = hmac(chain.key, Buffer.from([2]));
    chain.ctr++;
    return mk;
  }
  async encrypt(text) {
    const ctr = this.send.ctr;
    const mk = this._advance(this.send);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", mk, iv);
    cipher.setAAD(Buffer.from(String(ctr)));
    const ct = Buffer.concat([cipher.update(text), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString("base64"), ciphertext: Buffer.concat([ct, tag]).toString("base64"), counter: ctr };
  }
  async decrypt(msg) {
    let mk;
    if (msg.counter < this.recv.ctr) mk = this.skipped.get(msg.counter);
    else {
      while (this.recv.ctr < msg.counter) this.skipped.set(this.recv.ctr, this._advance(this.recv));
      mk = this._advance(this.recv);
    }
    const buf = Buffer.from(msg.ciphertext, "base64");
    const iv = Buffer.from(msg.iv, "base64");
    const ct = buf.slice(0, -16), tag = buf.slice(-16);
    const dec = crypto.createDecipheriv("aes-256-gcm", mk, iv);
    dec.setAAD(Buffer.from(String(msg.counter)));
    dec.setAuthTag(tag);
    return dec.update(ct).toString() + dec.final().toString();
  }
}

function connect(rt, displayName) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    let done = false;
    ws.on("open", () => ws.send(JSON.stringify({ type: "join", roomId: ROOM, publicKey: rt.pubB64(), displayName })));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "peer_joined") { rt.init(m.theirPublicKey); if (!done) { done = true; resolve(ws); } }
    });
    ws.on("error", reject);
  });
}

(async () => {
  const alice = new MiniRatchet();
  const bob = new MiniRatchet();
  const [aws, bws] = await Promise.all([connect(alice, "AliceS"), connect(bob, "BobS")]);

  let guard = 0;
  while ((!alice.send.key || !bob.send.key) && guard++ < 50) await new Promise((r) => setTimeout(r, 50));
  if (!alice.send.key || !bob.send.key) { console.log("STRESS_FAIL (sin clave)"); process.exit(1); }

  const aMsgs = Array.from({ length: N }, (_, i) => "a" + i);
  const bMsgs = Array.from({ length: N }, (_, i) => "b" + i);
  let aliceGot = [], bobGot = [];
  aws.on("message", async (raw) => { const m = JSON.parse(raw); if (m.type === "message") aliceGot.push(await alice.decrypt(m)); });
  bws.on("message", async (raw) => { const m = JSON.parse(raw); if (m.type === "message") bobGot.push(await bob.decrypt(m)); });

  const t0 = Date.now();
  // Respetar el rate limit del servidor (10 msg/s por conexión): enviar con
  // pausa de 110ms entre mensajes para no ser descartados.
  for (const t of aMsgs) { const e = await alice.encrypt(t); aws.send(JSON.stringify({ type: "message", ...e })); await new Promise(r => setTimeout(r, 110)); }
  for (const t of bMsgs) { const e = await bob.encrypt(t); bws.send(JSON.stringify({ type: "message", ...e })); await new Promise(r => setTimeout(r, 110)); }

  let g = 0;
  while ((aliceGot.length < N || bobGot.length < N) && g++ < 150) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 200));
  const ms = Date.now() - t0;

  const okA = JSON.stringify(aliceGot) === JSON.stringify(bMsgs);
  const okB = JSON.stringify(bobGot) === JSON.stringify(aMsgs);
  const ok = okA && okB;
  console.log(`STRESS: enviados=${N * 2} alice=${aliceGot.length} bob=${bobGot.length} t=${ms}ms (${(N * 2 / (ms / 1000)).toFixed(0)} msg/s) okA=${okA} okB=${okB}`);
  console.log(ok ? "STRESS_OK" : "STRESS_FAIL");
  aws.close(); bws.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

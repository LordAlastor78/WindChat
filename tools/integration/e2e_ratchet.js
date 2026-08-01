/**
 * E2E real contra el servidor: dos clientes WebSocket completan handshake +
 * ratchet y se intercambian mensajes. Verifica que el contador del ratchet
 * viaja por el servidor y se descifra en el otro extremo.
 *
 * Uso: node tools/integration/e2e_ratchet.js <ws-url> [room]
 */
const WebSocket = require("ws");
const crypto = require("crypto");

const URL = process.argv[2] || "ws://127.0.0.1:8080";
const ROOM = process.argv[3] || "e2e-ratchet-" + crypto.randomBytes(4).toString("hex");

// --- Replica mínima del ratchet del cliente para la prueba (HMAC-AES-GCM) ---
const INFO = Buffer.from("WindChat Ratchet Root v1");
function sha256(b) { return crypto.createHash("sha256").update(b).digest(); }
function hmac(key, label) { return crypto.createHmac("sha256", key).update(label).digest(); }
function deriveBits(shared, len) {
  // HKDF-SHA256 con salt=sha256("WindChat-v1-"+room) simplificado para el test
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
      if (m.type === "peer_joined") {
        console.log(displayName, "peer_joined recibido");
        rt.init(m.theirPublicKey);
        if (!done) { done = true; resolve(ws); }
      }
    });
    ws.on("error", reject);
  });
}

(async () => {
  const alice = new MiniRatchet();
  const bob = new MiniRatchet();
  // Conectar ambos en paralelo: el peer_joined de cada uno llega cuando el
  // otro ya está en la sala (broadcast a ambos). No esperar secuencialmente
  // o se hace deadlock: el primero no recibe peer_joined hasta que haya 2.
  const [aws, bws] = await Promise.all([
    connect(alice, "AliceE2E"),
    connect(bob, "BobE2E"),
  ]);

  // Esperar a que AMBOS tengan la clave del peer
  let guard = 0;
  while ((!alice.send.key || !bob.send.key) && guard++ < 50) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!alice.send.key || !bob.send.key) {
    console.log("E2E_RATCHET=FAIL (no se derivó la clave compartida)");
    process.exit(1);
  }

  let aliceGot = [];
  let bobGot = [];
  aws.on("message", async (raw) => {
    const m = JSON.parse(raw);
    // aws es el socket de Alice: lo que llega aquí es de Bob, Alice lo descifra
    if (m.type === "message") aliceGot.push(await alice.decrypt(m));
  });
  bws.on("message", async (raw) => {
    const m = JSON.parse(raw);
    // bws es el socket de Bob: lo que llega aquí es de Alice, Bob lo descifra
    if (m.type === "message") bobGot.push(await bob.decrypt(m));
  });

  // Alice manda 3, Bob manda 3
  const aMsgs = ["hola-bob", "ratchet-1", "ratchet-2"];
  const bMsgs = ["hola-alice", "resp-1", "resp-2"];
  console.log("enviando mensajes...");
  for (const t of aMsgs) { const e = await alice.encrypt(t); aws.send(JSON.stringify({ type: "message", ...e })); }
  for (const t of bMsgs) { const e = await bob.encrypt(t); bws.send(JSON.stringify({ type: "message", ...e })); }
  console.log("mensajes enviados, esperando...");

  await new Promise((r) => setTimeout(r, 500));
  // Dar tiempo a que los handlers async terminen los decrypt
  await new Promise((r) => setTimeout(r, 300));
  console.log("recibido A:", aliceGot, " B:", bobGot);

  const okA = JSON.stringify(aliceGot) === JSON.stringify(bMsgs);
  const okB = JSON.stringify(bobGot) === JSON.stringify(aMsgs);
  console.log("okA=", okA, " okB=", okB);
  const ok = okA && okB;
  console.log("A-raw:", JSON.stringify(aliceGot));
  console.log("B-raw:", JSON.stringify(bobGot));
  console.log("aMsgs:", JSON.stringify(aMsgs));
  console.log("bMsgs:", JSON.stringify(bMsgs));
  console.log(ok ? "E2E_RATCHET=OK" : "E2E_RATCHET=FAIL");
  aws.close(); bws.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

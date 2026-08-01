/**
 * E2E real contra el servidor: verifica que una reacción cifrada (add/remove)
 * viaja por el relay y el receptor la procesa. Replica la lógica de main.ts
 * (mapa emoji->count) de forma mínima para validar el protocolo.
 *
 * Uso: node tools/integration/e2e_reaction.js ws://127.0.0.1:PORT
 */
const WebSocket = require("ws");
const crypto = require("crypto");
const URL = process.argv[2] || "ws://127.0.0.1:8087";
const ROOM = "sala-reaccion-" + Math.random().toString(36).slice(2, 7);

class MiniRatchet {
  constructor() { this.e = crypto.createECDH("prime256v1"); this.e.generateKeys(); this.snd = null; this.rcv = null; this.sc = 0; this.rc = 0; }
  get pub() { return this.e.getPublicKey("base64", "uncompressed"); }
  init(b) { const z = this.e.computeSecret(Buffer.from(b, "base64")); const r = crypto.createHmac("sha256", "windchat-root").update(z).digest(); const [a, k] = [r.subarray(0, 32), r.subarray(32, 64)]; const [s, rr] = [a, k].sort(Buffer.compare); this.snd = s; this.rcv = rr; }
  initRecv(b) { const z = this.e.computeSecret(Buffer.from(b, "base64")); const r = crypto.createHmac("sha256", "windchat-root").update(z).digest(); const [a, k] = [r.subarray(0, 32), r.subarray(32, 64)]; const [s, rr] = [a, k].sort(Buffer.compare); this.snd = rr; this.rcv = s; }
  _step(k) { const nk = crypto.createHmac("sha256", k).update(Buffer.from([2])).digest(); const mk = crypto.createHmac("sha256", k).update(Buffer.from([1])).digest(); return [nk, mk]; }
  async enc(t) { const [nk, mk] = this._step(this.snd); this.snd = nk; const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", mk, iv); const ct = Buffer.concat([c.update(t), c.final()]); const counter = this.sc++; return { iv: iv.toString("base64"), ciphertext: Buffer.concat([ct, c.getAuthTag()]).toString("base64"), counter }; }
  async dec(e) { const b = Buffer.from(e.ciphertext, "base64"); const ct = b.subarray(0, b.length - 16); const tg = b.subarray(b.length - 16); const [nk, mk] = this._step(this.rcv); this.rcv = nk; const c = crypto.createDecipheriv("aes-256-gcm", mk, Buffer.from(e.iv, "base64")); c.setAuthTag(tg); this.rc++; return Buffer.concat([c.update(ct), c.final()]).toString(); }
}

function connect(rt, name, asReceiver) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => ws.send(JSON.stringify({ type: "join", roomId: ROOM, displayName: name, publicKey: rt.pub })));
    ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.type === "peer_joined") { (asReceiver ? rt.initRecv(m.theirPublicKey) : rt.init(m.theirPublicKey)); resolve(ws); } });
    ws.on("error", reject);
  });
}

(async () => {
  const alice = new MiniRatchet();
  const bob = new MiniRatchet();
  const [aws, bws] = await Promise.all([connect(alice, "Alice", false), connect(bob, "Bob", true)]);

  // Bob acumula reacciones en un mapa (igual que main.ts)
  const bobReactions = {};
  let done = false;
  bws.on("message", async (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "message") {
      const p = JSON.parse(await bob.dec(m));
      if (p.type === "reaction") {
        const cur = bobReactions[p.text] ?? 0;
        bobReactions[p.text] = p.reactionAction === "remove" ? Math.max(0, cur - 1) : cur + 1;
        if (!done && bobReactions["🔥"] >= 2 && bobReactions["👍"] >= 1) { done = true; finish(); }
      }
    }
  });

  function finish() {
    const ok = bobReactions["🔥"] === 2 && bobReactions["👍"] === 1;
    console.log(`E2E_REACTION: 🔥=${bobReactions["🔥"]} 👍=${bobReactions["👍"]} => ${ok ? "OK" : "FAIL"}`);
    aws.close(); bws.close();
    process.exit(ok ? 0 : 1);
  }

  const react = async (emoji, toId, action = "add") => {
    await aws.send(JSON.stringify({ type: "message", ...await alice.enc(JSON.stringify({ type: "reaction", text: emoji, reactionToId: toId, reactionAction: action })) }));
    await new Promise((r) => setTimeout(r, 120));
  };

  const msgId = "msg_xyz";
  await react("🔥", msgId, "add");   // 🔥 = 1
  await react("👍", msgId, "add");   // 👍 = 1
  await react("🔥", msgId, "add");   // 🔥 = 2  -> dispara finish
  setTimeout(() => { console.log("E2E_REACTION_TIMEOUT"); process.exit(2); }, 15000);
})().catch((e) => { console.error(e); process.exit(3); });

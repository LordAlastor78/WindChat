// Verificación independiente (Node) del relay Rust: reproduce el flujo de
// WindChat contra relay-rust.exe y valida el contrato (igual que el E2E TS).
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const URL = `ws://127.0.0.1:${PORT}`;

// Claves P-256 dummy válidas (65 bytes, 0x04...).
const KEY_A = "B" + "A".repeat(86) + "="; // 88 chars base64 ~ 65 bytes, primer byte 0x04
const KEY_B = "BAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";

function client(name) {
  const ws = new WebSocket(URL);
  const log = (m) => console.log(`[${name}]`, m);
  const got = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  const send = (o) => ws.send(JSON.stringify(o));
  return { ws, send, got, log, name };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const A = client("A");
  const B = client("B");
  await new Promise((r) => A.ws.on("open", r));
  await new Promise((r) => B.ws.on("open", r));
  A.log("conectado"); B.log("conectado");

  // A join
  A.send({ type: "join", roomId: "roomX", publicKey: KEY_A, connectionId: "connA" });
  await wait(150);
  // B join
  B.send({ type: "join", roomId: "roomX", publicKey: KEY_B, connectionId: "connB" });
  await wait(200);

  const aPeer = A.got.find((m) => m.type === "peer_joined");
  const bPeer = B.got.find((m) => m.type === "peer_joined");
  if (!aPeer || aPeer.theirPublicKey !== KEY_B) throw new Error("A no recibió clave de B");
  if (!bPeer || bPeer.theirPublicKey !== KEY_A) throw new Error("B no recibió clave de A");
  console.log("✅ peer_joined cruzado OK (A↔B)");

  // A envía mensaje cifrado
  A.send({ type: "message", iv: "AAAAAAAAAAAAAAAAAAAAAA==", ciphertext: KEY_A, counter: 1 });
  await wait(200);
  const bMsg = B.got.find((m) => m.type === "message");
  if (!bMsg || bMsg.senderId !== "connA" || bMsg.counter !== 1)
    throw new Error("B no recibió mensaje con senderId/counter correctos: " + JSON.stringify(bMsg));
  console.log("✅ eco con senderId OK:", JSON.stringify({ senderId: bMsg.senderId, counter: bMsg.counter }));

  // Reconexión de B con MISMO connectionId: NO debe haber peer_joined nuevo
  const B2 = client("B2");
  await new Promise((r) => B2.ws.on("open", r));
  B2.got.length = 0;
  B2.send({ type: "join", roomId: "roomX", publicKey: KEY_B, connectionId: "connB" });
  await wait(350);
  const b2Peer = B2.got.find((m) => m.type === "peer_joined");
  if (b2Peer) throw new Error("RECONEXIÓN re-envió peer_joined (bug de ratchet): " + JSON.stringify(b2Peer));
  console.log("✅ reconexión sin re-handshake OK (no peer_joined)");

  console.log("\n🎉 Contrato del relay Rust validado por cliente Node independiente.");
  A.ws.close(); B.ws.close(); B2.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("❌ FALLO:", e.message);
  process.exit(1);
});

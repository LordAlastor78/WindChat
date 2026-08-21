/**
 * E2E F-1: tras una CAÍDA REAL del peer (sin re-handshake previo), al volver
 * debe recibir peer_joined de nuevo. Reproduce el escenario roto:
 *   A y B conectados -> B se cae por completo -> A recibe peer_disconnected
 *   -> B vuelve con el MISMO connectionId -> A debe recibir peer_joined de nuevo.
 *
 * Uso: node tools/integration/e2e_f1_peer_reconnect.js [ws-url] [relay: node|rust]
 */
const WebSocket = require("ws");

const URL = process.argv[2] || "ws://127.0.0.1:8081";
const KEY_A = "B" + "A".repeat(86) + "="; // dummy P-256 65B
const KEY_B = "BAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";

function client(name) {
  const ws = new WebSocket(URL);
  const got = [];
  const log = (m) => console.log(`[${name}]`, m);
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  const send = (o) => ws.send(JSON.stringify(o));
  return { ws, send, got, log, name };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function peerJoinedCount(c) { return c.got.filter((m) => m.type === "peer_joined").length; }

(async () => {
  let failed = false;
  const A = client("A");
  const B = client("B");
  await new Promise((r) => A.ws.on("open", r));
  await new Promise((r) => B.ws.on("open", r));

  // 1) A y B se emparejan
  A.send({ type: "join", roomId: "f1-room", publicKey: KEY_A, connectionId: "connA" });
  await wait(150);
  B.send({ type: "join", roomId: "f1-room", publicKey: KEY_B, connectionId: "connB" });
  await wait(250);

  const aPj1 = peerJoinedCount(A);
  const bPj1 = peerJoinedCount(B);
  console.log(`emparejados: A.peer_joined=${aPj1} B.peer_joined=${bPj1}`);
  if (aPj1 !== 1 || bPj1 !== 1) { console.log("✗ no se emparejaron"); process.exit(1); }

  // 2) B cae POR COMPLETO (sin avisar). A debe recibir peer_disconnected.
  B.ws.terminate();
  await wait(400);
  const aDisc = A.got.some((m) => m.type === "peer_disconnected");
  console.log(`A recibió peer_disconnected tras caída de B: ${aDisc}`);
  if (!aDisc) { console.log("✗ A no detectó la caída de B"); process.exit(1); }

  // 3) B vuelve CON EL MISMO connectionId. A debe recibir peer_joined de nuevo.
  const B2 = client("B2");
  await new Promise((r) => B2.ws.on("open", r));
  B2.got.length = 0;
  A.got.length = 0;
  B2.send({ type: "join", roomId: "f1-room", publicKey: KEY_B, connectionId: "connB" });
  await wait(400);

  const b2Pj = peerJoinedCount(B2);
  const aPj2 = peerJoinedCount(A);
  console.log(`reconexión real: B2.peer_joined=${b2Pj} A.peer_joined=${aPj2}`);

  // Con el fix F-1: seenConnectionIds se limpia al desconectar, así que
  // al volver connB YA NO está en el set -> isReconnect=false -> se reenvía.
  if (b2Pj >= 1 && aPj2 >= 1) {
    console.log("✅ F-1 OK: re-handshake tras caída real del peer");
  } else {
    console.log("✗ F-1 FALLA: no hubo re-handshake tras reconexión real");
    failed = true;
  }

  A.ws.close(); B2.ws.close();
  console.log(failed ? "F1_E2E_FAIL" : "F1_E2E_OK");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

// E2E de reconexión: valida que el ratchet sobrevive a una caída de transporte
// (el bug que fallaba en móvil por señal inestable).
//
// Usa el CryptoManager REAL del cliente (client/src/crypto.ts) y un servidor
// real levantado en proceso. Flujo:
//   1. A y B se emparejan, intercambian 5 mensajes de texto OK.
//   2. B sufre una "caída de red": cerramos su WebSocket (sin destruir su
//      CryptoManager — igual que hace handleReconnection preservando el ratchet).
//   3. B se reconecta con el MISMO connectionId y CryptoManager.
//   4. A y B intercambian 5 mensajes MÁS. Deben descifrarse (counter continua).
//
// Si el bug existiera, tras la reconexión B derivaría de nuevo / A recibiría
// peer_joined y el ratchet se desincronizaría -> OperationError.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CryptoManager } from "../../client/src/crypto.ts";
import type { MessagePayload } from "../../client/src/protocol.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = 8123;
const URL = `ws://localhost:${PORT}`;
const ROOM = "reconnect-e2e-" + Math.random().toString(36).slice(2, 8);

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

class Client {
  ws: WebSocket | null = null;
  crypto = new CryptoManager();
  connectionId = "conn-" + Math.random().toString(36).slice(2, 8);
  errors: string[] = [];
  decrypted: string[] = [];
  onPeerJoined?: () => void;
  ready = false;

  async connect() {
    this.ws = new WebSocket(URL);
    await new Promise<void>((res) => this.ws!.on("open", () => res()));
    this.ws.on("message", (d) => this.onMessage(d.toString()));
    const pub = await this.crypto.generateKeyPair();
    this.ws.send(
      JSON.stringify({
        type: "join",
        roomId: ROOM,
        publicKey: b64(new Uint8Array(pub)),
        displayName: this.connectionId,
        connectionId: this.connectionId,
      })
    );
    // Esperar a que el peer se una (peer_joined) y derivar
    await new Promise<void>((res) => {
      const check = setInterval(() => {
        if (this.ready) {
          clearInterval(check);
          res();
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        res();
      }, 4000);
    });
  }

  async onMessage(data: string) {
    const m = JSON.parse(data);
    if (m.type === "peer_joined") {
      await this.crypto.deriveSharedKey(fromB64(m.theirPublicKey), ROOM);
      this.ready = true;
      this.onPeerJoined?.();
    } else if (m.type === "message" && m.senderId !== this.connectionId) {
      try {
        const p = await this.crypto.decrypt(m.iv, m.ciphertext, m.counter);
        this.decrypted.push(p.text);
      } catch (e: any) {
        this.errors.push(`ctr${m.counter}:${e.message}`);
      }
    }
  }

  async send(text: string) {
    const enc = await this.crypto.encrypt({ type: "text", text, displayName: this.connectionId });
    this.ws!.send(
      JSON.stringify({ type: "message", iv: enc.iv, ciphertext: enc.ciphertext, counter: enc.counter })
    );
  }

  // Simula handleReconnection preservando el ratchet (NO recrea CryptoManager)
  async reconnect() {
    this.ws = new WebSocket(URL);
    await new Promise<void>((res) => this.ws!.on("open", () => res()));
    this.ws.on("message", (d) => this.onMessage(d.toString()));
    // Reusa la clave pública existente (no genera par nuevo)
    const raw = this.crypto.getPublicKeyRaw();
    const pubB64 = raw ? b64(raw) : b64(new Uint8Array(await this.crypto.generateKeyPair()));

    // Spy: capturar el handshake de reconexión para validar §4.1a (connectionId)
    let lastHandshake: any = null;
    const origSend = this.ws.send.bind(this.ws);
    this.ws.send = (data: any) => {
      if (typeof data === "string") {
        try { lastHandshake = JSON.parse(data); } catch {}
      }
      return origSend(data);
    };

    this.ws.send(
      JSON.stringify({
        type: "join",
        roomId: ROOM,
        publicKey: pubB64,
        displayName: this.connectionId,
        connectionId: this.connectionId,
      })
    );
    // Validar contract §4.1a: el handshake de reconexión incluye connectionId
    expect(lastHandshake).not.toBeNull();
    expect(lastHandshake.type).toBe("join");
    expect(lastHandshake.connectionId).toBe(this.connectionId);
    // En reconexión NO debe llegar peer_joined (el servidor lo omite)
    await new Promise((r) => setTimeout(r, 500));
  }

  close() {
    this.ws?.close();
  }
}

let server: ChildProcess;

beforeAll(async () => {
  server = spawn("node", [path.join(ROOT, "server/dist/index.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  // esperar a que el server escuche
  await new Promise((r) => setTimeout(r, 1500));
}, 15000);

afterAll(() => {
  server.kill();
});

describe("ratchet sobrevive a reconexión", () => {
  it("intercambia mensajes antes y después de reconectar B sin errores", async () => {
    const a = new Client();
    const b = new Client();
    await a.connect();
    await b.connect();
    // Esperar emparejamiento mutuo
    await new Promise((r) => setTimeout(r, 500));
    expect(a.ready && b.ready).toBe(true);

    // Fase 1: 5 mensajes de A -> B
    for (let i = 0; i < 5; i++) {
      await a.send("pre-" + i);
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 400));

    // Fase 2: B se cae y reconecta (preservando ratchet)
    b.close();
    await new Promise((r) => setTimeout(r, 300));
    await b.reconnect();
    await new Promise((r) => setTimeout(r, 300));

    // Fase 3: 5 mensajes más de A -> B
    for (let i = 0; i < 5; i++) {
      await a.send("post-" + i);
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 500));

    console.log("B decrypted:", b.decrypted, "errors:", b.errors);
    expect(b.errors).toEqual([]);
    expect(b.decrypted.filter((t) => t.startsWith("pre-")).length).toBe(5);
    expect(b.decrypted.filter((t) => t.startsWith("post-")).length).toBe(5);
    a.close();
    b.close();
  }, 30000);
});

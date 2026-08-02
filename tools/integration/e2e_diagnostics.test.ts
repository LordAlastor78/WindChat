// E2E del panel de diagnóstico: monta un ChatClient real contra el server,
// se empareja, y verifica que runDiagnostics produce un reporte coherente
// (sin FAIL críticos cuando la sesión está sana).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ChatClient from "../../client/src/websocket.ts";
import { runDiagnostics } from "../../client/src/diagnostics.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = 8124;
const URL_ = `ws://localhost:${PORT}`;
const ROOM = "diag-e2e-" + Math.random().toString(36).slice(2, 8);

let server: ChildProcess;
let aReady = false;

beforeAll(async () => {
  server = spawn("node", [path.join(ROOT, "server/dist/index.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  // Emparejar A y B en la MISMA room para que A reciba peer_joined
  const a = new ChatClient({ onPeerJoined: () => { aReady = true; } });
  const b = new ChatClient({});
  (globalThis as any).__a = a;
  (globalThis as any).__b = b;
  a.connect(URL_, ROOM);
  b.connect(URL_, ROOM);
  await new Promise((r) => setTimeout(r, 3000));
}, 15000);

afterAll(() => {
  (globalThis as any).__a?.disconnect();
  (globalThis as any).__b?.disconnect();
  server.kill();
});

describe("panel de diagnóstico", () => {
  it("genera un reporte sin fallos críticos en sesión sana", async () => {
    expect(aReady).toBe(true);
    const a = (globalThis as any).__a as ChatClient;
    const report = await runDiagnostics(a);
    console.log(report);
    expect(report).toContain("=== CHECKS ===");
    expect(report).toContain("Ratchet E2EE");
    expect(report).toContain("WebCrypto");
    expect(report).toMatch(/FAIL: 0/);
    expect(report).not.toMatch(/FAIL: [1-9]/);
  }, 20000);
});

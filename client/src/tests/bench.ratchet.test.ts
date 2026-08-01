/**
 * Benchmark del ratchet ejecutado dentro de Vitest (aprovecha la resolución
 * de imports del proyecto). Imprime latencia/throughput reales.
 *
 * Uso: npx vitest run -c client/vitest.config.ts client/src/tests/bench.ratchet.test.ts
 */
import { describe, it } from "vitest";
import CryptoManager from "../crypto.js";

async function paired() {
  const a = new CryptoManager();
  const b = new CryptoManager();
  const apub = await a.generateKeyPair();
  const bpub = await b.generateKeyPair();
  await a.deriveSharedKey(bpub, "bench");
  await b.deriveSharedKey(apub, "bench");
  return { a, b };
}

describe("Ratchet benchmark", () => {
  it("rendimiento en orden y fuera de orden", async () => {
    const N = 1500;
    const { a, b } = await paired();

    for (let i = 0; i < 50; i++) {
      const e = await a.encrypt("warmup");
      await b.decrypt(e.iv, e.ciphertext, e.counter);
    }

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const e = await a.encrypt(`msg ${i}`);
      const d = await b.decrypt(e.iv, e.ciphertext, e.counter);
      if (d.text !== `msg ${i}`) throw new Error("bad decrypt");
    }
    const seq = performance.now() - t0;

    // Fuera de orden con un salto acotado (<= MAX_RATCHET_SKIP) para medir el
    // coste real de avanzar la cadena y guardar claves intermedias.
    const gap = 200;
    const msgs = [];
    for (let i = 0; i < gap; i++) msgs.push(await a.encrypt(`ooo ${i}`));
    const t2 = performance.now();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const d = await b.decrypt(msgs[i].iv, msgs[i].ciphertext, msgs[i].counter);
      if (d.text !== `ooo ${i}`) throw new Error("bad ooo");
    }
    const ooo = performance.now() - t2;

    console.log("\n=== Ratchet benchmark ===");
    console.log(`Mensajes/escenario : ${N}`);
    console.log(`En orden   : ${seq.toFixed(1)} ms  (${(N / (seq / 1000)).toFixed(0)} msg/s, ${(seq / N * 1000).toFixed(1)} µs/msg)`);
    console.log(`Fuera ord. : ${ooo.toFixed(1)} ms  (${(gap / (ooo / 1000)).toFixed(0)} msg/s) [salto=${gap}]`);
    console.log(`Skipped    : ${b.getSkippedKeyCount()}`);
  }, 30000);
});

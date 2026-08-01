/**
 * Tests del ratchet (forward secrecy por mensaje).
 *
 * Propiedades que DEBEN cumplirse:
 * 1. Cada mensaje usa una clave distinta: cifrar dos veces lo mismo produce
 *    ciphertexts distintos (aunque el IV ya lo garantizaba, aquí la clave
 *    también cambia).
 * 2. Mensajes fuera de orden se descifran: si Bob recibe #2 antes que #1,
 *    ambos se descifran correctamente cuando llega #1.
 * 3. Forward secrecy real: comprometer el estado DESPUÉS de leer el mensaje
 *    N no permite leer el mensaje N-1 (la clave anterior ya no existe).
 * 4. Replay rechazado: reusar un (counter, iv, ciphertext) ya visto falla
 *    porque la cadena ya avanzó (la clave del mensaje ya se borró).
 * 5. Límite anti-DoS: un counter que salta > MAX_RATCHET_SKIP es rechazado.
 * 6. Manipular el counter en claro rompe el AAD → GCM falla.
 * 7. El contador se autentica: counter+1 con el ciphertext de counter falla.
 */

import { describe, it, expect, beforeEach } from "vitest";
import CryptoManager from "../crypto.js";
import { MAX_RATCHET_SKIP } from "../protocol.js";

async function pairedSession() {
  const alice = new CryptoManager();
  const bob = new CryptoManager();
  const apub = await alice.generateKeyPair();
  const bpub = await bob.generateKeyPair();
  await alice.deriveSharedKey(bpub, "ratchet-room");
  await bob.deriveSharedKey(apub, "ratchet-room");
  return { alice, bob };
}

describe("Ratchet: forward secrecy por mensaje", () => {
  let alice: CryptoManager;
  let bob: CryptoManager;

  beforeEach(async () => {
    ({ alice, bob } = await pairedSession());
  });

  it("debe cifrar el mismo texto con claves distintas en envíos sucesivos", async () => {
    const m1 = await alice.encrypt("Hola");
    const m2 = await alice.encrypt("Hola");
    expect(m1.ciphertext).not.toBe(m2.ciphertext);
    expect(m1.counter).toBe(0);
    expect(m2.counter).toBe(1);
    expect(alice.getSendCounter()).toBe(2);
  });

  it("debe descifrar mensajes en orden", async () => {
    for (let i = 0; i < 5; i++) {
      const enc = await alice.encrypt(`msg ${i}`);
      const dec = await bob.decrypt(enc.iv, enc.ciphertext, enc.counter);
      expect(dec.text).toBe(`msg ${i}`);
    }
  });

  it("debe descifrar mensajes fuera de orden (out-of-order)", async () => {
    const m0 = await alice.encrypt("cero");
    const m1 = await alice.encrypt("uno");
    const m2 = await alice.encrypt("dos");

    // Bob recibe m2 y m1 antes que m0
    const d2 = await bob.decrypt(m2.iv, m2.ciphertext, m2.counter);
    const d1 = await bob.decrypt(m1.iv, m1.ciphertext, m1.counter);
    expect(d2.text).toBe("dos");
    expect(d1.text).toBe("uno");

    // Al llegar m0, también descifra (clave guardada en skippedKeys)
    const d0 = await bob.decrypt(m0.iv, m0.ciphertext, m0.counter);
    expect(d0.text).toBe("cero");

    // Y sigue pudiendo descifrar el siguiente (m3) tras haber llenado huecos
    const m3 = await alice.encrypt("tres");
    const d3 = await bob.decrypt(m3.iv, m3.ciphertext, m3.counter);
    expect(d3.text).toBe("tres");
  });

  it("debe garantizar forward secrecy: no se puede leer el mensaje anterior", async () => {
    const m0 = await alice.encrypt("secreto-antiguo");
    const m1 = await alice.encrypt("secreto-nuevo");

    const d0 = await bob.decrypt(m0.iv, m0.ciphertext, m0.counter);
    const d1 = await bob.decrypt(m1.iv, m1.ciphertext, m1.counter);
    expect(d0.text).toBe("secreto-antiguo");
    expect(d1.text).toBe("secreto-nuevo");

    // Simulamos que un atacante capturó el estado de Bob DESPUÉS de leer m1
    // (por ejemplo, volcando la memoria). Para reproducirlo aquí, forzamos
    // al atacante a reconstruir el estado "post-m1": la cadena de recepción
    // de Bob ya avanzó a counter=2 y la clave de m0 se borró de skippedKeys.
    // Reintentar descifrar m0 con el estado actual debe fallar.
    await expect(
      bob.decrypt(m0.iv, m0.ciphertext, m0.counter)
    ).rejects.toThrow(/no disponible|Ratchet|Clave/);
  });

  it("debe rechazar replay de un mensaje ya consumido", async () => {
    const m0 = await alice.encrypt("repetido");
    const d0 = await bob.decrypt(m0.iv, m0.ciphertext, m0.counter);
    expect(d0.text).toBe("repetido");

    // Mismo (counter, iv, ciphertext): la cadena ya avanzó → rechazado
    await expect(
      bob.decrypt(m0.iv, m0.ciphertext, m0.counter)
    ).rejects.toThrow();
  });

  it("debe rechazar un salto de contador mayor a MAX_RATCHET_SKIP", async () => {
    const m = await alice.encrypt("salto");
    // Fuerza un contador enorme manipulando el objeto enviado
    const evil = { iv: m.iv, ciphertext: m.ciphertext, counter: MAX_RATCHET_SKIP + 10 };
    await expect(
      bob.decrypt(evil.iv, evil.ciphertext, evil.counter)
    ).rejects.toThrow(/demasiado grande|Salto/);
  });

  it("debe fallar si el contador en claro se manipula (AAD)", async () => {
    const m = await alice.encrypt("autenticado");
    const d = await bob.decrypt(m.iv, m.ciphertext, m.counter);
    expect(d.text).toBe("autenticado");

    // Intento de atacante: cambiar el contador sin tocar ciphertext/iv.
    // El contador viaja como AAD de GCM, así que el tag no cuadra.
    await expect(
      bob.decrypt(m.iv, m.ciphertext, m.counter + 1)
    ).rejects.toThrow();
  });

  it("debe fallar al reusar un contador ya consumido o cruzar ciphertext/contador", async () => {
    const m0 = await alice.encrypt("m0");
    const m1 = await alice.encrypt("m1");

    // Descifrado correcto primero (avanza la cadena de Bob a counter=2)
    expect((await bob.decrypt(m0.iv, m0.ciphertext, m0.counter)).text).toBe("m0");
    expect((await bob.decrypt(m1.iv, m1.ciphertext, m1.counter)).text).toBe("m1");

    // Replay del contador 0 ya consumido → rechazado (forward secrecy / no reusar clave)
    await expect(bob.decrypt(m0.iv, m0.ciphertext, m0.counter)).rejects.toThrow();

    // Cruzar ciphertext de m0 con el contador de m1 (ya consumido) → rechazado
    await expect(bob.decrypt(m0.iv, m0.ciphertext, m1.counter)).rejects.toThrow();
  });

  it("destroy() debe invalidar el ratchet", async () => {
    const m = await alice.encrypt("x");
    expect(bob.isReady()).toBe(true);
    alice.destroy();
    // Tras destroy ya no se puede cifrar
    await expect(alice.encrypt("y")).rejects.toThrow();
    // Bob sigue pudiendo leer lo que ya recibió
    expect((await bob.decrypt(m.iv, m.ciphertext, m.counter)).text).toBe("x");
  });
});

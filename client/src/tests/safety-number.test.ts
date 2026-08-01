/**
 * Tests para el Safety Number (SAS) — verificación anti-MITM.
 *
 * Propiedades que DEBEN cumplirse:
 * 1. Ambos extremos legítimos derivan el MISMO SAS (orden canónico de claves).
 * 2. Un MITM (servidor que hace doble handshake) produce SAS DISTINTOS.
 * 3. El SAS depende del roomId (separación de dominio).
 * 4. Formato estable: 6 grupos de 5 dígitos + 5 emojis.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import CryptoManager from '../crypto';

/** Genera un par listo y devuelve el manager + su clave pública raw */
async function makePeer(): Promise<{ mgr: CryptoManager; pub: ArrayBuffer }> {
  const mgr = new CryptoManager();
  const pub = await mgr.generateKeyPair();
  return { mgr, pub };
}

describe('Safety Number (SAS) - anti-MITM', () => {
  let alice: { mgr: CryptoManager; pub: ArrayBuffer };
  let bob: { mgr: CryptoManager; pub: ArrayBuffer };

  beforeEach(async () => {
    alice = await makePeer();
    bob = await makePeer();
  });

  it('no existe antes de derivar la clave compartida', async () => {
    const fresh = new CryptoManager();
    expect(fresh.getSafetyNumber()).toBeUndefined();

    await fresh.generateKeyPair();
    expect(fresh.getSafetyNumber()).toBeUndefined();
  });

  it('ambos extremos legítimos obtienen EXACTAMENTE el mismo SAS', async () => {
    const roomId = 'sala-de-pruebas-123';

    await alice.mgr.deriveSharedKey(bob.pub, roomId);
    await bob.mgr.deriveSharedKey(alice.pub, roomId);

    const sasA = alice.mgr.getSafetyNumber();
    const sasB = bob.mgr.getSafetyNumber();

    expect(sasA).toBeDefined();
    expect(sasB).toBeDefined();
    expect(sasA!.digits).toBe(sasB!.digits);
    expect(sasA!.emojis).toEqual(sasB!.emojis);
    expect(sasA!.hex).toBe(sasB!.hex);
  });

  it('detecta un MITM: el servidor interpone su propia clave con cada lado', async () => {
    const roomId = 'sala-interceptada';
    const mallory = await makePeer();

    // Alice cree hablar con Bob, pero recibe la clave de Mallory
    await alice.mgr.deriveSharedKey(mallory.pub, roomId);
    // Bob cree hablar con Alice, pero también recibe la de Mallory
    await bob.mgr.deriveSharedKey(mallory.pub, roomId);

    const sasA = alice.mgr.getSafetyNumber()!;
    const sasB = bob.mgr.getSafetyNumber()!;

    // Esta es LA propiedad de seguridad: los códigos no coinciden,
    // así que los usuarios detectan la interceptación al compararlos.
    expect(sasA.digits).not.toBe(sasB.digits);
    expect(sasA.hex).not.toBe(sasB.hex);
  });

  it('el SAS cambia si cambia el roomId (separación de dominio)', async () => {
    const a2 = await makePeer();
    const b2 = await makePeer();

    await alice.mgr.deriveSharedKey(bob.pub, 'sala-A');
    await a2.mgr.deriveSharedKey(b2.pub, 'sala-B');

    expect(alice.mgr.getSafetyNumber()!.digits).not.toBe(
      a2.mgr.getSafetyNumber()!.digits
    );
  });

  it('el SAS cambia con claves distintas en la misma sala', async () => {
    const roomId = 'misma-sala';
    const otro = await makePeer();

    await alice.mgr.deriveSharedKey(bob.pub, roomId);
    const primero = alice.mgr.getSafetyNumber()!.digits;

    const alice2 = await makePeer();
    await alice2.mgr.deriveSharedKey(otro.pub, roomId);
    const segundo = alice2.mgr.getSafetyNumber()!.digits;

    expect(primero).not.toBe(segundo);
  });

  it('formato: 6 grupos de 5 dígitos', async () => {
    await alice.mgr.deriveSharedKey(bob.pub, 'formato');
    const { digits } = alice.mgr.getSafetyNumber()!;

    expect(digits).toMatch(/^\d{5}( \d{5}){5}$/);
    expect(digits.split(' ')).toHaveLength(6);
  });

  it('formato: 5 emojis y hex de 8 bytes', async () => {
    await alice.mgr.deriveSharedKey(bob.pub, 'formato');
    const sas = alice.mgr.getSafetyNumber()!;

    expect(sas.emojis).toHaveLength(5);
    sas.emojis.forEach((e) => expect(e.length).toBeGreaterThan(0));

    // 16 hex chars en 4 grupos de 4
    expect(sas.hex).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
  });

  it('destroy() borra el safety number', async () => {
    await alice.mgr.deriveSharedKey(bob.pub, 'sala');
    expect(alice.mgr.getSafetyNumber()).toBeDefined();

    alice.mgr.destroy();
    expect(alice.mgr.getSafetyNumber()).toBeUndefined();
  });

  it('es determinista: misma entrada → mismo SAS', async () => {
    const roomId = 'determinista';

    await alice.mgr.deriveSharedKey(bob.pub, roomId);
    const primera = alice.mgr.getSafetyNumber()!.digits;

    // Recalcular con las mismas claves en un manager nuevo no es posible
    // (la privada no se exporta), pero el peer opuesto sí debe coincidir.
    await bob.mgr.deriveSharedKey(alice.pub, roomId);
    expect(bob.mgr.getSafetyNumber()!.digits).toBe(primera);
  });
});

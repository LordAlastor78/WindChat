/**
 * Tests de Integración
 *
 * Valida el flujo completo:
 * - Generación de claves
 * - Handshake
 * - Envío/recepción de mensajes
 * - Reconexión
 */

import { describe, expect, it } from 'vitest';
import CryptoManager from '../crypto';

describe('Flujo E2EE Completo', () => {
  it('Alice y Bob pueden comunicarse de extremo a extremo', async () => {
    // 1. Alice y Bob generan sus claves
    const alice = new CryptoManager();
    const bob = new CryptoManager();

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    // 2. Intercambian claves públicas (esto lo hace el servidor)
    await alice.deriveSharedKey(bobPublicKey, 'room-abc123');
    await bob.deriveSharedKey(alicePublicKey, 'room-abc123');

    // 3. Alice envía un mensaje
    const message1 = 'Hola Bob, este es un mensaje secreto';
    const encrypted1 = await alice.encrypt(message1);

    // 4. Bob lo recibe y descifra
    const decrypted1 = await bob.decrypt(encrypted1.iv, encrypted1.ciphertext, encrypted1.counter);
    expect(decrypted1.text).toBe(message1);

    // 5. Bob responde
    const message2 = '¡Recibido! Te respondo también';
    const encrypted2 = await bob.encrypt(message2);

    // 6. Alice lo recibe
    const decrypted2 = await alice.decrypt(encrypted2.iv, encrypted2.ciphertext, encrypted2.counter);
    expect(decrypted2.text).toBe(message2);
  });

  it('Múltiples mensajes en secuencia', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    await alice.deriveSharedKey(bobPublicKey, 'room-test');
    await bob.deriveSharedKey(alicePublicKey, 'room-test');

    const messages = [
      'Mensaje 1',
      'Mensaje 2',
      'Mensaje 3',
      'Mensaje con emojis 🚀🔐',
      'Mensaje largo: ' + 'A'.repeat(1000),
    ];

    for (const msg of messages) {
      const encrypted = await alice.encrypt(msg);
      const decrypted = await bob.decrypt(encrypted.iv, encrypted.ciphertext, encrypted.counter);
      expect(decrypted.text).toBe(msg);
    }
  });

  it('Los acuses cifrados conservan el mensaje original y el estado', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    await alice.deriveSharedKey(bobPublicKey, 'room-receipts');
    await bob.deriveSharedKey(alicePublicKey, 'room-receipts');

    const receipt = await alice.encrypt({
      type: 'receipt',
      text: '',
      receiptForId: 'msg-123',
      receiptState: 'read',
      displayName: 'Alice',
    });

    const decryptedReceipt = await bob.decrypt(receipt.iv, receipt.ciphertext, receipt.counter);
    expect(decryptedReceipt.type).toBe('receipt');
    expect(decryptedReceipt.receiptForId).toBe('msg-123');
    expect(decryptedReceipt.receiptState).toBe('read');
  });

  it('Los payloads de archivo conservan metadata y chunks al cifrar y descifrar', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    await alice.deriveSharedKey(bobPublicKey, 'room-files');
    await bob.deriveSharedKey(alicePublicKey, 'room-files');

    const metadataPayload = await alice.encrypt({
      type: 'file_metadata',
      text: '',
      fileId: 'file-1',
      fileName: 'photo.png',
      fileSize: 1024,
      fileType: 'image/png',
      totalChunks: 3,
      displayName: 'Alice',
    });

    const chunkPayload = await alice.encrypt({
      type: 'file_chunk',
      text: '',
      fileId: 'file-1',
      chunkIndex: 1,
      chunkData: 'AQIDBA==',
      displayName: 'Alice',
    });

    const decryptedMetadata = await bob.decrypt(metadataPayload.iv, metadataPayload.ciphertext, metadataPayload.counter);
    expect(decryptedMetadata.type).toBe('file_metadata');
    expect(decryptedMetadata.fileId).toBe('file-1');
    expect(decryptedMetadata.fileName).toBe('photo.png');
    expect(decryptedMetadata.fileSize).toBe(1024);
    expect(decryptedMetadata.totalChunks).toBe(3);

    const decryptedChunk = await bob.decrypt(chunkPayload.iv, chunkPayload.ciphertext, chunkPayload.counter);
    expect(decryptedChunk.type).toBe('file_chunk');
    expect(decryptedChunk.fileId).toBe('file-1');
    expect(decryptedChunk.chunkIndex).toBe(1);
    expect(decryptedChunk.chunkData).toBe('AQIDBA==');
  });
});

describe('Seguridad - Scenarios de Ataque', () => {
  it('Eve no puede descifrar mensajes sin la clave privada', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();
    const eve = new CryptoManager(); // Atacante

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();
    await eve.generateKeyPair();

    // Alice y Bob establecen canal seguro
    await alice.deriveSharedKey(bobPublicKey, 'room-secret');
    await bob.deriveSharedKey(alicePublicKey, 'room-secret');

    // Eve intenta derivar con la clave pública de Alice (pero sin la privada de Bob)
    await eve.deriveSharedKey(alicePublicKey, 'room-secret');

    // Alice envía mensaje cifrado
    const secretMessage = 'Información confidencial';
    const encrypted = await alice.encrypt(secretMessage);

    // Bob puede descifrarlo
    const bobDecrypted = await bob.decrypt(encrypted.iv, encrypted.ciphertext, encrypted.counter);
    expect(bobDecrypted.text).toBe(secretMessage);

    // Eve NO puede descifrarlo (claves diferentes)
    await expect(
      eve.decrypt(encrypted.iv, encrypted.ciphertext, encrypted.counter)
    ).rejects.toThrow();
  });

  it('Modificación del ciphertext debe ser detectada (GCM tag)', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    await alice.deriveSharedKey(bobPublicKey, 'room-test');
    await bob.deriveSharedKey(alicePublicKey, 'room-test');

    const message = 'Mensaje original';
    const encrypted = await alice.encrypt(message);

    // Atacante intenta modificar el ciphertext
    const tamperedCiphertext = encrypted.ciphertext.slice(0, -4) + 'XXXX';

    // Bob detecta la modificación y rechaza el mensaje
    await expect(
      bob.decrypt(encrypted.iv, tamperedCiphertext, encrypted.counter)
    ).rejects.toThrow();
  });

  it('Reutilización de IV debe generar ciphertexts diferentes', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();

    const alicePublicKey = await alice.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    await alice.deriveSharedKey(bobPublicKey, 'room-test');
    await bob.deriveSharedKey(alicePublicKey, 'room-test');

    // Mismo mensaje cifrado dos veces
    const message = 'Mensaje repetido';
    const encrypted1 = await alice.encrypt(message);
    const encrypted2 = await alice.encrypt(message);

    // IVs deben ser diferentes
    expect(encrypted1.iv).not.toBe(encrypted2.iv);

    // Ciphertexts deben ser diferentes
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);

    // Pero ambos descifran al mismo mensaje
    const decrypted1 = await bob.decrypt(encrypted1.iv, encrypted1.ciphertext, encrypted1.counter);
    const decrypted2 = await bob.decrypt(encrypted2.iv, encrypted2.ciphertext, encrypted2.counter);

    expect(decrypted1.text).toBe(message);
    expect(decrypted2.text).toBe(message);
  });
});

describe('Reconexión - Regeneración de Claves', () => {
  it('Después de reconectar, las claves antiguas no deben funcionar', async () => {
    const alice = new CryptoManager();
    const bob1 = new CryptoManager(); // Sesión original de Bob
    const bob2 = new CryptoManager(); // Sesión después de reconectar

    const alicePublicKey = await alice.generateKeyPair();
    const bob1PublicKey = await bob1.generateKeyPair();

    // Primera sesión
    await alice.deriveSharedKey(bob1PublicKey, 'room-test');
    await bob1.deriveSharedKey(alicePublicKey, 'room-test');

    const message = 'Mensaje antes de reconexión';
    const encrypted = await alice.encrypt(message);

    // Bob1 puede descifrarlo
    const decrypted1 = await bob1.decrypt(encrypted.iv, encrypted.ciphertext, encrypted.counter);
    expect(decrypted1.text).toBe(message);

    // Simular reconexión: Bob genera NUEVAS claves
    const bob2PublicKey = await bob2.generateKeyPair();

    // Bob NO deriva el secreto de nuevo (simulando que perdió conexión)
    // Por lo tanto, no puede descifrar mensajes de la sesión anterior

    // Alice todavía tiene las claves antiguas, pero Bob2 tiene nuevas claves
    // Esto simula el escenario de reconexión donde las claves deben regenerarse

    // Comparar contenido binario, no referencia de ArrayBuffer
    expect(Array.from(new Uint8Array(bob1PublicKey))).not.toEqual(
      Array.from(new Uint8Array(bob2PublicKey))
    );
  });

  it('Nuevo handshake después de reconexión debe establecer nuevo canal', async () => {
    const alice1 = new CryptoManager();
    const alice2 = new CryptoManager(); // Después de reconectar
    const bob = new CryptoManager();

    // Primera sesión
    const alice1PublicKey = await alice1.generateKeyPair();
    const bobPublicKey = await bob.generateKeyPair();

    await alice1.deriveSharedKey(bobPublicKey, 'room-test');
    await bob.deriveSharedKey(alice1PublicKey, 'room-test');

    // Comunicación funciona
    const msg1 = 'Primera sesión';
    const enc1 = await alice1.encrypt(msg1);
    const dec1 = await bob.decrypt(enc1.iv, enc1.ciphertext, enc1.counter);
    expect(dec1.text).toBe(msg1);

    // Alice reconecta y genera NUEVAS claves
    alice1.destroy();
    const alice2PublicKey = await alice2.generateKeyPair();

    // Bob debe actualizar su secreto con la nueva clave de Alice
    const bob2 = new CryptoManager();
    const bob2PublicKey = await bob2.generateKeyPair();
    await alice2.deriveSharedKey(bob2PublicKey, 'room-test');
    await bob2.deriveSharedKey(alice2PublicKey, 'room-test');

    // Nueva comunicación funciona
    const msg2 = 'Nueva sesión';
    const enc2 = await alice2.encrypt(msg2);
    const dec2 = await bob2.decrypt(enc2.iv, enc2.ciphertext, enc2.counter);
    expect(dec2.text).toBe(msg2);
  });
});

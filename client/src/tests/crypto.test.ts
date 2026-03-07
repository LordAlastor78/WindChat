/**
 * Tests para CryptoManager
 * 
 * Valida:
 * - Generación de claves ECDH P-256
 * - Derivación de secreto compartido
 * - Cifrado/descifrado con AES-256-GCM
 * - Validación de tamaño de claves
 * - Manejo de errores
 */

import { describe, it, expect, beforeEach } from 'vitest';
import CryptoManager from '../crypto';

describe('CryptoManager', () => {
  let crypto1: CryptoManager;
  let crypto2: CryptoManager;

  beforeEach(() => {
    crypto1 = new CryptoManager();
    crypto2 = new CryptoManager();
  });

  describe('Generación de Claves', () => {
    it('debe generar un par de claves ECDH P-256', async () => {
      const publicKey = await crypto1.generateKeyPair();
      
      expect(publicKey).toBeInstanceOf(ArrayBuffer);
      expect(publicKey.byteLength).toBe(65); // P-256 raw key: 1 + 32 + 32 bytes
    });

    it('debe generar claves únicas en cada llamada', async () => {
      const key1 = await crypto1.generateKeyPair();
      const key2 = await crypto1.generateKeyPair();
      
      const arr1 = new Uint8Array(key1);
      const arr2 = new Uint8Array(key2);
      
      expect(arr1).not.toEqual(arr2);
    });

    it('debe comenzar con 0x04 (formato uncompressed)', async () => {
      const publicKey = await crypto1.generateKeyPair();
      const firstByte = new Uint8Array(publicKey)[0];
      
      expect(firstByte).toBe(0x04);
    });
  });

  describe('Derivación de Secreto Compartido', () => {
    it('debe derivar el mismo secreto compartido desde ambos lados', async () => {
      // Alice y Bob generan sus claves
      const alicePublicKey = await crypto1.generateKeyPair();
      const bobPublicKey = await crypto2.generateKeyPair();
      
      // Derivan secretos compartidos
      await crypto1.deriveSharedKey(bobPublicKey, 'test-room-123');
      await crypto2.deriveSharedKey(alicePublicKey, 'test-room-123');
      
      // Cifrar un mensaje desde Alice
      const message = 'Hola Bob';
      const encrypted = await crypto1.encrypt(message);
      
      // Bob debe poder descifrarlo
      const decrypted = await crypto2.decrypt(encrypted.iv, encrypted.ciphertext);
      
      expect(decrypted.text).toBe(message);
    });

    it('debe generar secretos diferentes con roomIds diferentes', async () => {
      const alicePublicKey = await crypto1.generateKeyPair();
      const bobPublicKey = await crypto2.generateKeyPair();
      
      // Derivar con room diferente
      await crypto1.deriveSharedKey(bobPublicKey, 'room-A');
      await crypto2.deriveSharedKey(alicePublicKey, 'room-B'); // ¡roomId diferente!
      
      const message = 'Test';
      const encrypted = await crypto1.encrypt(message);
      
      // Bob NO debe poder descifrarlo (roomId diferente)
      await expect(
        crypto2.decrypt(encrypted.iv, encrypted.ciphertext)
      ).rejects.toThrow();
    });

    it('debe fallar con clave pública inválida (tamaño incorrecto)', async () => {
      await crypto1.generateKeyPair();
      
      const invalidKey = new ArrayBuffer(32); // Debería ser 65 bytes
      
      await expect(
        crypto1.deriveSharedKey(invalidKey, 'test-room')
      ).rejects.toThrow();
    });
  });

  describe('Cifrado y Descifrado', () => {
    beforeEach(async () => {
      // Setup: derivar secreto compartido
      const alicePublicKey = await crypto1.generateKeyPair();
      const bobPublicKey = await crypto2.generateKeyPair();
      
      await crypto1.deriveSharedKey(bobPublicKey, 'test-room');
      await crypto2.deriveSharedKey(alicePublicKey, 'test-room');
    });

    it('debe cifrar y descifrar correctamente un mensaje simple', async () => {
      const message = 'Hola Mundo';
      
      const encrypted = await crypto1.encrypt(message);
      const decrypted = await crypto2.decrypt(encrypted.iv, encrypted.ciphertext);
      
      expect(decrypted.text).toBe(message);
      expect(decrypted.timestamp).toBeGreaterThan(0);
    });

    it('debe cifrar mensajes largos correctamente', async () => {
      const message = 'A'.repeat(10000); // 10KB
      
      const encrypted = await crypto1.encrypt(message);
      const decrypted = await crypto2.decrypt(encrypted.iv, encrypted.ciphertext);
      
      expect(decrypted.text).toBe(message);
    });

    it('debe incluir timestamp en el payload cifrado', async () => {
      const before = Date.now();
      const encrypted = await crypto1.encrypt('Test');
      const after = Date.now();
      
      const decrypted = await crypto2.decrypt(encrypted.iv, encrypted.ciphertext);
      
      expect(decrypted.timestamp).toBeGreaterThanOrEqual(before);
      expect(decrypted.timestamp).toBeLessThanOrEqual(after);
    });

    it('debe preservar metadatos de reacción en payload estructurado', async () => {
      const encrypted = await crypto1.encrypt({
        id: 'msg-reaction-1',
        type: 'reaction',
        text: '👍',
        displayName: 'Alice',
        reactionToId: 'target-123',
      });

      const decrypted = await crypto2.decrypt(encrypted.iv, encrypted.ciphertext);

      expect(decrypted.id).toBe('msg-reaction-1');
      expect(decrypted.type).toBe('reaction');
      expect(decrypted.text).toBe('👍');
      expect(decrypted.displayName).toBe('Alice');
      expect(decrypted.reactionToId).toBe('target-123');
    });

    it('debe preservar replyToId en mensajes de texto', async () => {
      const encrypted = await crypto1.encrypt({
        id: 'msg-reply-1',
        type: 'text',
        text: 'Respuesta al mensaje',
        displayName: 'Bob',
        replyToId: 'parent-777',
      });

      const decrypted = await crypto2.decrypt(encrypted.iv, encrypted.ciphertext);

      expect(decrypted.id).toBe('msg-reply-1');
      expect(decrypted.type).toBe('text');
      expect(decrypted.text).toBe('Respuesta al mensaje');
      expect(decrypted.displayName).toBe('Bob');
      expect(decrypted.replyToId).toBe('parent-777');
    });

    it('debe generar IV único para cada mensaje', async () => {
      const encrypted1 = await crypto1.encrypt('Mensaje 1');
      const encrypted2 = await crypto1.encrypt('Mensaje 2');
      
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('debe fallar si el IV es modificado', async () => {
      const encrypted = await crypto1.encrypt('Test');
      
      // Modificar el IV
      const tamperedIV = encrypted.iv.split('').reverse().join('');
      
      await expect(
        crypto2.decrypt(tamperedIV, encrypted.ciphertext)
      ).rejects.toThrow();
    });

    it('debe fallar si el ciphertext es modificado', async () => {
      const encrypted = await crypto1.encrypt('Test');
      
      // Modificar el ciphertext
      const tamperedCiphertext = encrypted.ciphertext.split('').reverse().join('');
      
      await expect(
        crypto2.decrypt(encrypted.iv, tamperedCiphertext)
      ).rejects.toThrow();
    });

    it('debe fallar si no se ha derivado la clave compartida', async () => {
      const crypto3 = new CryptoManager();
      await crypto3.generateKeyPair();
      
      // Intentar cifrar sin derivar secreto
      await expect(
        crypto3.encrypt('Test')
      ).rejects.toThrow(/clave compartida no derivada/i);
    });
  });

  describe('Conversión Base64', () => {
    it('debe convertir ArrayBuffer a base64 y viceversa', async () => {
      const publicKey = await crypto1.generateKeyPair();
      
      // Convertir a base64 (esto se hace internamente en el código)
      const bytes = new Uint8Array(publicKey);
      const base64 = btoa(String.fromCharCode(...bytes));
      
      // Convertir de vuelta
      const binary = atob(base64);
      const resultBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        resultBytes[i] = binary.charCodeAt(i);
      }
      
      expect(resultBytes).toEqual(bytes);
    });
  });

  describe('Destrucción de Claves', () => {
    it('debe limpiar claves al llamar destroy()', async () => {
      await crypto1.generateKeyPair();
      const bobPublicKey = await crypto2.generateKeyPair();
      await crypto1.deriveSharedKey(bobPublicKey, 'test-room');
      
      // Cifrar funciona
      const encrypted = await crypto1.encrypt('Test');
      expect(encrypted).toBeDefined();
      
      // Destruir claves
      crypto1.destroy();
      
      // Intentar cifrar debe fallar
      await expect(
        crypto1.encrypt('Test')
      ).rejects.toThrow();
    });
  });
});

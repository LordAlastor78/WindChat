/**
 * Fase 0 — Test de regresión de integridad de archivos.
 *
 * Verifica que el FileManager:
 *  - divide un archivo en chunks y lo reensambla BYTE-A-BYTE idéntico,
 *  - respeta los límites de tamaño y tipo,
 *  - no rompe con archivos que no son múltiplo de FILE_CHUNK_SIZE.
 *
 * No toca red ni cripto: espejo local emisor -> receptor.
 */
import { describe, it, expect } from "vitest";
import FileManager from "../fileManager.js";
import { MAX_FILE_SIZE, FILE_CHUNK_SIZE } from "../protocol.js";

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) % 256; // patrón determinista
  return b;
}

async function makeFile(bytes: Uint8Array, type: string, name: string): Promise<File> {
  // FIX TS5.7: Uint8Array<ArrayBufferLike> no es assignable a BlobPart;
  // pasar el ArrayBuffer subyacente, clonado y casteado para TS.
  const src = bytes.buffer;
  const ab: ArrayBuffer = src instanceof ArrayBuffer
    ? (src.slice(0) as ArrayBuffer)
    : (src.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as unknown as ArrayBuffer);
  return new File([ab], name, { type });
}

/** Emisor prepara payloads; receptor los consume; devuelve el Blob reensamblado. */
async function roundTrip(src: File): Promise<{ blob: Blob; name: string; type: string }> {
  const sender = new FileManager();
  const { payloads } = await sender.prepareFileForSending(src);

  let result: { blob: Blob; name: string; type: string } | null = null;
  const receiver = new FileManager({
    onFileReady: (_fileId, file: File | Blob, meta) => {
      result = { blob: file, name: meta.name, type: meta.type };
    },
  });

  for (const p of payloads) receiver.handleIncomingFile(p);
  if (!result) throw new Error("onFileReady no fue llamado");
  return result;
}

async function blobsEqual(a: Blob, b: Uint8Array): Promise<boolean> {
  const ab = new Uint8Array(await a.arrayBuffer());
  if (ab.length !== b.length) return false;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== b[i]) return false;
  return true;
}

describe("FileManager — integridad de transferencia", () => {
  it("reensambla una imagen PNG byte-a-byte idéntica", async () => {
    const data = randomBytes(123456);
    const file = await makeFile(data, "image/png", "foto.png");
    const out = await roundTrip(file);
    expect(out.name).toBe("foto.png");
    expect(out.type).toBe("image/png");
    expect(await blobsEqual(out.blob, data)).toBe(true);
  });

  it("funciona con tamaño no múltiplo de chunk (resto parcial)", async () => {
    // 100 KB + 1 byte -> fuerza un chunk final parcial
    const data = randomBytes(FILE_CHUNK_SIZE + 1);
    const file = await makeFile(data, "application/pdf", "raro.pdf");
    const out = await roundTrip(file);
    expect(await blobsEqual(out.blob, data)).toBe(true);
  });

  it("funciona con múltiplo exacto de chunk", async () => {
    const data = randomBytes(FILE_CHUNK_SIZE * 3);
    const file = await makeFile(data, "application/pdf", "doc.pdf");
    const out = await roundTrip(file);
    expect(await blobsEqual(out.blob, data)).toBe(true);
  });

  it("rechaza archivos vacíos", () => {
    const file = new File([], "vacio.txt", { type: "text/plain" });
    const fm = new FileManager();
    expect(fm.validateFile(file).valid).toBe(false);
  });

  it("rechaza archivos mayores al límite", async () => {
    // FIX TS5.7: usar makeFile (helper async) en vez de new File([Uint8Array])
    const big = await makeFile(randomBytes(1024), "application/octet-stream", "x.bin");
    // trucar size para no reservar 50MB reales en memoria
    Object.defineProperty(big, "size", { value: MAX_FILE_SIZE + 1 });
    const fm = new FileManager();
    const r = fm.validateFile(big);
    expect(r.valid).toBe(false);
  });

  it("genera metadata + N chunks correctos", async () => {
    const data = randomBytes(FILE_CHUNK_SIZE * 2 + 123);
    const file = await makeFile(data, "image/jpeg", "a.jpg");
    const sender = new FileManager();
    const { payloads } = await sender.prepareFileForSending(file);
    const meta = payloads.find((p) => p.type === "file_metadata");
    const chunks = payloads.filter((p) => p.type === "file_chunk");
    expect(meta).toBeTruthy();
    expect(chunks.length).toBe(meta!.totalChunks);
    expect(chunks.every((c) => c.chunkIndex === chunks.indexOf(c))).toBe(true);
  });
});

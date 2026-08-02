/**
 * FileManager - Gestión de compartir archivos E2EE
 * 
 * Responsabilidades:
 * - Validar archivos seleccionados (tamaño, tipo)
 * - Dividir archivos en chunks
 * - Enviar metadata + chunks progresivamente
 * - Re-ensamblar chunks recibidos
 * - Generar URLs de descarga
 * - Callbacks para UI (progreso)
 */

import type { MessagePayload } from "./protocol.js";
import {
  ALLOWED_FILE_TYPES,
  FILE_CHUNK_SIZE,
  MAX_FILE_SIZE,
} from "./protocol.js";

export interface FileTransfer {
  id: string;
  name: string;
  size: number;
  type: string;
  totalChunks: number;
  chunks: Map<number, ArrayBuffer>; // chunkIndex → data
  receivedChunks: number;
  status: "pending" | "downloading" | "completed" | "error";
  error?: string;
}

export interface FileManagerCallbacks {
  onUploadProgress?: (fileId: string, progress: number) => void; // 0-100
  onDownloadProgress?: (fileId: string, progress: number) => void; // 0-100
  onFileReady?: (fileId: string, file: File | Blob, metadata: FileTransfer) => void;
  onError?: (fileId: string, error: string) => void;
}

export class FileManager {
  private activeTransfers = new Map<string, FileTransfer>();
  private callbacks: FileManagerCallbacks = {};

  constructor(callbacks?: FileManagerCallbacks) {
    this.callbacks = callbacks || {};
  }

  /**
   * Validar archivo antes de enviar
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `Archivo muy grande. Máximo ${MAX_FILE_SIZE / 1024 / 1024} MB`,
      };
    }

    if (file.size === 0) {
      return { valid: false, error: "Archivo vacío" };
    }

    // Validar tipo MIME si hay restricciones
    if (ALLOWED_FILE_TYPES !== null && !ALLOWED_FILE_TYPES.includes(file.type)) {
      return {
        valid: false,
        error: `Tipo de archivo no permitido: ${file.type}`,
      };
    }

    return { valid: true };
  }

  /**
   * Preparar archivo para envío
   * Retorna array de payloads: [metadata, ...chunks]
   */
  async prepareFileForSending(
    file: File
  ): Promise<{ fileId: string; payloads: MessagePayload[] }> {
    // Validar
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generar ID único
    const fileId = this.generateFileId();

    // Calcular número de chunks
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);

    // Crear payload de metadata
    const metadataPayload: MessagePayload = {
      type: "file_metadata",
      text: "", // requerido por la interfaz
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks,
      timestamp: Date.now(),
    };

    const payloads: MessagePayload[] = [metadataPayload];

    // Leer archivo y dividir en chunks
    const arrayBuffer = await file.arrayBuffer();
    for (let i = 0; i < totalChunks; i++) {
      const start = i * FILE_CHUNK_SIZE;
      const end = Math.min(start + FILE_CHUNK_SIZE, file.size);
      const chunk = arrayBuffer.slice(start, end);

      // Convertir chunk a base64
      const chunkBase64 = this.arrayBufferToBase64(chunk);

      const chunkPayload: MessagePayload = {
        type: "file_chunk",
        text: "", // requerido
        fileId,
        chunkIndex: i,
        chunkData: chunkBase64,
        timestamp: Date.now(),
      };

      payloads.push(chunkPayload);
    }

    return { fileId, payloads };
  }

  /**
   * Procesar mensaje de archivo recibido
   */
  handleIncomingFile(payload: MessagePayload): void {
    if (!payload.fileId) {
      console.warn("⚠️ Mensaje de archivo sin fileId");
      return;
    }

    const fileId = payload.fileId;

    switch (payload.type) {
      case "file_metadata":
        this.handleFileMetadata(payload);
        break;

      case "file_chunk":
        this.handleFileChunk(payload);
        break;

      case "file_complete":
        // No necesario, lo detectamos cuando receivedChunks === totalChunks
        break;

      default:
        console.warn(`⚠️ Tipo de mensaje de archivo desconocido: ${payload.type}`);
    }
  }

  /**
   * Handler: Metadata de archivo recibido
   */
  private handleFileMetadata(payload: MessagePayload): void {
    const fileId = payload.fileId!;

    // Validar campos requeridos
    if (
      !payload.fileName ||
      payload.fileSize === undefined ||
      payload.totalChunks === undefined
    ) {
      console.error("❌ Metadata de archivo incompleta");
      this.notifyError(fileId, "Metadata incompleta");
      return;
    }

    // Validar tamaño
    if (payload.fileSize > MAX_FILE_SIZE) {
      console.error("❌ Archivo demasiado grande");
      this.notifyError(fileId, "Archivo muy grande");
      return;
    }

    // Crear transferencia
    const transfer: FileTransfer = {
      id: fileId,
      name: payload.fileName,
      size: payload.fileSize,
      type: payload.fileType || "application/octet-stream",
      totalChunks: payload.totalChunks,
      chunks: new Map(),
      receivedChunks: 0,
      status: "downloading",
    };

    this.activeTransfers.set(fileId, transfer);
    console.log(`📥 Recibiendo archivo: ${transfer.name} (${transfer.size} bytes)`);

    this.notifyDownloadProgress(fileId, 0);
  }

  /**
   * Handler: Chunk de archivo recibido
   */
  private handleFileChunk(payload: MessagePayload): void {
    const fileId = payload.fileId!;
    const transfer = this.activeTransfers.get(fileId);

    if (!transfer) {
      console.warn(`⚠️ Chunk para archivo desconocido: ${fileId}`);
      return;
    }

    if (payload.chunkIndex === undefined || !payload.chunkData) {
      console.error("❌ Chunk incompleto");
      return;
    }

    // Prevenir duplicados: solo incrementar si es un chunk nuevo
    const isDuplicate = transfer.chunks.has(payload.chunkIndex);

    // Convertir base64 a ArrayBuffer
    try {
      const chunkBuffer = this.base64ToArrayBuffer(payload.chunkData);
      transfer.chunks.set(payload.chunkIndex, chunkBuffer);

      // Solo incrementar contador si no era duplicado
      if (!isDuplicate) {
        transfer.receivedChunks++;
      }

      // Calcular progreso
      const progress = Math.round((transfer.receivedChunks / transfer.totalChunks) * 100);
      this.notifyDownloadProgress(fileId, progress);

      // Si se completó, re-ensamblar
      if (transfer.receivedChunks === transfer.totalChunks) {
        this.assembleFile(fileId);
      }
    } catch (err) {
      console.error("❌ Error procesando chunk:", err);
      this.notifyError(fileId, "Error procesando datos");
    }
  }

  /**
   * Re-ensamblar archivo completo
   */
  private assembleFile(fileId: string): void {
    const transfer = this.activeTransfers.get(fileId);
    if (!transfer) return;

    try {
      // Ordenar chunks y concatenar
      const sortedChunks: ArrayBuffer[] = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (!chunk) {
          throw new Error(`Chunk ${i} faltante`);
        }
        sortedChunks.push(chunk);
      }

      // Crear blob combinado
      const blob = new Blob(sortedChunks, { type: transfer.type });

      // Actualizar estado
      transfer.status = "completed";
      console.log(`✅ Archivo completado: ${transfer.name}`);

      // Notificar
      this.notifyDownloadProgress(fileId, 100);
      if (this.callbacks.onFileReady) {
        this.callbacks.onFileReady(fileId, blob, transfer);
      }

      // ✅ NUEVA: Programar limpieza automática después de 30 segundos
      this.scheduleTransferCleanup(fileId);
    } catch (err) {
      console.error("❌ Error ensamblando archivo:", err);
      transfer.status = "error";
      transfer.error = String(err);
      this.notifyError(fileId, String(err));

      // ✅ NUEVA: Limpiar también en caso de error
      this.scheduleTransferCleanup(fileId, 5000); // Más rápido en error
    }
  }

  /**
   * Generar ID único para archivo
   * FIX §4.5: usamos crypto.randomUUID() en vez de Date.now()+Math.random()
   * (Math.random no es cripto-seguro y Date.now() puede colisionar bajo reloj
   * corrido o alta frecuencia de transferencias).
   */
  private generateFileId(): string {
    return `file_${crypto.randomUUID()}`;
  }

  /**
   * ✅ NUEVA: Programar limpieza automática de transferencia completada
   * Se ejecuta después de 30 segundos para liberar memoria
   * Previene memory leaks en chats de larga duración
   */
  private scheduleTransferCleanup(fileId: string, delayMs: number = 30000): void {
    setTimeout(() => {
      const transfer = this.activeTransfers.get(fileId);
      if (transfer) {
        console.log(`🧹 Limpiando transferencia completada: ${fileId}`);
        this.activeTransfers.delete(fileId);
      }
    }, delayMs);
  }

  /**
   * ✅ NUEVA: Validador de capacidad de transferencias
   * Limita el número de transferencias simultáneas para prevenir DOS
   */
  private readonly MAX_CONCURRENT_TRANSFERS = 10;

  private validateTransferCapacity(): boolean {
    if (this.activeTransfers.size >= this.MAX_CONCURRENT_TRANSFERS) {
      const error = `Máximo ${this.MAX_CONCURRENT_TRANSFERS} transferencias simultáneas`;
      if (this.callbacks.onError) {
        this.callbacks.onError("capacity-limit", error);
      }
      return false;
    }
    return true;
  }

  /**
   * Helpers de conversión
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Notificaciones
   */
  private notifyUploadProgress(fileId: string, progress: number): void {
    if (this.callbacks.onUploadProgress) {
      this.callbacks.onUploadProgress(fileId, progress);
    }
  }

  private notifyDownloadProgress(fileId: string, progress: number): void {
    if (this.callbacks.onDownloadProgress) {
      this.callbacks.onDownloadProgress(fileId, progress);
    }
  }

  private notifyError(fileId: string, error: string): void {
    if (this.callbacks.onError) {
      this.callbacks.onError(fileId, error);
    }
  }

  /**
   * Limpiar transferencias completadas o con error
   */
  clearTransfer(fileId: string): void {
    this.activeTransfers.delete(fileId);
  }

  /**
   * Obtener estado de una transferencia
   */
  getTransfer(fileId: string): FileTransfer | undefined {
    return this.activeTransfers.get(fileId);
  }

  /**
   * Obtener todas las transferencias activas
   */
  getAllTransfers(): FileTransfer[] {
    return Array.from(this.activeTransfers.values());
  }
}

export default FileManager;

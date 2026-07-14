import "server-only";
import OpenAI, { toFile } from "openai";

/**
 * Operaciones I/O sobre vector stores de OpenAI (Sprint 2).
 * La lógica pura (validación, generación de documentos) vive en `./catalog`.
 */

const VECTOR_STORE_NAME = "vitasei-catalog";

/**
 * Reutiliza el vector store si ya existe (lo verifica con un retrieve);
 * si no, crea uno nuevo. `name` permite nombrarlo por marca (default `vitasei-catalog`).
 */
export async function getOrCreateVectorStore(
  openai: OpenAI,
  existingId?: string | null,
  name: string = VECTOR_STORE_NAME,
): Promise<string> {
  if (existingId) {
    try {
      const vs = await openai.vectorStores.retrieve(existingId);
      return vs.id;
    } catch {
      // El id guardado ya no existe (borrado/rotado): creamos uno nuevo.
    }
  }
  const created = await openai.vectorStores.create({ name });
  return created.id;
}

export interface UploadedFile {
  fileId: string;
  status: string;
}

/**
 * Sube el documento del catálogo (UN markdown con todos los productos) al File
 * API, lo agrega al vector store y espera (poll) a que quede `completed`/`failed`.
 * Devuelve el `file_id` que se guarda en `products.vector_store_file_id` (el mismo
 * para todas las filas del agente). Ver ADR-0048.
 */
export async function uploadCatalogDocument(
  openai: OpenAI,
  vectorStoreId: string,
  filename: string,
  content: string,
): Promise<UploadedFile> {
  const file = await toFile(Buffer.from(content, "utf-8"), filename, {
    type: "text/markdown",
  });
  const vsFile = await openai.vectorStores.files.uploadAndPoll(vectorStoreId, file);
  return { fileId: vsFile.id, status: vsFile.status };
}

/**
 * Borra archivos del vector store (best-effort, uno por uno). Se usa para purgar
 * los documentos anteriores de un agente tras subir el catálogo nuevo (evita
 * huérfanos que el esquema "archivo por producto" dejaba acumular). Nunca lanza:
 * un id ya inexistente no debe romper la carga. Ver ADR-0048.
 */
export async function deleteVectorStoreFiles(
  openai: OpenAI,
  vectorStoreId: string,
  fileIds: string[],
): Promise<void> {
  for (const id of fileIds) {
    try {
      await openai.vectorStores.files.del(vectorStoreId, id);
    } catch {
      // huérfano / ya borrado / de otro store: no rompe la carga.
    }
  }
}

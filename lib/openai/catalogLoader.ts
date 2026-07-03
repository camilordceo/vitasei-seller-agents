import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { createOpenAIClient } from "./client";
import { getOrCreateVectorStore, uploadProductDocument } from "./vectorStore";
import { uploadProductImage } from "@/lib/supabase/storage";
import {
  buildProductDocument,
  productToRow,
  validateCatalog,
  type CatalogLoadRequest,
} from "./catalog";
import { loadAgent, loadSeedAgent, agentVectorStoreId } from "@/lib/agent/agents";
import type { Database } from "@/lib/supabase/types";

type DB = SupabaseClient<Database>;

/**
 * Orquestación de la carga de catálogo (Sprint 2) — paso ACT del pipeline de
 * importación: documento → vector store, imagen → storage, fila → `products`,
 * y trazabilidad en `catalog_imports`. La lógica pura vive en `./catalog`.
 */

export interface CatalogImportResult {
  ok: boolean;
  importId: string | null;
  vectorStoreId: string | null;
  rowsImported: number;
  errors: string[];
  warnings: string[];
  products: Array<{ sku: string; vectorStoreFileId: string; imageUrl: string | null }>;
}

/**
 * Cómo manejar el vector store durante la importación:
 *  - `sync` (default): reusa `agentVectorStoreId` (con fallback a env) o crea; sube docs; persiste.
 *    Comportamiento histórico de la route `/api/catalog/load` y el script CSV.
 *  - `create`: crea un store NUEVO por marca ignorando el fallback de env (para que un agente nuevo
 *    tenga el suyo, no el global); sube docs; persiste. Flujo dashboard "crear vector store".
 *  - `supabase-only`: usa `agent.vector_store_id` tal cual (no crea); valida best-effort; NO sube
 *    docs ni pisa `vector_store_file_id`; NO persiste. Flujo dashboard "ya tengo vector store".
 */
export type VectorStoreMode = "sync" | "create" | "supabase-only";

export interface CatalogImportOptions {
  vectorStoreMode?: VectorStoreMode;
}

export async function runCatalogImport(
  input: CatalogLoadRequest,
  opts: CatalogImportOptions = {},
): Promise<CatalogImportResult> {
  const mode = opts.vectorStoreMode ?? "sync";
  const syncsDocs = mode !== "supabase-only";
  const supabase = createServiceClient();
  const warnings: string[] = [];

  // 1) Validación (pura): SKUs únicos/presentes, name, price. Rompe el gate si falla.
  const { products, errors } = validateCatalog(input);
  if (errors.length > 0) {
    await recordImport(supabase, input.filename ?? null, "failed", 0, errors.join("; "));
    return emptyResult(false, null, errors, warnings);
  }

  // Agente destino (catálogo por marca): el indicado o, si no, el seed.
  const agent = input.agentId
    ? await loadAgent(supabase, input.agentId)
    : await loadSeedAgent(supabase);
  if (!agent) {
    const err = input.agentId
      ? `No existe el agente ${input.agentId}.`
      : "No hay ningún agente configurado (aplica la migración 0010).";
    await recordImport(supabase, input.filename ?? null, "failed", 0, err);
    return emptyResult(false, null, [err], warnings);
  }

  // En "ya tengo vector store" el agente DEBE traer el id (no se crea nada).
  if (mode === "supabase-only" && !agent.vector_store_id) {
    const err = "El agente no tiene vector_store_id; pega uno o usa 'crear vector store'.";
    await recordImport(supabase, input.filename ?? null, "failed", 0, err);
    return emptyResult(false, null, [err], warnings);
  }

  const importId = await recordImport(supabase, input.filename ?? null, "processing", 0, null);

  try {
    const openai = createOpenAIClient();

    // 2) Resolver el vector store según el modo.
    let vectorStoreId: string;
    if (mode === "supabase-only") {
      vectorStoreId = agent.vector_store_id as string;
      // Validación best-effort: avisa si el id ya no existe, pero NO crea uno.
      try {
        await openai.vectorStores.retrieve(vectorStoreId);
      } catch {
        warnings.push(
          `El vector_store_id ${vectorStoreId} no existe en OpenAI (los productos se cargaron solo a Supabase).`,
        );
      }
    } else if (mode === "create") {
      // Crear uno por marca, SIN el fallback de env (para no reusar el global).
      vectorStoreId = await getOrCreateVectorStore(openai, agent.vector_store_id, vectorStoreName(agent));
    } else {
      // sync: comportamiento histórico (con fallback de env).
      vectorStoreId = await getOrCreateVectorStore(openai, agentVectorStoreId(agent));
    }

    const done: CatalogImportResult["products"] = [];

    for (const p of products) {
      // 2a) Documento → vector store (espera `completed`). Se omite en supabase-only.
      let fileId: string | null = null;
      if (syncsDocs) {
        const doc = buildProductDocument(p);
        const up = await uploadProductDocument(openai, vectorStoreId, `${p.sku}.md`, doc);
        fileId = up.fileId;
        if (up.status !== "completed") {
          warnings.push(`vector store file ${p.sku}: status=${up.status}`);
        }
      }

      // 2b) Imagen → storage (best-effort, en todos los modos).
      const img = await uploadProductImage(supabase, p);
      if (img.warning) warnings.push(img.warning);

      // 2c) Upsert por (agente, SKU): catálogo por marca (gate: el SKU del texto == el de products).
      // En supabase-only NO incluimos `vector_store_file_id` para no pisar el existente.
      const row = {
        ...productToRow(p, agent.id),
        image_url: img.imageUrl,
        ...(fileId ? { vector_store_file_id: fileId } : {}),
      };
      const { error } = await supabase
        .from("products")
        .upsert(row, { onConflict: "agent_id,sku" });
      if (error) throw new Error(`upsert products ${p.sku}: ${error.message}`);

      done.push({ sku: p.sku, vectorStoreFileId: fileId ?? "", imageUrl: img.imageUrl });
    }

    // 3) Persistir el vector_store_id en el agente (salvo supabase-only: ya lo tenía).
    if (mode !== "supabase-only") {
      await persistVectorStoreId(supabase, agent.id, vectorStoreId);
    }

    await supabase
      .from("catalog_imports")
      .update({ status: "completed", rows_imported: done.length })
      .eq("id", importId);

    return {
      ok: true,
      importId,
      vectorStoreId,
      rowsImported: done.length,
      errors: [],
      warnings,
      products: done,
    };
  } catch (e) {
    const msg = (e as Error).message;
    await supabase
      .from("catalog_imports")
      .update({ status: "failed", error: msg })
      .eq("id", importId);
    return emptyResult(false, importId, [msg], warnings);
  }
}

// --- helpers -----------------------------------------------------------------

/** Nombre legible del vector store por marca (para el flujo "crear vector store"). */
function vectorStoreName(agent: { brand: string | null; name: string }): string {
  const base = (agent.brand ?? agent.name ?? "").trim() || "catálogo";
  return `${base} — catálogo`;
}

function emptyResult(
  ok: boolean,
  importId: string | null,
  errors: string[],
  warnings: string[],
): CatalogImportResult {
  return { ok, importId, vectorStoreId: null, rowsImported: 0, errors, warnings, products: [] };
}

async function recordImport(
  supabase: DB,
  filename: string | null,
  status: string,
  rows: number,
  error: string | null,
): Promise<string> {
  const { data, error: insErr } = await supabase
    .from("catalog_imports")
    .insert({ filename, status, rows_imported: rows, error })
    .select("id")
    .single();
  if (insErr) throw new Error(`catalog_imports insert: ${insErr.message}`);
  return data.id;
}

async function persistVectorStoreId(
  supabase: DB,
  agentId: string,
  vectorStoreId: string,
): Promise<void> {
  await supabase.from("agents").update({ vector_store_id: vectorStoreId }).eq("id", agentId);
}

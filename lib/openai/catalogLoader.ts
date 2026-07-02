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

export async function runCatalogImport(
  input: CatalogLoadRequest,
): Promise<CatalogImportResult> {
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

  const importId = await recordImport(supabase, input.filename ?? null, "processing", 0, null);

  try {
    const openai = createOpenAIClient();

    // 2) Vector store: reusar el del agente / env, o crear uno nuevo.
    const existingVsId = agentVectorStoreId(agent);
    const vectorStoreId = await getOrCreateVectorStore(openai, existingVsId);

    const done: CatalogImportResult["products"] = [];

    for (const p of products) {
      // 2a) Documento → vector store (espera `completed`).
      const doc = buildProductDocument(p);
      const { fileId, status } = await uploadProductDocument(
        openai,
        vectorStoreId,
        `${p.sku}.md`,
        doc,
      );
      if (status !== "completed") {
        warnings.push(`vector store file ${p.sku}: status=${status}`);
      }

      // 2b) Imagen → storage (best-effort).
      const img = await uploadProductImage(supabase, p);
      if (img.warning) warnings.push(img.warning);

      // 2c) Upsert por (agente, SKU): catálogo por marca (gate: el SKU del texto == el de products).
      const row = {
        ...productToRow(p, agent.id),
        vector_store_file_id: fileId,
        image_url: img.imageUrl,
      };
      const { error } = await supabase
        .from("products")
        .upsert(row, { onConflict: "agent_id,sku" });
      if (error) throw new Error(`upsert products ${p.sku}: ${error.message}`);

      done.push({ sku: p.sku, vectorStoreFileId: fileId, imageUrl: img.imageUrl });
    }

    // 3) Persistir el vector_store_id en el agente.
    await persistVectorStoreId(supabase, agent.id, vectorStoreId);

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

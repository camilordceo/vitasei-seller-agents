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
import { env } from "@/lib/env";
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

  const importId = await recordImport(supabase, input.filename ?? null, "processing", 0, null);

  try {
    const openai = createOpenAIClient();

    // 2) Vector store: reusar el de agent_config activo / env, o crear uno nuevo.
    const existingVsId = await resolveExistingVectorStoreId(supabase);
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

      // 2c) Upsert por SKU (gate: el SKU del texto == el de products).
      const row = {
        ...productToRow(p),
        vector_store_file_id: fileId,
        image_url: img.imageUrl,
      };
      const { error } = await supabase.from("products").upsert(row, { onConflict: "sku" });
      if (error) throw new Error(`upsert products ${p.sku}: ${error.message}`);

      done.push({ sku: p.sku, vectorStoreFileId: fileId, imageUrl: img.imageUrl });
    }

    // 3) Persistir el vector_store_id en agent_config activo (si existe).
    await persistVectorStoreId(supabase, vectorStoreId);

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

async function resolveExistingVectorStoreId(supabase: DB): Promise<string | null> {
  const { data } = await supabase
    .from("agent_config")
    .select("vector_store_id")
    .eq("is_active", true)
    .maybeSingle();
  return data?.vector_store_id ?? env.OPENAI_VECTOR_STORE_ID ?? null;
}

async function persistVectorStoreId(supabase: DB, vectorStoreId: string): Promise<void> {
  await supabase
    .from("agent_config")
    .update({ vector_store_id: vectorStoreId })
    .eq("is_active", true);
}

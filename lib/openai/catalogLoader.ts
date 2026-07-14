import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { createOpenAIClient } from "./client";
import {
  getOrCreateVectorStore,
  uploadCatalogDocument,
  deleteVectorStoreFiles,
} from "./vectorStore";
import { resolveProductImage } from "@/lib/supabase/storage";
import {
  buildCatalogDocument,
  productToRow,
  validateCatalog,
  type CatalogLoadRequest,
  type NormalizedProduct,
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

    // 2') Recolectar los archivos ANTERIORES de este agente (del esquema viejo
    //     "uno por producto" o el único previo) para purgarlos tras subir el nuevo.
    //     Se omite en supabase-only (no tocamos el store). Ver ADR-0048.
    let staleFileIds: string[] = [];
    if (syncsDocs) {
      const { data: prevRows } = await supabase
        .from("products")
        .select("vector_store_file_id")
        .eq("agent_id", agent.id)
        .not("vector_store_file_id", "is", null);
      staleFileIds = [
        ...new Set(
          (prevRows ?? [])
            .map((r) => r.vector_store_file_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
    }

    // 2'') Upsert de los productos del request (imagen + fila). NO se sube nada a
    //      OpenAI por producto: el `vector_store_file_id` se fija abajo, en bloque,
    //      con el id del ÚNICO documento del catálogo.
    //      La imagen es el LINK DEL JSON tal cual (ADR-0049): sin descarga ni re-subida.
    const done: CatalogImportResult["products"] = [];
    for (const p of products) {
      const img = await resolveProductImage(supabase, p, agent.id);
      if (img.warning) warnings.push(img.warning);

      // Upsert por (agente, SKU): catálogo por marca (gate: el SKU del texto == el de products).
      // Si el producto NO trae imagen, se omite `image_url` del payload en vez de mandar
      // null: así una re-carga del JSON no borra la foto que alguien corrigió a mano en
      // /dashboard/inventory (para quitarla, se vacía desde ahí). Con imagen, el link del
      // JSON manda y pisa lo que hubiera.
      const { error } = await supabase
        .from("products")
        .upsert(
          {
            ...productToRow(p, agent.id),
            ...(img.imageUrl ? { image_url: img.imageUrl } : {}),
          },
          { onConflict: "agent_id,sku" },
        );
      if (error) throw new Error(`upsert products ${p.sku}: ${error.message}`);

      done.push({ sku: p.sku, vectorStoreFileId: "", imageUrl: img.imageUrl });
    }

    // 2''') Catálogo → UN solo documento en el vector store, reconstruido desde TODO
    //       el catálogo del agente en la BD (no solo los productos de ESTE request).
    //       Así "agregar/actualizar N productos" es un MERGE: nunca se pierde del store
    //       lo que ya existía. Se omite en supabase-only. Ver ADR-0048.
    let catalogFileId: string | null = null;
    if (syncsDocs) {
      const all = await loadAgentCatalogForDoc(supabase, agent.id);
      const doc = buildCatalogDocument(all);
      const up = await uploadCatalogDocument(openai, vectorStoreId, catalogFilename(agent), doc);
      catalogFileId = up.fileId;
      if (up.status !== "completed") {
        warnings.push(`vector store (catálogo): status=${up.status}`);
      }
      // El archivo único del catálogo se referencia en TODAS las filas del agente
      // (una sola update: los productos ya existentes también apuntan al nuevo doc).
      const { error: updErr } = await supabase
        .from("products")
        .update({ vector_store_file_id: catalogFileId })
        .eq("agent_id", agent.id);
      if (updErr) throw new Error(`update vector_store_file_id: ${updErr.message}`);
      for (const d of done) d.vectorStoreFileId = catalogFileId;
    }

    // 3) Persistir el vector_store_id en el agente (salvo supabase-only: ya lo tenía).
    if (mode !== "supabase-only") {
      await persistVectorStoreId(supabase, agent.id, vectorStoreId);
    }

    // 3') Purga best-effort de los archivos viejos, ya reemplazados por el único
    //     nuevo. Nunca rompe la carga (el catálogo ya quedó subido y en products).
    if (syncsDocs && catalogFileId) {
      const toDelete = staleFileIds.filter((id) => id !== catalogFileId);
      if (toDelete.length > 0) {
        await deleteVectorStoreFiles(openai, vectorStoreId, toDelete);
      }
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

/**
 * Lee TODO el catálogo del agente desde `products` y lo mapea a `NormalizedProduct[]`
 * para reconstruir el documento único del vector store. Pagina (páginas de 1000)
 * para no toparse con el límite de filas de Supabase y NO perder productos en
 * catálogos grandes. Ver ADR-0048.
 */
async function loadAgentCatalogForDoc(supabase: DB, agentId: string): Promise<NormalizedProduct[]> {
  const out: NormalizedProduct[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("products")
      .select("sku, name, description, price, currency, in_stock, metadata, image_url")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load-agent-catalog: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      out.push({
        sku: r.sku,
        name: r.name,
        description: r.description ?? null,
        price: r.price ?? null,
        currency: r.currency ?? "COP",
        in_stock: r.in_stock ?? true,
        metadata:
          r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)
            ? (r.metadata as Record<string, unknown>)
            : {},
        image_url: r.image_url ?? null,
        image_base64: null,
        image_content_type: null,
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Nombre (cosmético) del archivo único del catálogo en el vector store. */
function catalogFilename(agent: { brand: string | null; name: string }): string {
  const slug =
    (agent.brand ?? agent.name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "catalogo";
  return `${slug}-catalogo.md`;
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

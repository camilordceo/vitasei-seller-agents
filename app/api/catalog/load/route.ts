import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runCatalogImport } from "@/lib/openai/catalogLoader";
import type { CatalogLoadRequest } from "@/lib/openai/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Polling del vector store puede tardar; damos margen (Vercel permite hasta 300s).
export const maxDuration = 300;

/**
 * POST /api/catalog/load — carga/sincroniza el catálogo (Sprint 2).
 *
 * Body JSON: { filename?, products: [{ sku, name, description?, price?, currency?,
 *   in_stock?, metadata?, image_url? | image_base64? + image_content_type? }] }
 *
 * Sube cada producto al vector store (`file_search`), re-hospeda su imagen en
 * `product-images`, hace upsert por `sku` en `products` y registra el import.
 *
 * Auth: si `CATALOG_ADMIN_SECRET` está seteado, exige `Authorization: Bearer <secret>`
 * (o header `x-admin-secret`). En dev sin secret, queda abierto.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CatalogLoadRequest;
  try {
    body = (await req.json()) as CatalogLoadRequest;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const result = await runCatalogImport(body);

  // Validación (sin importId) → 400; fallo del pipeline (con importId) → 502.
  if (!result.ok) {
    return NextResponse.json(result, { status: result.importId ? 502 : 400 });
  }

  return NextResponse.json(result, { status: 200 });
}

function isAuthorized(req: Request): boolean {
  const secret = env.CATALOG_ADMIN_SECRET;
  if (!secret) return true; // dev: sin secret configurado, abierto
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;
  const headerSecret = req.headers.get("x-admin-secret");
  return bearer === secret || headerSecret === secret;
}

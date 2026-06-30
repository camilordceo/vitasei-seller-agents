import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import {
  imageStoragePath,
  parseImageData,
  type NormalizedProduct,
} from "@/lib/openai/catalog";

/**
 * Subida de imágenes de producto al bucket público `product-images` (Sprint 2).
 * Devuelve la URL pública para setear en `products.image_url`.
 */

const BUCKET = "product-images";

export interface ImageUploadResult {
  imageUrl: string | null;
  /** Aviso no fatal: la imagen no se pudo re-hospedar pero la carga sigue. */
  warning?: string;
}

/**
 * Resuelve la imagen del producto (base64 o URL remota), la sube a Storage y
 * retorna la URL pública. Es best-effort: si falla, NO tumba la importación —
 * deja la URL original (si era remota) y reporta un `warning`.
 */
export async function uploadProductImage(
  supabase: SupabaseClient<Database>,
  product: NormalizedProduct,
): Promise<ImageUploadResult> {
  let bytes: Buffer | null = null;
  let contentType: string | null = product.image_content_type;

  if (product.image_base64) {
    try {
      const parsed = parseImageData(product.image_base64, contentType);
      bytes = Buffer.from(parsed.base64, "base64");
      contentType = parsed.contentType;
      if (bytes.length === 0) throw new Error("base64 vacío");
    } catch (e) {
      return {
        imageUrl: product.image_url ?? null,
        warning: `base64 inválido (${product.sku}): ${(e as Error).message}`,
      };
    }
  } else if (product.image_url && /^https?:\/\//i.test(product.image_url)) {
    try {
      const res = await fetch(product.image_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      contentType = res.headers.get("content-type") ?? contentType;
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      // No se pudo re-hospedar: conservamos la URL original.
      return {
        imageUrl: product.image_url,
        warning: `no se pudo re-hospedar imagen (${product.sku}): ${(e as Error).message}`,
      };
    }
  } else {
    // Sin imagen, o `image_url` no es http: se deja tal cual.
    return { imageUrl: product.image_url ?? null };
  }

  const path = imageStoragePath(product.sku, contentType);
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType ?? "image/jpeg",
    upsert: true,
  });
  if (error) {
    return {
      imageUrl: product.image_url ?? null,
      warning: `storage upload falló (${product.sku}): ${error.message}`,
    };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { imageUrl: data.publicUrl };
}

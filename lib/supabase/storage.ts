import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import {
  imageStoragePath,
  parseImageData,
  resolveImageSource,
  type NormalizedProduct,
} from "@/lib/openai/catalog";

/**
 * Imagen del producto para `products.image_url` — la foto que el bot manda por WhatsApp.
 *
 * **El link del JSON se usa tal cual** (ADR-0049): no se descarga ni se re-hospeda. Antes sí
 * se re-subía todo al bucket, y como la ruta salía solo del SKU (sin `agent_id`, con un slug
 * que colapsa SKUs distintos) dos productos podían terminar compartiendo el mismo objeto
 * —cruzándose la foto entre sí— y el CDN servía la imagen vieja tras corregirla.
 *
 * Storage queda solo para el caso `base64`: no hay link, así que hay que hospedarla para
 * poder enviarla.
 */

const BUCKET = "product-images";

export interface ImageUploadResult {
  imageUrl: string | null;
  /** Aviso no fatal: la imagen no se pudo resolver, pero la carga del catálogo sigue. */
  warning?: string;
}

/**
 * Resuelve la imagen de un producto a la URL que se guarda en `products.image_url`.
 * Best-effort: si algo falla, devuelve `null` + `warning` y NO tumba la importación.
 */
export async function resolveProductImage(
  supabase: SupabaseClient<Database>,
  product: NormalizedProduct,
  agentId: string,
): Promise<ImageUploadResult> {
  const source = resolveImageSource(product);

  // Caso normal: el JSON trae el link. Se usa tal cual, sin I/O.
  if (source.kind === "url") return { imageUrl: source.url };

  if (source.kind === "none") {
    return product.image_url
      ? {
          imageUrl: null,
          warning: `imagen ignorada (${product.sku}): "${product.image_url}" no es una URL http(s)`,
        }
      : { imageUrl: null };
  }

  // base64: sin link, hay que hospedarla para poder enviarla por Callbell.
  let bytes: Buffer;
  let contentType: string | null;
  try {
    const parsed = parseImageData(source.data, source.contentType);
    bytes = Buffer.from(parsed.base64, "base64");
    contentType = parsed.contentType;
    if (bytes.length === 0) throw new Error("base64 vacío");
  } catch (e) {
    return { imageUrl: null, warning: `base64 inválido (${product.sku}): ${(e as Error).message}` };
  }

  // Ruta por agente + digest del contenido: sin objetos compartidos entre marcas ni entre
  // SKUs que slugifican igual, y una imagen nueva estrena URL (nunca se sirve la vieja).
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const path = imageStoragePath(product.sku, contentType, { agentId, digest });

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType ?? "image/jpeg",
    upsert: true,
  });
  if (error) {
    return { imageUrl: null, warning: `storage upload falló (${product.sku}): ${error.message}` };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { imageUrl: data.publicUrl };
}

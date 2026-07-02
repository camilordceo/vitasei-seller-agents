import type { Database, Json } from "@/lib/supabase/types";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

/**
 * Lógica PURA de carga de catálogo (Sprint 2).
 *
 * Sin I/O ni dependencias server-only: valida la entrada, genera el documento
 * de texto que va al vector store y mapea cada producto a una fila de `products`.
 * Esto es lo que el gate anti-alucinación y el `#ID` necesitan consistente:
 * el SKU del texto que lee el agente DEBE coincidir con el de `products`
 * (de donde sale la imagen). Por eso ambos se derivan de la misma fuente.
 *
 * Al ser puro, se testea con Vitest sin tocar OpenAI ni Supabase.
 */

/** Producto tal como llega en el body de la carga de catálogo. */
export interface CatalogProductInput {
  sku: string;
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  in_stock?: boolean | null;
  metadata?: Record<string, unknown> | null;
  /** Imagen ya hospedada o remota a re-hospedar en `product-images`. */
  image_url?: string | null;
  /** Imagen en base64 (alternativa a `image_url`). */
  image_base64?: string | null;
  /** MIME de la imagen base64 (default image/jpeg). */
  image_content_type?: string | null;
}

export interface CatalogLoadRequest {
  filename?: string | null;
  /** Agente (marca) dueño del catálogo. Si falta, el loader usa el agente seed. */
  agentId?: string | null;
  products: CatalogProductInput[];
}

/** Producto normalizado y validado, listo para el pipeline. */
export interface NormalizedProduct {
  sku: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  in_stock: boolean;
  metadata: Record<string, unknown>;
  image_url: string | null;
  image_base64: string | null;
  image_content_type: string | null;
}

export interface ValidationResult {
  products: NormalizedProduct[];
  errors: string[];
}

const DEFAULT_CURRENCY = "COP";

/**
 * Valida y normaliza la entrada del catálogo.
 *
 * Reglas (las que rompen el gate si no se cumplen):
 *  - `sku` requerido, no vacío y ÚNICO en el lote (es la join key del `#ID`).
 *  - `name` requerido y no vacío.
 *  - `price`, si viene, número finito >= 0.
 * Devuelve los productos normalizados y la lista de errores (vacía = OK).
 */
export function validateCatalog(input: CatalogLoadRequest): ValidationResult {
  const errors: string[] = [];
  const products: NormalizedProduct[] = [];

  if (!input || !Array.isArray(input.products)) {
    return { products: [], errors: ["`products` debe ser un arreglo."] };
  }
  if (input.products.length === 0) {
    return { products: [], errors: ["El catálogo no trae productos."] };
  }

  const seenSku = new Set<string>();

  input.products.forEach((raw, i) => {
    const ref = `producto[${i}]`;
    const sku = typeof raw.sku === "string" ? raw.sku.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";

    if (!sku) errors.push(`${ref}: falta \`sku\`.`);
    if (!name) errors.push(`${ref}: falta \`name\`.`);

    if (sku) {
      if (seenSku.has(sku)) {
        errors.push(`${ref}: SKU duplicado en el lote (\`${sku}\`).`);
      }
      seenSku.add(sku);
    }

    let price: number | null = null;
    if (raw.price !== undefined && raw.price !== null) {
      if (typeof raw.price !== "number" || !Number.isFinite(raw.price) || raw.price < 0) {
        errors.push(`${ref}: \`price\` debe ser un número >= 0.`);
      } else {
        price = raw.price;
      }
    }

    // Solo se agrega si los campos obligatorios están; igual reportamos errores.
    if (sku && name) {
      products.push({
        sku,
        name,
        description: cleanOptional(raw.description),
        price,
        currency: cleanOptional(raw.currency) ?? DEFAULT_CURRENCY,
        in_stock: raw.in_stock ?? true,
        metadata: (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as Record<string, unknown>,
        image_url: cleanOptional(raw.image_url),
        image_base64: cleanOptional(raw.image_base64),
        image_content_type: cleanOptional(raw.image_content_type),
      });
    }
  });

  return { products, errors };
}

function cleanOptional(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Genera el documento markdown de un producto para el vector store.
 * El SKU va prominente para que `file_search` lo recupere y el modelo emita
 * el `#ID` correcto.
 */
export function buildProductDocument(p: NormalizedProduct): string {
  const lines: string[] = [];
  lines.push(`# ${p.name}`);
  lines.push("");
  lines.push(`- SKU (#ID): ${p.sku}`);
  if (p.price !== null) {
    lines.push(`- Precio: ${formatPrice(p.price)} ${p.currency}`);
  }
  lines.push(`- Disponibilidad: ${p.in_stock ? "En stock" : "Agotado"}`);
  lines.push("");
  if (p.description) {
    lines.push(p.description);
    lines.push("");
  }

  const metaEntries = Object.entries(p.metadata).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (metaEntries.length > 0) {
    lines.push("## Detalles");
    for (const [k, v] of metaEntries) {
      lines.push(`- ${k}: ${stringifyMetaValue(v)}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function formatPrice(price: number): string {
  // Sin decimales para COP; los miles ayudan a la legibilidad del retrieval.
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(price);
}

function stringifyMetaValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

/** Mapea un producto normalizado a la fila `products` (sin campos de imagen/vector). */
export function productToRow(p: NormalizedProduct, agentId: string): ProductInsert {
  return {
    agent_id: agentId,
    sku: p.sku,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    in_stock: p.in_stock,
    metadata: p.metadata as Json,
  };
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Extensión de archivo para un MIME de imagen (default jpg). */
export function extensionForContentType(contentType: string | null | undefined): string {
  if (!contentType) return "jpg";
  const ct = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[ct] ?? "jpg";
}

/** Ruta de almacenamiento determinística para la imagen de un SKU. */
export function imageStoragePath(sku: string, contentType: string | null | undefined): string {
  const safe = sku.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `catalog/${safe}.${extensionForContentType(contentType)}`;
}

/**
 * Separa el contenido base64 de un posible prefijo data-URL
 * (`data:image/png;base64,...`) y deduce el content-type.
 * Puro: el decode a bytes lo hace el llamador (server).
 */
export function parseImageData(
  input: string,
  fallbackContentType: string | null,
): { base64: string; contentType: string | null } {
  const m = /^data:([^;]+);base64,(.*)$/is.exec(input.trim());
  if (m) return { base64: m[2].trim(), contentType: m[1].trim() };
  return { base64: input.trim(), contentType: fallbackContentType };
}

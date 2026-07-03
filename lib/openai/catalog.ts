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

/** Formato de JSON de catálogo detectado. */
export type CatalogJsonFormat = "canonical" | "bubble" | "unknown";

export interface NormalizeResult {
  products: CatalogProductInput[];
  format: CatalogJsonFormat;
  /** Problemas estructurales (no es arreglo, vacío, formato desconocido, item no-objeto). */
  errors: string[];
}

/**
 * Normaliza un JSON de catálogo a `CatalogProductInput[]`. Acepta dos formatos:
 *  - **canónico** del sistema (`sku`, `name`, `price`, ...).
 *  - **export tipo Bubble** (`ID`, `Titulo`, `Descripcion`, `Precio`,
 *    `PrecioConDescuento`, `Imagenes`, `Categoria`, ...).
 *
 * Decisión de negocio: el precio oficial es `PrecioConDescuento` (con fallback a
 * `Precio`); el precio de lista, % y ahorro quedan en `metadata`.
 *
 * Puro y sin dependencias server-only → también corre en el cliente para preview.
 * La validación fuerte (SKU único/presente, name, price>=0) la hace `validateCatalog`.
 */
export function normalizeCatalogJson(raw: unknown): NormalizeResult {
  if (!Array.isArray(raw)) {
    return { products: [], format: "unknown", errors: ["El JSON debe ser un arreglo de productos."] };
  }
  if (raw.length === 0) {
    return { products: [], format: "unknown", errors: ["El JSON no trae productos."] };
  }

  const format = detectCatalogFormat(raw);
  if (format === "unknown") {
    return {
      products: [],
      format,
      errors: [
        "Formato no reconocido: cada producto debe traer `sku`+`name` (canónico) o `ID`+`Titulo` (export).",
      ],
    };
  }

  const errors: string[] = [];
  const products: CatalogProductInput[] = [];

  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push(`producto[${i}]: no es un objeto.`);
      return;
    }
    const o = item as Record<string, unknown>;
    products.push(format === "bubble" ? mapBubbleProduct(o) : mapCanonicalProduct(o));
  });

  return { products, format, errors };
}

/** Detecta el formato mirando el primer objeto del arreglo. */
function detectCatalogFormat(raw: unknown[]): CatalogJsonFormat {
  const first = raw.find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
  if (!first) return "unknown";
  if ("sku" in first || "name" in first) return "canonical";
  if ("ID" in first || "Titulo" in first) return "bubble";
  return "unknown";
}

/** Mapea un item del export Bubble a la forma canónica. */
function mapBubbleProduct(o: Record<string, unknown>): CatalogProductInput {
  const metadata = compactRecord({
    categoria: str(o["Categoria"]),
    precio_lista: parseCOP(o["Precio"]),
    precio_con_descuento: parseCOP(o["PrecioConDescuento"]),
    descuento: str(o["PorcentajeDescuento"]),
    ahorro: parseCOP(o["Ahorro"]),
    link_producto: str(o["Link_producto"]),
    empresa: str(o["Empresa"]),
  });
  return {
    sku: str(o["ID"]) ?? "",
    name: str(o["Titulo"]) ?? "",
    description: str(o["Descripcion"]),
    // Precio oficial = con descuento; si no viene, el de lista.
    price: parseCOP(o["PrecioConDescuento"]) ?? parseCOP(o["Precio"]),
    currency: "COP",
    in_stock: stockFromEstado(str(o["Estado"])),
    image_url: firstNonEmpty(str(o["Imagenes"]), str(o["ImageURL"]), str(o["Imagen"])),
    metadata,
  };
}

/** Passthrough del formato canónico con coerción defensiva. */
function mapCanonicalProduct(o: Record<string, unknown>): CatalogProductInput {
  const rawMeta = o["metadata"];
  return {
    sku: str(o["sku"]) ?? "",
    name: str(o["name"]) ?? "",
    description: str(o["description"]),
    price: typeof o["price"] === "number" ? o["price"] : parseCOP(o["price"]),
    currency: str(o["currency"]) ?? "COP",
    in_stock: typeof o["in_stock"] === "boolean" ? o["in_stock"] : true,
    image_url: str(o["image_url"]),
    image_base64: str(o["image_base64"]),
    image_content_type: str(o["image_content_type"]),
    metadata: rawMeta && typeof rawMeta === "object" ? (rawMeta as Record<string, unknown>) : undefined,
  };
}

/** Convierte un precio ("245900", "$196.700", 196700) a número; null si no hay dígitos. */
export function parseCOP(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const digits = v.replace(/[^\d]/g, ""); // quita $, puntos de miles, %, espacios
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Disponibilidad a partir del texto de `Estado` (vacío/desconocido → en stock). */
function stockFromEstado(estado: string | null): boolean {
  if (!estado) return true;
  const e = estado.toLowerCase();
  return !(e.includes("agotado") || e.includes("sin stock") || e.includes("no disponible"));
}

/** Primer valor string no vacío (o null). */
function firstNonEmpty(...vals: Array<string | null>): string | null {
  for (const v of vals) if (v) return v;
  return null;
}

/** String recortado o null (coacciona números/otros a string). */
function str(v: unknown): string | null {
  if (v == null) return null;
  const t = (typeof v === "string" ? v : String(v)).trim();
  return t.length > 0 ? t : null;
}

/** Quita claves con valor null/undefined/"" de un objeto de metadata. */
function compactRecord(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
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

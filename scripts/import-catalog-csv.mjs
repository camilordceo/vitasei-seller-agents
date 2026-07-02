// @ts-nocheck
/**
 * Importa el catálogo de Vitasei desde un CSV a `products` (+ vector store).
 *
 * NO reimplementa el pipeline: parsea el CSV, mapea las columnas al shape que
 * espera `/api/catalog/load` y hace POST. Así reusa TODO lo del Sprint 2
 * (validación, subida al vector store, re-hospedaje de imágenes en Storage,
 * upsert por `sku`, trazabilidad en `catalog_imports`). Ver docs/09 y ADR-0016.
 *
 * Uso:
 *   npm run import:catalog                 # usa el CSV por defecto y localhost:3000
 *   node scripts/import-catalog-csv.mjs --file ./otro.csv --url https://app/api/catalog/load
 *   node scripts/import-catalog-csv.mjs --agent <agent_id>   # catálogo de esa marca (multi-agente)
 *   node scripts/import-catalog-csv.mjs --dry     # solo mapea y muestra, no llama a la API
 *
 * Env (o se leen de .env.local): CATALOG_ADMIN_SECRET, CATALOG_API_URL
 *
 * Mapeo de columnas del CSV -> products:
 *   ID        -> sku   (token completo, p. ej. #ID7948237144230)
 *   Titulo    -> name
 *   Descripcion -> description
 *   Precio    -> price (COP, entero)
 *   Imagenes  -> image_url (fallback: ImageURL, luego Imagen)
 *   Categoria, Link_producto, Empresa, Estado -> metadata
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// --- args --------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : true;
}
const DRY = Boolean(flag("dry", false));
const FILE = resolve(String(flag("file", "vitasei-productos-actualizado.csv")));
const AGENT_ID = (() => {
  const v = flag("agent", "");
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
})();

// --- env (best-effort desde .env.local) --------------------------------------
loadDotEnvLocal();
const API_URL =
  String(flag("url", "") || process.env.CATALOG_API_URL || "http://localhost:3000/api/catalog/load");
const ADMIN_SECRET = process.env.CATALOG_ADMIN_SECRET || "";

// --- CSV ---------------------------------------------------------------------
if (!existsSync(FILE)) {
  console.error(`✗ No encuentro el CSV: ${FILE}`);
  process.exit(1);
}
const rows = parseCsv(readFileSync(FILE, "utf-8")).filter((r) => r.some((c) => c.trim() !== ""));
if (rows.length < 2) {
  console.error("✗ El CSV no tiene filas de datos.");
  process.exit(1);
}

const header = rows[0].map((h) => h.trim());
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const col = (row, name) => (idx[name] != null ? (row[idx[name]] ?? "").trim() : "");

const RE_SKU = /^#ID\d+$/;
const products = [];
const skipped = [];

for (const row of rows.slice(1)) {
  const sku = col(row, "ID");
  const name = col(row, "Titulo");
  if (!sku || !name) {
    skipped.push({ sku, name, reason: "falta ID o Titulo" });
    continue;
  }
  if (!RE_SKU.test(sku)) {
    skipped.push({ sku, name, reason: "el ID no tiene formato #ID<números>" });
    continue;
  }
  const priceRaw = col(row, "Precio").replace(/[^\d.]/g, "");
  const price = priceRaw ? Number(priceRaw) : null;
  const image_url = col(row, "Imagenes") || col(row, "ImageURL") || col(row, "Imagen") || null;

  products.push({
    sku,
    name,
    description: col(row, "Descripcion") || null,
    price: Number.isFinite(price) ? price : null,
    currency: "COP",
    image_url,
    metadata: pruneEmpty({
      categoria: col(row, "Categoria"),
      link_producto: col(row, "Link_producto"),
      empresa: col(row, "Empresa"),
      estado: col(row, "Estado"),
    }),
  });
}

// --- resumen -----------------------------------------------------------------
console.log(`\nCSV: ${FILE}`);
console.log(`Agente destino: ${AGENT_ID ?? "(seed — el actual)"}`);
console.log(`Productos mapeados: ${products.length}   Omitidos: ${skipped.length}`);
for (const p of products) {
  const img = p.image_url ? "img✓" : "img✗";
  console.log(`  · ${p.sku}  ${money(p.price)}  ${img}  ${truncate(p.name, 60)}`);
}
if (skipped.length) {
  console.log("\nOmitidos:");
  for (const s of skipped) console.log(`  ! ${s.sku || "(sin ID)"} — ${s.reason}`);
}
const withoutImg = products.filter((p) => !p.image_url);
if (withoutImg.length) {
  console.log(`\n⚠ ${withoutImg.length} producto(s) sin imagen: no se enviará foto para esos #ID.`);
}

if (DRY) {
  console.log("\n(--dry) No se llamó a la API. Body listo para POST /api/catalog/load.");
  process.exit(0);
}

if (!products.length) {
  console.error("\n✗ No hay productos válidos para cargar.");
  process.exit(1);
}

// --- POST --------------------------------------------------------------------
console.log(`\n→ POST ${API_URL} (${products.length} productos)…`);
const res = await fetch(API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(ADMIN_SECRET ? { Authorization: `Bearer ${ADMIN_SECRET}` } : {}),
  },
  body: JSON.stringify({
    filename: FILE.split(/[\\/]/).pop(),
    ...(AGENT_ID ? { agentId: AGENT_ID } : {}),
    products,
  }),
}).catch((e) => {
  console.error(`✗ No se pudo conectar a ${API_URL}: ${e.message}`);
  console.error("  ¿Está el server arriba (npm run dev) o la URL es correcta (--url)?");
  process.exit(1);
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(`\n✗ La carga falló (HTTP ${res.status}).`);
  if (json.errors?.length) console.error("  errores:", json.errors.join("; "));
  if (json.warnings?.length) console.error("  warnings:", json.warnings.join("; "));
  process.exit(1);
}
console.log(`\n✓ Carga OK: ${json.rowsImported} productos.  vector_store_id=${json.vectorStoreId}`);
if (json.warnings?.length) {
  console.log(`  warnings (${json.warnings.length}):`);
  for (const w of json.warnings) console.log(`   - ${w}`);
}

// --- helpers -----------------------------------------------------------------
/** Parser CSV mínimo RFC-4180 (comillas, comas y saltos dentro de comillas, "" escapado). */
function parseCsv(text) {
  const out = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); out.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  return out;
}

function pruneEmpty(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) if (v) o[k] = v;
  return o;
}
function money(n) {
  return n == null ? "     -   " : `$${new Intl.NumberFormat("es-CO").format(n)}`.padStart(9);
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Carga variables faltantes desde .env.local (parser mínimo KEY=VALUE). */
function loadDotEnvLocal() {
  const p = resolve(".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (process.env[key] == null || process.env[key] === "") process.env[key] = val;
  }
}

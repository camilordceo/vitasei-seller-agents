import { inflateRawSync } from "node:zlib";

/**
 * Lector MÍNIMO de `.xlsx` — solo lo necesario para leer una lista de números.
 *
 * Se escribió a mano (un `.xlsx` es un ZIP con XML adentro, y Node ya trae
 * `zlib`) en vez de sumar una dependencia de hojas de cálculo: la que se usa
 * normalmente arrastra un parser completo de fórmulas, estilos y gráficos —
 * megabytes y superficie de CVE— para lo que aquí es "dame la columna de
 * teléfonos". Ver ADR-0084.
 *
 * Alcance deliberado: **la primera hoja**, valores como texto, sin fórmulas,
 * sin fechas, sin estilos. Cualquier cosa más rara, el operador exporta a CSV
 * (la UI lo dice). No corre en el navegador: usa `node:zlib`.
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

/** Índice de un ZIP leído por su directorio central (el único con tamaños fiables). */
function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const out = new Map<string, ZipEntry>();
  // El EOCD está al final; el comentario puede empujarlo hasta 64 KB atrás.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (u32(bytes, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no parece un Excel (.xlsx) válido.");

  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);

  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CD_SIG) break;
    const method = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20);
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const localOffset = u32(bytes, at + 42);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLen));
    out.set(name, { name, method, compressedSize, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Contenido de una entrada del ZIP como texto. */
function readEntry(bytes: Uint8Array, entry: ZipEntry): string {
  const at = entry.localOffset;
  if (u32(bytes, at) !== LOCAL_SIG) throw new Error("Excel corrupto: cabecera local inválida.");
  const nameLen = u16(bytes, at + 26);
  const extraLen = u16(bytes, at + 28);
  const start = at + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  const data = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(Buffer.from(raw));
  return data.toString("utf8");
}

/** Entidades XML mínimas (las que Excel escribe). */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Texto plano de un bloque XML: concatena todos los `<t>` (texto enriquecido). */
function textOf(xml: string): string {
  const parts: string[] = [];
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(unescapeXml(m[1]));
  return parts.join("");
}

/** `sharedStrings.xml` → tabla indexada (las celdas de texto apuntan aquí). */
function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(textOf(m[1]));
  return out;
}

/**
 * `5.732181974E+11` → `573218197400`.
 *
 * Excel guarda un teléfono sin formato como NÚMERO, y al pasar de 11 dígitos lo
 * escribe en notación exponencial dentro del XML. Sin expandirlo, el paso
 * siguiente (quitar todo lo que no sea dígito) convertía `5.732181974E+11` en
 * `573218197411`: un teléfono que existe, que no es el del cliente, y que nadie
 * habría notado hasta que sonara el teléfono equivocado.
 *
 * La expansión es exacta: quien escribe el XML usa la representación más corta
 * que reconstruye el mismo `double`, y estos números caben de sobra en uno.
 */
export function expandExponential(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(trimmed)) return trimmed;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return trimmed;
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return trimmed;
  return n.toFixed(0);
}

/** `"BC12"` → 54 (índice de columna, base 0). */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/** Filas de una hoja como texto. Las celdas vacías se rellenan con "". */
function readSheet(xml: string, shared: string[], maxRows: number): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml)) !== null && rows.length < maxRows) {
    const cells: string[] = [];
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? "";
      const body = cellMatch[2] ?? "";
      const refMatch = /r="([A-Z]+\d+)"/.exec(attrs);
      const index = refMatch ? columnIndex(refMatch[1]) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";

      let value = "";
      if (type === "s") {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = shared[Number(raw)] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        // Celda numérica: puede venir en exponencial (teléfonos largos).
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = expandExponential(unescapeXml(raw));
      }

      while (cells.length < index) cells.push("");
      cells[index] = value.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Lee la primera hoja de un `.xlsx` y devuelve sus filas como texto.
 * Lanza con un mensaje en español si el archivo no se puede leer — el operador
 * lo ve tal cual en el dashboard, y "exporta a CSV" es una salida válida.
 */
export function readXlsxRows(bytes: Uint8Array, opts?: { maxRows?: number }): string[][] {
  const maxRows = opts?.maxRows ?? 20_000;
  const entries = readZipEntries(bytes);

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? readSharedStrings(readEntry(bytes, sharedEntry)) : [];

  // La primera hoja: `sheet1.xml` si está, si no la primera por orden natural.
  const sheetName =
    (entries.has("xl/worksheets/sheet1.xml") && "xl/worksheets/sheet1.xml") ||
    [...entries.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort()[0];
  if (!sheetName) throw new Error("El Excel no tiene ninguna hoja legible.");

  return readSheet(readEntry(bytes, entries.get(sheetName)!), shared, maxRows);
}

/** ¿Los bytes son un ZIP (y por tanto pueden ser un .xlsx)? */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

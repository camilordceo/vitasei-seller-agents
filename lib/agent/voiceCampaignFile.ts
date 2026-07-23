import { looksLikeZip, readXlsxRows } from "./xlsx";

/**
 * De un archivo de la vida real (CSV exportado de cualquier lado, o un Excel) a
 * una lista de números llamables. Ver docs/29 y ADR-0084.
 *
 * Lo que este módulo asume es lo que de verdad llega: separadores `,` o `;`
 * según cómo esté configurado el Excel de quien exportó, acentos en Latin-1
 * porque Excel de Windows todavía exporta así, teléfonos escritos como
 * `+57 300 111 2233`, `300-111-2233` o `3001112233`, y una columna "nombre" que
 * a veces está y a veces no.
 *
 * Nada de esto es negociable con el operador a las 9 a.m. cuando quiere lanzar
 * 100 llamadas: el archivo entra como está o se le dice exactamente qué fila
 * está mal y por qué.
 */

/** Tope por campaña. Más que esto es una lista que hay que partir. */
export const MAX_CAMPAIGN_ROWS = 5000;

export interface CampaignFileRow {
  /** E.164 sin `+` (convención interna). */
  phone: string;
  name: string | null;
  /** Columnas extra del archivo → `custom_variables` de la llamada. */
  variables: Record<string, string>;
}

export interface CampaignFileParse {
  rows: CampaignFileRow[];
  /** Filas que no se pudieron usar, con su número de línea y el motivo. */
  invalid: Array<{ line: number; value: string; reason: string }>;
  /** Cuántas se descartaron por repetidas (mismo teléfono). */
  duplicates: number;
  /** Encabezados detectados (o `[]` si el archivo no traía). */
  columns: string[];
  /** Cuántas filas venían en el archivo (sin contar el encabezado). */
  totalRead: number;
}

// --- Texto ------------------------------------------------------------------

/**
 * Bytes → texto. Se prueba UTF-8 estricto y, si falla (Excel de Windows exporta
 * en la codificación local), se cae a Latin-1. Sin esto, "Bogotá" llega como
 * "Bogot?" y el nombre del cliente sale roto en la llamada.
 */
export function decodeFileText(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.replace(/^﻿/, "");
  } catch {
    return new TextDecoder("latin1").decode(bytes).replace(/^﻿/, "");
  }
}

/** El separador más frecuente en la primera línea no vacía. */
function sniffDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const counts: Array<[string, number]> = [
    [";", (line.match(/;/g) ?? []).length],
    [",", (line.match(/,/g) ?? []).length],
    ["\t", (line.match(/\t/g) ?? []).length],
    ["|", (line.match(/\|/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * CSV/TSV → matriz. Soporta comillas dobles, comillas escapadas (`""`) y saltos
 * de línea dentro de una celda. Se escribió a mano porque es 40 líneas y el
 * formato aquí es "una lista de teléfonos", no un dialecto exótico.
 */
export function parseDelimitedText(text: string, delimiter?: string): string[][] {
  const sep = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      cell = "";
      rows.push(row);
      row = [];
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

/** Archivo (CSV o XLSX) → matriz de texto. */
export function readCampaignFile(bytes: Uint8Array, filename?: string | null): string[][] {
  const isExcelName = /\.xlsx?$/i.test(filename ?? "");
  if (looksLikeZip(bytes)) return readXlsxRows(bytes);
  if (isExcelName && !looksLikeZip(bytes)) {
    // .xls viejo (formato binario BIFF, no ZIP): no lo leemos, y decirlo es
    // mejor que devolver basura.
    if (/\.xls$/i.test(filename ?? "")) {
      throw new Error(
        "Ese Excel está en formato antiguo (.xls). Ábrelo y guárdalo como .xlsx o como CSV.",
      );
    }
  }
  return parseDelimitedText(decodeFileText(bytes));
}

// --- Teléfonos --------------------------------------------------------------

/** Quita tildes y baja a minúsculas (para comparar encabezados). */
function deburr(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const PHONE_HEADERS = [
  "telefono",
  "teléfono",
  "phone",
  "celular",
  "movil",
  "numero",
  "número",
  "whatsapp",
  "tel",
  "contacto",
];
const NAME_HEADERS = ["nombre", "name", "cliente", "contacto nombre", "nombres", "full name"];

/**
 * Teléfono del archivo → E.164 sin `+`. `defaultPrefix` es el indicativo del
 * país del agente (Colombia `57`).
 *
 * Regla: un número de **10 dígitos o menos es local** y se le antepone el
 * indicativo; de 11 en adelante ya viene internacional. Cubre los casos reales
 * (`3001112233`, `6015110375`, `573001112233`, `+57 300 111 2233`) sin
 * necesitar una librería de numeración mundial.
 */
export function normalizeCampaignPhone(raw: string, defaultPrefix: string): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  // `0057…` / `0057` — prefijo internacional escrito a la vieja usanza.
  digits = digits.replace(/^00+/, "");
  if (!digits) return null;

  const prefix = String(defaultPrefix ?? "").replace(/\D/g, "");
  if (digits.length <= 10 && prefix) digits = prefix + digits;

  if (digits.length < 8) return null; // demasiado corto para ser un teléfono
  if (digits.length > 15) return null; // fuera de E.164
  return digits;
}

// --- Filas ------------------------------------------------------------------

interface HeaderMap {
  phone: number;
  name: number | null;
  columns: string[];
  hasHeader: boolean;
}

/** ¿La primera fila es un encabezado? Lo es si nombra alguna columna conocida. */
function detectHeader(rows: string[][]): HeaderMap {
  const first = rows[0] ?? [];
  const norm = first.map((c) => deburr(c));

  const phoneIdx = norm.findIndex((c) => PHONE_HEADERS.includes(c));
  const nameIdx = norm.findIndex((c) => NAME_HEADERS.includes(c));

  if (phoneIdx >= 0) {
    return { phone: phoneIdx, name: nameIdx >= 0 ? nameIdx : null, columns: first, hasHeader: true };
  }

  // Sin encabezado: la columna con más pinta de teléfonos manda; el nombre, la
  // primera columna con letras.
  const sample = rows.slice(0, 20);
  const width = Math.max(...sample.map((r) => r.length), 1);
  let best = 0;
  let bestScore = -1;
  for (let col = 0; col < width; col++) {
    const score = sample.filter((r) => (r[col] ?? "").replace(/\D/g, "").length >= 7).length;
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  let nameCol: number | null = null;
  for (let col = 0; col < width; col++) {
    if (col === best) continue;
    const letters = sample.filter((r) => /[a-zA-ZÀ-ÿ]{3,}/.test(r[col] ?? "")).length;
    if (letters >= Math.max(1, Math.floor(sample.length / 2))) {
      nameCol = col;
      break;
    }
  }
  return { phone: best, name: nameCol, columns: [], hasHeader: false };
}

/**
 * Matriz → filas llamables. Devuelve también lo que NO sirvió: una campaña que
 * dice "100 números cargados" cuando 12 estaban mal escritos es una mentira que
 * se descubre tarde.
 */
export function parseCampaignRows(
  rows: string[][],
  opts?: { defaultPrefix?: string; max?: number },
): CampaignFileParse {
  const prefix = opts?.defaultPrefix ?? "57";
  const max = opts?.max ?? MAX_CAMPAIGN_ROWS;
  const empty: CampaignFileParse = {
    rows: [],
    invalid: [],
    duplicates: 0,
    columns: [],
    totalRead: 0,
  };
  if (rows.length === 0) return empty;

  const header = detectHeader(rows);
  const body = header.hasHeader ? rows.slice(1) : rows;
  const out: CampaignFileRow[] = [];
  const invalid: CampaignFileParse["invalid"] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  body.forEach((row, i) => {
    // +1 por el encabezado, +1 porque las líneas se cuentan desde 1.
    const line = i + (header.hasHeader ? 2 : 1);
    const rawPhone = row[header.phone] ?? "";
    if (!rawPhone.trim()) {
      invalid.push({ line, value: "", reason: "sin teléfono" });
      return;
    }
    const phone = normalizeCampaignPhone(rawPhone, prefix);
    if (!phone) {
      invalid.push({ line, value: rawPhone, reason: "teléfono inválido" });
      return;
    }
    if (seen.has(phone)) {
      duplicates++;
      return;
    }
    if (out.length >= max) {
      invalid.push({ line, value: rawPhone, reason: `supera el tope de ${max} números` });
      return;
    }
    seen.add(phone);

    const name = header.name != null ? (row[header.name] ?? "").trim() : "";
    const variables: Record<string, string> = {};
    if (header.hasHeader) {
      header.columns.forEach((col, idx) => {
        if (idx === header.phone || idx === header.name) return;
        const key = deburr(col).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        const value = (row[idx] ?? "").trim();
        if (key && value) variables[key] = value.slice(0, 200);
      });
    }

    out.push({ phone, name: name || null, variables });
  });

  return {
    rows: out,
    invalid,
    duplicates,
    columns: header.hasHeader ? header.columns : [],
    totalRead: body.length,
  };
}

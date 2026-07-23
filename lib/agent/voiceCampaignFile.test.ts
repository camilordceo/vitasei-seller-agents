import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  decodeFileText,
  normalizeCampaignPhone,
  parseCampaignRows,
  parseDelimitedText,
  readCampaignFile,
} from "./voiceCampaignFile";

/**
 * El archivo que sube el operador es la entrada más impredecible del sistema.
 * Estas pruebas son los casos REALES que llegan: punto y coma porque el Excel
 * está en español, acentos en Latin-1, teléfonos escritos de seis formas
 * distintas y una hoja de cálculo guardada como .xlsx.
 */

describe("parseDelimitedText", () => {
  it("detecta el separador (coma, punto y coma, tab)", () => {
    expect(parseDelimitedText("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimitedText("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("respeta las comillas y las comas de adentro", () => {
    expect(parseDelimitedText('nombre,ciudad\n"Pérez, Ana",Bogotá')).toEqual([
      ["nombre", "ciudad"],
      ["Pérez, Ana", "Bogotá"],
    ]);
  });

  it("soporta comillas escapadas", () => {
    expect(parseDelimitedText('a\n"dice ""hola"""')).toEqual([["a"], ['dice "hola"']]);
  });

  it("ignora las líneas en blanco", () => {
    expect(parseDelimitedText("a\n\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("decodeFileText", () => {
  it("lee UTF-8", () => {
    expect(decodeFileText(new TextEncoder().encode("Bogotá"))).toBe("Bogotá");
  });

  it("cae a Latin-1 cuando el Excel exportó así", () => {
    // "Bogotá" en Latin-1: la á es 0xE1, que NO es UTF-8 válido.
    const latin1 = new Uint8Array([0x42, 0x6f, 0x67, 0x6f, 0x74, 0xe1]);
    expect(decodeFileText(latin1)).toBe("Bogotá");
  });
});

describe("normalizeCampaignPhone", () => {
  it("antepone el indicativo a un número local", () => {
    expect(normalizeCampaignPhone("3001112233", "57")).toBe("573001112233");
    expect(normalizeCampaignPhone("300 111 2233", "57")).toBe("573001112233");
    expect(normalizeCampaignPhone("300-111-2233", "57")).toBe("573001112233");
  });

  it("deja intacto el que ya viene internacional", () => {
    expect(normalizeCampaignPhone("+57 300 111 2233", "57")).toBe("573001112233");
    expect(normalizeCampaignPhone("573001112233", "57")).toBe("573001112233");
  });

  it("entiende el prefijo internacional a la vieja usanza (0057)", () => {
    expect(normalizeCampaignPhone("0057 3001112233", "57")).toBe("573001112233");
  });

  it("rechaza lo que no puede ser un teléfono", () => {
    expect(normalizeCampaignPhone("123", "57")).toBeNull();
    expect(normalizeCampaignPhone("sin dato", "57")).toBeNull();
    expect(normalizeCampaignPhone("1".repeat(20), "57")).toBeNull();
  });
});

describe("parseCampaignRows", () => {
  it("usa los encabezados en español", () => {
    const grid = parseDelimitedText("nombre;telefono;producto\nAna;3001112233;Colágeno");
    const parsed = parseCampaignRows(grid, { defaultPrefix: "57" });
    expect(parsed.rows).toEqual([
      { phone: "573001112233", name: "Ana", variables: { producto: "Colágeno" } },
    ]);
    expect(parsed.columns).toEqual(["nombre", "telefono", "producto"]);
  });

  it("sin encabezado, adivina la columna de teléfonos", () => {
    const grid = parseDelimitedText("Ana,3001112233\nLuis,3009998877");
    const parsed = parseCampaignRows(grid, { defaultPrefix: "57" });
    expect(parsed.rows.map((r) => r.phone)).toEqual(["573001112233", "573009998877"]);
    expect(parsed.rows[0].name).toBe("Ana");
  });

  it("descarta repetidos y reporta las filas malas con su línea", () => {
    const grid = parseDelimitedText(
      "telefono\n3001112233\n3001112233\nno-es-un-numero\n3009998877",
    );
    const parsed = parseCampaignRows(grid, { defaultPrefix: "57" });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid).toEqual([
      { line: 4, value: "no-es-un-numero", reason: "teléfono inválido" },
    ]);
  });

  it("respeta el tope de números por campaña", () => {
    const lines = ["telefono", ...Array.from({ length: 5 }, (_, i) => `30011122${33 + i}`)];
    const parsed = parseCampaignRows(parseDelimitedText(lines.join("\n")), {
      defaultPrefix: "57",
      max: 3,
    });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.invalid.filter((i) => i.reason.includes("tope"))).toHaveLength(2);
  });
});

// --- Excel ------------------------------------------------------------------

/** CRC32 (el ZIP lo lleva en la cabecera aunque nuestro lector no lo valide). */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP mínimo (deflate) para fabricar un .xlsx de prueba sin dependencias. */
function makeZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.content, "utf8");
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, deflated);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + deflated.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

describe("readCampaignFile con Excel", () => {
  const sharedStrings = `<?xml version="1.0"?><sst count="4" uniqueCount="4">
    <si><t>nombre</t></si><si><t>telefono</t></si><si><t>Ana Pérez</t></si><si><t>Luis</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>3001112233</v></c></row>
    <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>3009998877</v></c></row>
  </sheetData></worksheet>`;

  it("lee la primera hoja y sus cadenas compartidas", () => {
    const xlsx = makeZip([
      { name: "xl/sharedStrings.xml", content: sharedStrings },
      { name: "xl/worksheets/sheet1.xml", content: sheet },
    ]);
    const grid = readCampaignFile(xlsx, "base.xlsx");
    expect(grid[0]).toEqual(["nombre", "telefono"]);

    const parsed = parseCampaignRows(grid, { defaultPrefix: "57" });
    expect(parsed.rows.map((r) => r.phone)).toEqual(["573001112233", "573009998877"]);
    expect(parsed.rows[0].name).toBe("Ana Pérez");
  });

  it("un .xls viejo se rechaza con una salida clara", () => {
    const fake = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect(() => readCampaignFile(fake, "base.xls")).toThrow(/\.xlsx o como CSV/);
  });
});

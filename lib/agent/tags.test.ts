import { describe, expect, it } from "vitest";
import { parseReply } from "./tags";

describe("parseReply", () => {
  it("separa el texto limpio de un #ID al final", () => {
    const out = "Te recomiendo el colágeno, ideal para ti.\n#ID:VITA-001";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("Te recomiendo el colágeno, ideal para ti.");
    expect(tags.skus).toEqual(["VITA-001"]);
    expect(tags.raw).toEqual(["#ID:VITA-001"]);
  });

  it("soporta varios #ID y los deduplica en orden", () => {
    const out = "Mira estos dos:\n#ID:VITA-001\n#ID:VITA-002\n#ID:VITA-001";
    const { tags } = parseReply(out);
    expect(tags.skus).toEqual(["VITA-001", "VITA-002"]);
    expect(tags.raw).toHaveLength(3);
  });

  it("detecta los tags de flujo (addi, cod, orden-lista, humano)", () => {
    expect(parseReply("ok\n#addi").tags.addi).toBe(true);
    expect(parseReply("ok\n#compra-contra-entrega").tags.cod).toBe(true);
    expect(parseReply("listo\n#orden-lista").tags.ordenLista).toBe(true);
    expect(parseReply("te paso un asesor\n#humano").tags.humano).toBe(true);
  });

  it("ignora '#' en medio del texto (solo línea propia es tag)", () => {
    const out = "El combo #1 es el más vendido, pregúntame por el #ID si quieres.";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe(out);
    expect(tags.skus).toEqual([]);
    expect(tags.raw).toEqual([]);
  });

  it("tolera espacios alrededor del tag y colapsa líneas en blanco", () => {
    const out = "Hola.\n\n  #ID:VITA-001  \n";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("Hola.");
    expect(tags.skus).toEqual(["VITA-001"]);
  });

  it("sin tags: cleanText es el texto y los flags quedan en false", () => {
    const out = "Claro, con gusto te ayudo.";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe(out);
    expect(tags).toMatchObject({
      skus: [],
      addi: false,
      cod: false,
      ordenLista: false,
      humano: false,
      raw: [],
    });
  });

  it("no rompe con string vacío", () => {
    const { cleanText, tags } = parseReply("");
    expect(cleanText).toBe("");
    expect(tags.skus).toEqual([]);
  });
});

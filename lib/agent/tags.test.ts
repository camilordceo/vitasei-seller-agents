import { describe, expect, it } from "vitest";
import { parseReply } from "./tags";

describe("parseReply", () => {
  it("extrae un #ID inline y lo quita del texto que ve el cliente", () => {
    const out = "Te recomiendo el colágeno #ID7948237144230, ideal para ti.";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("Te recomiendo el colágeno, ideal para ti.");
    expect(tags.skus).toEqual(["#ID7948237144230"]);
    expect(tags.raw).toEqual(["#ID7948237144230"]);
  });

  it("saca un #ID que va al final en su propia línea sin dejar hueco", () => {
    const out = "Te recomiendo el colágeno.\n#ID7948237144231";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("Te recomiendo el colágeno.");
    expect(tags.skus).toEqual(["#ID7948237144231"]);
  });

  it("soporta varios #ID y los deduplica en orden", () => {
    const out = "Mira estos: #ID7948237144231 y #ID7948237144232 (y otra vez #ID7948237144231)";
    const { tags } = parseReply(out);
    expect(tags.skus).toEqual(["#ID7948237144231", "#ID7948237144232"]);
    expect(tags.raw).toHaveLength(3); // raw conserva las apariciones
  });

  it("el SKU es el token completo (incluye el prefijo #ID)", () => {
    const { tags } = parseReply("Este: #ID7948237144240");
    expect(tags.skus[0]).toBe("#ID7948237144240");
    expect(tags.skus[0].startsWith("#ID")).toBe(true);
  });

  it("detecta los tags de flujo (addi, cod, orden-lista, humano, llamada) en su línea", () => {
    expect(parseReply("ok\n#addi").tags.addi).toBe(true);
    expect(parseReply("ok\n#compra-contra-entrega").tags.cod).toBe(true);
    expect(parseReply("listo\n#orden-lista").tags.ordenLista).toBe(true);
    expect(parseReply("te paso un asesor\n#humano").tags.humano).toBe(true);
    expect(parseReply("con gusto te llamo\n#llamada").tags.llamada).toBe(true);
  });

  it("saca el #llamada del texto que ve el cliente (queda solo el mensaje)", () => {
    const out = "¡Claro! Te llamo en un momento para ayudarte mejor.\n#llamada";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("¡Claro! Te llamo en un momento para ayudarte mejor.");
    expect(tags.llamada).toBe(true);
    expect(cleanText).not.toContain("#llamada");
  });

  it("extrae varios #ID de un mensaje real con listas y emojis, y deja el texto limpio", () => {
    const out = [
      "Manejamos varios tipos de magnesio:",
      "1️⃣ **Magnesio Total Care**",
      "- 40 porciones.  ",
      "#ID7948237144240  ",
      "2️⃣ **Bisglicinato**",
      "#ID7948237144241  ",
      "¿Qué quieres mejorar?",
    ].join("\n");
    const { cleanText, tags } = parseReply(out);
    expect(tags.skus).toEqual(["#ID7948237144240", "#ID7948237144241"]);
    expect(cleanText).not.toContain("#ID"); // el cliente NO ve ningún #ID
    expect(cleanText).toContain("¿Qué quieres mejorar?");
  });

  it("detecta un tag de flujo aunque venga con markdown (viñeta + negrita)", () => {
    expect(parseReply("Seguimos con contra entrega.\n- **#compra-contra-entrega**").tags.cod).toBe(
      true,
    );
    expect(parseReply("Listo el pedido.\n* #orden-lista").tags.ordenLista).toBe(true);
    expect(parseReply("Te paso un asesor.\n`#humano`").tags.humano).toBe(true);
  });

  it("combina #ID inline con un tag de flujo al final", () => {
    const out = "Perfecto, te muestro el colágeno #ID7948237144231.\n#compra-contra-entrega";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("Perfecto, te muestro el colágeno.");
    expect(tags.skus).toEqual(["#ID7948237144231"]);
    expect(tags.cod).toBe(true);
  });

  it("ignora un '#ID' sin dígitos y '#' en medio del texto", () => {
    const out = "El combo #1 es el más vendido; pregúntame por el #ID si quieres.";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe(out);
    expect(tags.skus).toEqual([]);
    expect(tags.raw).toEqual([]);
  });

  it("colapsa líneas en blanco colgantes al remover el #ID", () => {
    const out = "Hola.\n\n#ID7948237144230\n";
    const { cleanText, tags } = parseReply(out);
    expect(cleanText).toBe("Hola.");
    expect(tags.skus).toEqual(["#ID7948237144230"]);
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
      llamada: false,
      raw: [],
    });
  });

  it("no rompe con string vacío", () => {
    const { cleanText, tags } = parseReply("");
    expect(cleanText).toBe("");
    expect(tags.skus).toEqual([]);
  });
});

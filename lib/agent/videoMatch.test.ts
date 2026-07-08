import { describe, expect, it } from "vitest";
import { matchVideos, normalizeForMatch, type VideoRule } from "./videoMatch";

const rules: VideoRule[] = [
  { id: "1", keyword: "magnesio", videoUrl: "https://cdn/magnesio.mp4" },
  { id: "2", keyword: "omega 3", videoUrl: "https://cdn/omega3.mp4" },
  { id: "3", keyword: "colágeno", videoUrl: "https://cdn/colageno.mp4" },
];

describe("normalizeForMatch", () => {
  it("quita acentos y pasa a minúsculas", () => {
    expect(normalizeForMatch("Colágeno")).toBe("colageno");
    expect(normalizeForMatch("MAGNESIO")).toBe("magnesio");
    expect(normalizeForMatch("Ñoño")).toBe("ñoño");
  });
});

describe("matchVideos", () => {
  it("empareja por palabra completa, case-insensible", () => {
    const m = matchVideos("Te recomiendo el Magnesio para dormir mejor.", rules);
    expect(m.map((r) => r.id)).toEqual(["1"]);
  });

  it("empareja aunque la keyword tenga acento y el texto no (y viceversa)", () => {
    expect(matchVideos("El colageno mejora la piel", rules).map((r) => r.id)).toEqual(["3"]);
    expect(matchVideos("Prueba el COLÁGENO", rules).map((r) => r.id)).toEqual(["3"]);
  });

  it("empareja frases con espacios (omega 3)", () => {
    expect(matchVideos("Nuestro Omega 3 es puro.", rules).map((r) => r.id)).toEqual(["2"]);
  });

  it("NO empareja dentro de otra palabra (magnesioso)", () => {
    expect(matchVideos("compuesto magnesioso raro", rules)).toEqual([]);
  });

  it("respeta puntuación como límite (magnesio.)", () => {
    expect(matchVideos("¿Buscas magnesio?", rules).map((r) => r.id)).toEqual(["1"]);
  });

  it("puede emparejar varias reglas a la vez", () => {
    const m = matchVideos("Llevá magnesio y omega 3 juntos", rules);
    expect(m.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });

  it("texto vacío o sin coincidencias → []", () => {
    expect(matchVideos("", rules)).toEqual([]);
    expect(matchVideos("nada que ver aquí", rules)).toEqual([]);
  });

  it("ignora reglas con keyword vacía", () => {
    const withEmpty: VideoRule[] = [{ id: "x", keyword: "  ", videoUrl: "u" }];
    expect(matchVideos("cualquier cosa", withEmpty)).toEqual([]);
  });
});

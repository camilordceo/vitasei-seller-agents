import { describe, expect, it } from "vitest";
import {
  matchVideos,
  normalizeForMatch,
  resolveRulesForAgent,
  type VideoRule,
} from "./videoMatch";

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

  it("preserva el caption de la regla emparejada", () => {
    const withCaption: VideoRule[] = [
      { id: "c", keyword: "colágeno", videoUrl: "u", caption: "Mira los beneficios del colágeno" },
    ];
    const m = matchVideos("Prueba el colageno", withCaption);
    expect(m).toHaveLength(1);
    expect(m[0].caption).toBe("Mira los beneficios del colágeno");
  });
});

describe("resolveRulesForAgent (mercado > global, ADR-0050)", () => {
  const CO = "agent-co";
  const global: VideoRule = {
    id: "g",
    agentId: null,
    keyword: "magnesio",
    videoUrl: "https://cdn/magnesio-global.mp4",
  };
  const colombia: VideoRule = {
    id: "co",
    agentId: CO,
    keyword: "magnesio",
    videoUrl: "https://cdn/magnesio-co.mp4",
  };

  it("el video del agente le gana al global para la misma palabra", () => {
    expect(resolveRulesForAgent([global, colombia], CO).map((r) => r.id)).toEqual(["co"]);
    // Y no depende del orden en que vengan de la BD.
    expect(resolveRulesForAgent([colombia, global], CO).map((r) => r.id)).toEqual(["co"]);
  });

  it("un agente sin video propio para esa palabra usa el global", () => {
    expect(resolveRulesForAgent([global], "agent-mx").map((r) => r.id)).toEqual(["g"]);
  });

  it("la precedencia ignora acentos y mayúsculas de la palabra", () => {
    const globalColageno: VideoRule = { id: "g2", agentId: null, keyword: "Colágeno", videoUrl: "u" };
    const coColageno: VideoRule = { id: "co2", agentId: CO, keyword: "colageno", videoUrl: "u2" };
    expect(resolveRulesForAgent([globalColageno, coColageno], CO).map((r) => r.id)).toEqual(["co2"]);
  });

  it("conserva las palabras que solo existen en global (colágeno) junto a las del agente", () => {
    const globalColageno: VideoRule = { id: "g2", agentId: null, keyword: "colágeno", videoUrl: "u" };
    const ids = resolveRulesForAgent([global, colombia, globalColageno], CO).map((r) => r.id);
    expect(ids.sort()).toEqual(["co", "g2"]);
  });

  it("descarta reglas con keyword vacía", () => {
    expect(resolveRulesForAgent([{ id: "x", keyword: "  ", videoUrl: "u" }], CO)).toEqual([]);
  });

  it("tras resolver, el texto con la palabra dispara UN solo video (el del mercado)", () => {
    const resolved = resolveRulesForAgent([global, colombia], CO);
    const m = matchVideos("Te recomiendo el magnesio para dormir", resolved);
    expect(m.map((r) => r.videoUrl)).toEqual(["https://cdn/magnesio-co.mp4"]);
  });
});

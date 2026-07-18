import { describe, it, expect } from "vitest";
import { asciiAssistantName } from "./client";

/**
 * El API de assistants de Synthflow devuelve 500 si `name` trae caracteres
 * no-ASCII (verificado al crear: una raya `—` bastó; ver sprint-08). Estos
 * tests fijan el planchado que se aplica antes de cualquier PUT.
 */
describe("asciiAssistantName", () => {
  it("deja los nombres ASCII intactos", () => {
    expect(asciiAssistantName("Vitasei Ventas 1")).toBe("Vitasei Ventas 1");
  });

  it("quita tildes y enie conservando la letra", () => {
    expect(asciiAssistantName("Colágeno Niño")).toBe("Colageno Nino");
  });

  it("reemplaza rayas y otros simbolos no-ASCII por espacio", () => {
    expect(asciiAssistantName("Vitasei — ventas")).toBe("Vitasei ventas");
  });

  it("colapsa espacios repetidos", () => {
    expect(asciiAssistantName("a  —  b")).toBe("a b");
  });

  it("cae a 'agente' si no queda nada usable", () => {
    expect(asciiAssistantName("→→→")).toBe("agente");
    expect(asciiAssistantName("   ")).toBe("agente");
    expect(asciiAssistantName(null)).toBe("agente");
    expect(asciiAssistantName(undefined)).toBe("agente");
  });
});

import { afterEach, describe, it, expect, vi } from "vitest";
import { asciiAssistantName, listAssistantActionIds } from "./client";

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

/**
 * Traer los extractores del assistant (ADR-0085) es una LECTURA: si esto
 * empujara algo, volveríamos al problema que la feature vino a resolver
 * —cada guardado cambiándole la versión (y la voz) al assistant—.
 */
describe("listAssistantActionIds", () => {
  function stubFetch(body: unknown) {
    const calls: string[] = [];
    const fetchStub = async (url: unknown, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    vi.stubGlobal("fetch", fetchStub);
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const creds = { apiKey: "k" };

  it("pide include_actions y NO escribe nada", async () => {
    const calls = stubFetch({
      response: { assistants: [{ model_id: "m1", actions: ["a1", "a2"] }] },
    });
    const ids = await listAssistantActionIds(creds, "m1");
    expect(ids).toEqual(["a1", "a2"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("include_actions=true");
    expect(calls[0].startsWith("GET ")).toBe(true);
  });

  it("saca los ids de `input_variables` si el array de acciones viene vacío", async () => {
    stubFetch({
      response: {
        assistants: [
          {
            model_id: "m1",
            actions: [],
            input_variables: [{ action_id: "a9", values: [] }],
          },
        ],
      },
    });
    expect(await listAssistantActionIds(creds, "m1")).toEqual(["a9"]);
  });

  it("un assistant sin acciones devuelve lista vacía (no revienta la ficha)", async () => {
    stubFetch({ response: { assistants: [{ model_id: "m1" }] } });
    expect(await listAssistantActionIds(creds, "m1")).toEqual([]);
  });
});

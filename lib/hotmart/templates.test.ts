import { describe, expect, it } from "vitest";
import {
  pickHotmartTemplate,
  renderHotmartMessage,
  extractTemplateValues,
  type HotmartTemplateRow,
} from "./templates";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

/** Constructor de filas con defaults, para no repetir todos los campos. */
function row(over: Partial<HotmartTemplateRow>): HotmartTemplateRow {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    agent_id: over.agent_id ?? null,
    event_type: over.event_type ?? "PURCHASE_OUT_OF_SHOPPING_CART",
    product_id: over.product_id ?? null,
    name: over.name ?? "Plantilla",
    template_uuid: over.template_uuid ?? "uuid",
    message_text: over.message_text ?? "hola",
    enabled: over.enabled ?? true,
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: over.updated_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("pickHotmartTemplate", () => {
  it("devuelve null si no hay candidatas", () => {
    expect(pickHotmartTemplate([], { agentId: AGENT_A, productId: null })).toBeNull();
  });

  it("ignora las deshabilitadas", () => {
    const rows = [row({ id: "off", enabled: false })];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: null })).toBeNull();
  });

  it("prefiere la plantilla del agente sobre la global", () => {
    const rows = [
      row({ id: "global", agent_id: null }),
      row({ id: "agente", agent_id: AGENT_A }),
    ];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: null })?.id).toBe("agente");
  });

  it("el match de agente pesa más que el de producto (el UUID vive en su cuenta)", () => {
    const rows = [
      row({ id: "global-producto", agent_id: null, product_id: "P1" }),
      row({ id: "agente-generica", agent_id: AGENT_A, product_id: null }),
    ];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: "P1" })?.id).toBe(
      "agente-generica",
    );
  });

  it("con el mismo agente, prefiere la específica del producto", () => {
    const rows = [
      row({ id: "agente-generica", agent_id: AGENT_A, product_id: null }),
      row({ id: "agente-producto", agent_id: AGENT_A, product_id: "P1" }),
    ];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: "P1" })?.id).toBe(
      "agente-producto",
    );
  });

  it("no usa la plantilla de otro agente", () => {
    const rows = [row({ id: "otro", agent_id: AGENT_B })];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: null })).toBeNull();
  });

  it("una plantilla de producto concreto no aplica a otro producto", () => {
    const rows = [row({ id: "solo-p1", agent_id: null, product_id: "P1" })];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: "P2" })).toBeNull();
  });

  it("desempata por la más reciente a igual score", () => {
    const rows = [
      row({ id: "vieja", agent_id: AGENT_A, created_at: "2026-01-01T00:00:00Z" }),
      row({ id: "nueva", agent_id: AGENT_A, created_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(pickHotmartTemplate(rows, { agentId: AGENT_A, productId: null })?.id).toBe("nueva");
  });
});

describe("renderHotmartMessage", () => {
  it("interpola {{nombre}} y {{producto}}", () => {
    expect(
      renderHotmartMessage("¡Hola {{nombre}}! Dejaste {{producto}} pendiente.", {
        name: "Ana",
        product: "Curso de Yoga",
      }),
    ).toBe("¡Hola Ana! Dejaste Curso de Yoga pendiente.");
  });

  it("acepta variantes en inglés y con una sola llave", () => {
    expect(renderHotmartMessage("Hi {name} — {product}", { name: "Ana", product: "X" })).toBe(
      "Hi Ana — X",
    );
  });

  it("reemplaza por vacío cuando falta el dato", () => {
    expect(renderHotmartMessage("Hola {{nombre}}", { name: null, product: null })).toBe("Hola ");
  });

  it("devuelve cadena vacía si no hay texto", () => {
    expect(renderHotmartMessage(null, { name: "Ana", product: "X" })).toBe("");
    expect(renderHotmartMessage("", { name: "Ana", product: "X" })).toBe("");
  });
});

describe("extractTemplateValues", () => {
  const vars = { name: "roberto", product: "Curso de Yoga" };

  it("plantilla de SOLO TEXTO (sin tokens) → sin variables", () => {
    expect(extractTemplateValues("Hola, dejaste algo pendiente. ¿Te ayudo?", vars)).toEqual([]);
  });

  it("texto vacío o null → sin variables", () => {
    expect(extractTemplateValues("", vars)).toEqual([]);
    expect(extractTemplateValues(null, vars)).toEqual([]);
  });

  it("un solo {{nombre}} → una variable", () => {
    expect(extractTemplateValues("¡Hola {{nombre}}!", vars)).toEqual(["roberto"]);
  });

  it("{{nombre}} y {{producto}} → dos variables en ese orden", () => {
    expect(
      extractTemplateValues("Hola {{nombre}}, dejaste {{producto}} pendiente", vars),
    ).toEqual(["roberto", "Curso de Yoga"]);
  });

  it("respeta el orden del texto (producto antes que nombre)", () => {
    expect(extractTemplateValues("{{producto}} para ti, {{nombre}}", vars)).toEqual([
      "Curso de Yoga",
      "roberto",
    ]);
  });

  it("resuelve a vacío si falta el dato pero mantiene la posición", () => {
    expect(
      extractTemplateValues("{{nombre}} {{producto}}", { name: null, product: "X" }),
    ).toEqual(["", "X"]);
  });
});

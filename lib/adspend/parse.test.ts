import { describe, expect, it } from "vitest";
import { parseSpendBatch, parseSpendRow, resolveAgent, type AgentIdentity } from "./parse";

const AGENTS: AgentIdentity[] = [
  { id: "aaa", name: "Vitasei Colombia", brand: "Vitasei", whatsappNumber: "573001112233" },
  { id: "bbb", name: "Vitasei México", brand: "Vitasei", whatsappNumber: "5215512345678" },
];

const base = {
  agent_id: "aaa",
  date: "2026-07-21",
  spend: 152340.55,
  currency: "COP",
};

describe("resolveAgent", () => {
  it("resuelve por agent_id", () => {
    expect(resolveAgent({ agentId: "aaa" }, AGENTS)).toEqual({ agentId: "aaa" });
  });

  it("resuelve por número de WhatsApp aunque venga con + y espacios", () => {
    expect(resolveAgent({ whatsappNumber: "+57 300 111 2233" }, AGENTS)).toEqual({ agentId: "aaa" });
  });

  it("resuelve por nombre sin distinguir mayúsculas", () => {
    expect(resolveAgent({ agent: "  vitasei colombia " }, AGENTS)).toEqual({ agentId: "aaa" });
  });

  it("RECHAZA un nombre ambiguo en vez de escoger uno", () => {
    // "Vitasei" es la MARCA de los dos agentes: imputarle el gasto a cualquiera
    // de los dos sería un error invisible en el reporte.
    const out = resolveAgent({ agent: "Vitasei" }, AGENTS);
    expect(out).toMatchObject({ field: "agent" });
    expect((out as { error: string }).error).toContain("ambiguo");
  });

  it("dice cuál es el id desconocido", () => {
    expect((resolveAgent({ agentId: "zzz" }, AGENTS) as { error: string }).error).toContain("zzz");
  });

  it("pide identificar el agente cuando no viene ninguna referencia", () => {
    expect(resolveAgent({}, AGENTS)).toMatchObject({ field: "agent_id" });
  });
});

describe("parseSpendRow", () => {
  const parse = (patch: Record<string, unknown>) => parseSpendRow({ ...base, ...patch }, 0, AGENTS);

  it("acepta una fila mínima y le pone los defaults", () => {
    const out = parse({});
    expect(out).toHaveProperty("row");
    const { row } = out as { row: { platform: string; campaignId: string; spend: number } };
    expect(row.platform).toBe("meta");
    expect(row.campaignId).toBe(""); // sin campaña = total del agente ese día
    expect(row.spend).toBe(152340.55);
  });

  it("acepta el gasto como string (las APIs de anuncios lo mandan así)", () => {
    const out = parse({ spend: "1520.75" }) as { row: { spend: number } };
    expect(out.row.spend).toBe(1520.75);
  });

  it("acepta spend en 0 (día pautado sin consumo) y no lo confunde con vacío", () => {
    const out = parse({ spend: 0 }) as { row: { spend: number } };
    expect(out.row.spend).toBe(0);
  });

  it("rechaza fechas que no son YYYY-MM-DD", () => {
    expect((parse({ date: "21/07/2026" }) as { error: { field?: string } }).error.field).toBe("date");
    expect((parse({ date: "2026-02-31" }) as { error: { field?: string } }).error.field).toBe("date");
  });

  it("rechaza gasto negativo (un reembolso todavía no lo sabemos leer)", () => {
    expect((parse({ spend: -10 }) as { error: { field?: string } }).error.field).toBe("spend");
  });

  it("rechaza una moneda sin tasa, y dice cuáles sirven", () => {
    const err = (parse({ currency: "EUR" }) as { error: { message: string } }).error;
    expect(err.message).toContain("EUR");
    expect(err.message).toContain("COP");
  });

  it("guarda el payload crudo para poder auditar un número raro", () => {
    const out = parse({ campaign_id: "1201" }) as { row: { raw: Record<string, unknown> } };
    expect(out.row.raw.campaign_id).toBe("1201");
  });

  it("normaliza la plataforma a minúsculas", () => {
    const out = parse({ platform: "Meta" }) as { row: { platform: string } };
    expect(out.row.platform).toBe("meta");
  });
});

describe("parseSpendBatch", () => {
  it("una fila mala NO tumba el lote y el error señala su índice", () => {
    const { rows, errors } = parseSpendBatch(
      [base, { ...base, currency: "EUR" }, { ...base, date: "2026-07-22" }],
      AGENTS,
    );
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(1);
  });

  it("deduplica dentro del envío: la última fila del mismo día/campaña gana", () => {
    // Sin esto el upsert de Postgres falla ENTERO ("cannot affect row a second
    // time") y se pierden las demás filas por culpa de un duplicado.
    const { rows } = parseSpendBatch([base, { ...base, spend: 999 }], AGENTS);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(999);
  });

  it("dos campañas distintas del mismo día NO se deduplican", () => {
    const { rows } = parseSpendBatch(
      [
        { ...base, campaign_id: "1" },
        { ...base, campaign_id: "2" },
      ],
      AGENTS,
    );
    expect(rows).toHaveLength(2);
  });

  it("exige un arreglo", () => {
    expect(parseSpendBatch({ nope: true }, AGENTS).errors).toHaveLength(1);
  });
});

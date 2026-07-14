import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { loadHotmartReplyContext, HOTMART_RECOVERY_TAG } from "./context";

/**
 * La compuerta de `loadHotmartReplyContext` es el corazón del arreglo (ADR-0051):
 * el contexto se inyecta SOLO mientras la plantilla siga siendo el último outbound
 * (= la IA aún no ha respondido = el texto no está en la cadena de Responses). Estos
 * tests la ejercitan con un cliente de Supabase falso, sin base de datos.
 */

interface FakeRows {
  lastOutbound: { content: string | null; tags: unknown } | null;
  event: {
    product_id: string | null;
    product_name: string | null;
    buyer_name: string | null;
  } | null;
  templates?: Array<Record<string, unknown>>;
}

/** Cliente chainable mínimo: replica el encadenado que usa el módulo. */
function fakeSupabase(rows: FakeRows) {
  const tablesQueried: string[] = [];

  function builder(table: string) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "order", "limit"]) chain[m] = self;
    chain.maybeSingle = async () => {
      if (table === "messages") return { data: rows.lastOutbound, error: null };
      if (table === "hotmart_events") return { data: rows.event, error: null };
      return { data: null, error: null };
    };
    // `resolveHotmartTemplate` hace `.select().eq().eq()` y espera el resultado (thenable).
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows.templates ?? [], error: null });
    return chain;
  }

  return {
    from: (table: string) => {
      tablesQueried.push(table);
      return builder(table);
    },
    tablesQueried,
  } as unknown as SupabaseClient<Database> & { tablesQueried: string[] };
}

const OPTS = { conversationId: "c1", agentId: "agent-a" };

describe("loadHotmartReplyContext", () => {
  it("inyecta el curso y el texto enviado cuando la plantilla es el último outbound", async () => {
    const supabase = fakeSupabase({
      lastOutbound: {
        content: "Hola Ana, dejaste pendiente el Curso de Excel. ¿Te ayudo?",
        tags: [HOTMART_RECOVERY_TAG],
      },
      event: { product_id: "5312345", product_name: "Curso de Excel", buyer_name: "Ana" },
    });

    const block = await loadHotmartReplyContext(supabase, OPTS);

    expect(block).toContain("Curso de Excel");
    expect(block).toContain("5312345");
    expect(block).toContain("Hola Ana, dejaste pendiente el Curso de Excel");
  });

  it("NO inyecta si la IA ya respondió (el último outbound no es la plantilla)", async () => {
    const supabase = fakeSupabase({
      lastOutbound: { content: "Claro, el curso cuesta $199.000", tags: [] },
      event: { product_id: "5312345", product_name: "Curso de Excel", buyer_name: "Ana" },
    });

    // Ya está en la cadena de Responses: reinyectarlo duplicaría y gastaría tokens.
    expect(await loadHotmartReplyContext(supabase, OPTS)).toBe("");
    // Ni siquiera consulta el evento: corta en el primer read.
    expect(supabase.tablesQueried).toEqual(["messages"]);
  });

  it("NO inyecta en una conversación normal (sin outbound)", async () => {
    const supabase = fakeSupabase({ lastOutbound: null, event: null });
    expect(await loadHotmartReplyContext(supabase, OPTS)).toBe("");
  });

  it("re-resuelve la plantilla POR PRODUCTO si lo guardado es el respaldo sin texto", async () => {
    const supabase = fakeSupabase({
      // Envío legado por env: se guardó el placeholder, no el texto real.
      lastOutbound: {
        content: "[Plantilla Hotmart: Curso de Excel]",
        tags: [HOTMART_RECOVERY_TAG],
      },
      event: { product_id: "5312345", product_name: "Curso de Excel", buyer_name: "Ana" },
      templates: [
        {
          id: "t-generica",
          agent_id: null,
          event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
          product_id: null,
          name: "Generica",
          template_uuid: "u1",
          message_text: "Plantilla generica",
          enabled: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "t-excel",
          agent_id: "agent-a",
          event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
          product_id: "5312345", // el `data.product.id` del webhook
          name: "Excel",
          template_uuid: "u2",
          message_text: "¡Hola {{nombre}}! Te falta poco para llevarte {{producto}}.",
          enabled: true,
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ],
    });

    const block = await loadHotmartReplyContext(supabase, OPTS);

    // Gana la plantilla de ESE curso (agente+producto), ya interpolada.
    expect(block).toContain("¡Hola Ana! Te falta poco para llevarte Curso de Excel.");
    expect(block).not.toContain("Plantilla generica");
    expect(block).not.toContain("[Plantilla Hotmart:");
  });
});

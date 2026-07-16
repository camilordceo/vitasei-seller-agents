import { describe, it, expect, vi, afterEach } from "vitest";
import { KapsoProvider } from "./kapso";

/**
 * El punto delicado del adaptador es `templateValuesFor`: traduce la convención de
 * Callbell ("la variable única va en `text`") a la de Kapso (toda variable va en
 * `components`), SIN tocar a los llamadores. Los dos casos reales:
 *  - Reactivaciones pasan solo `text` (el nombre)      → debe volverse [nombre].
 *  - Hotmart pasa `templateValues` explícito, que puede ser `[]` a propósito
 *    (plantilla de solo texto) → NO debe inventarle variables.
 * Confundirlos rompe una de las dos rutas de plantillas en silencio.
 */

const provider = () =>
  new KapsoProvider({ apiKey: "k", phoneNumberId: "1", templateLanguage: "es_CO" });

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: "wamid.X" }] }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const templateOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  (JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
    template: { components?: unknown[] };
  }).template;

afterEach(() => vi.unstubAllGlobals());

describe("KapsoProvider.sendTemplate — variables", () => {
  it("solo `text` (reactivaciones): lo usa como la única variable", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "reactivacion_7d", { text: "Ana" });
    expect(templateOf(fetchMock).components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]);
  });

  it("`templateValues: []` (Hotmart, plantilla sin variables): NO inventa variables aunque haya `text`", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "aviso", {
      text: "Hola Ana, dejaste algo pendiente",
      templateValues: [],
    });
    expect(templateOf(fetchMock).components).toBeUndefined();
  });

  it("`templateValues` con valores (Hotmart): manda esos y NO el `text` completo", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "carrito", {
      text: "Hola Ana, dejaste pendiente Curso X",
      templateValues: ["Ana", "Curso X"],
    });
    expect(templateOf(fetchMock).components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana" },
          { type: "text", text: "Curso X" },
        ],
      },
    ]);
  });

  it("sin `text` ni `templateValues`: plantilla sin variables", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "aviso");
    expect(templateOf(fetchMock).components).toBeUndefined();
  });

  it("`text` VACÍO sigue siendo una variable (contacto sin nombre) — no puede volverse cero parámetros", async () => {
    // Regresión real: las reactivaciones mandan `text: firstName`, y firstName es ""
    // para todo contacto del que WhatsApp no nos dio nombre. Si eso se tratara como
    // "sin variables", la plantilla saldría con 0 parámetros y Meta la rechaza por
    // conteo → se cae la reactivación de 7/15 días. En Callbell iba como
    // `content.text: ""` (variable en blanco) y se entregaba.
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "reactivacion_7d", { text: "" });
    expect(templateOf(fetchMock).components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "" }] },
    ]);
  });

  it("sin `text` (undefined) sí es plantilla sin variables", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "aviso", { imageUrl: null });
    expect(templateOf(fetchMock).components).toBeUndefined();
  });

  it("reactivación con imagen: header + el nombre como variable (ADR-0044)", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendTemplate("573001112233", "reactivacion_15d", {
      text: "Ana",
      imageUrl: "https://cdn/promo.jpg",
    });
    expect(templateOf(fetchMock).components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn/promo.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]);
  });
});

describe("KapsoProvider — capacidades", () => {
  it("declara que no sabe hacer handoff nativo (no rompe: lo hace conversations.status)", () => {
    expect(provider().supportsHandoff).toBe(false);
    expect(provider().id).toBe("kapso");
  });

  it("ignora teamUuid/botStatus en vez de mandarlos a una API que no los conoce", async () => {
    const fetchMock = mockFetchOk();
    await provider().sendText("573001112233", "Te paso con el equipo", {
      teamUuid: "team-1",
      botStatus: "bot_end",
      metadata: { conversation_id: "c1" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "573001112233",
      type: "text",
      text: { body: "Te paso con el equipo" },
    });
  });
});

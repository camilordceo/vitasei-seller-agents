import { describe, it, expect, vi, afterEach } from "vitest";
import { sendTemplate, type CallbellCreds } from "./sender";

/**
 * `sendTemplate` arma el payload a Callbell DISTINTO según si la plantilla lleva
 * header de imagen (ver docs/14, ADR-0044):
 *  - sin imagen → `type:"text"`, la variable única va en `content.text`.
 *  - con imagen → `type:"image"`, el header va en `content.url` y las variables del
 *    cuerpo en `template_values` (no en `content.text`, que sería el caption).
 */

const creds: CallbellCreds = { apiKey: "k_test", channelUuid: "chan_1" };

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message: { uuid: "m_1", status: "sent" } }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("sendTemplate — plantilla de solo texto (sin imagen)", () => {
  it("envía type:text con la variable en content.text y sin content.url", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "tmpl_7", { text: "Ana" });

    const body = bodyOf(fetchMock);
    expect(body.type).toBe("text");
    expect(body.content).toEqual({ text: "Ana" });
    expect(body.template_uuid).toBe("tmpl_7");
    expect(body.optin_contact).toBe(true);
    expect(body.channel_uuid).toBe("chan_1");
    expect(body.template_values).toBeUndefined();
  });
});

describe("sendTemplate — plantilla con imagen (header)", () => {
  it("envía type:image con el header en content.url y la variable en template_values", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "tmpl_7", {
      text: "Ana",
      imageUrl: "https://cdn.example.com/promo.jpg",
    });

    const body = bodyOf(fetchMock);
    expect(body.type).toBe("image");
    expect(body.content).toEqual({ url: "https://cdn.example.com/promo.jpg" });
    expect(body.template_values).toEqual(["Ana"]);
    expect(body.template_uuid).toBe("tmpl_7");
    expect(body.optin_contact).toBe(true);
  });

  it("con templateValues explícitos, esos tienen prioridad sobre text", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "tmpl_15", {
      text: "Ana",
      templateValues: ["Ana", "Magnesio"],
      imageUrl: "https://cdn.example.com/promo.jpg",
    });

    const body = bodyOf(fetchMock);
    expect(body.type).toBe("image");
    expect(body.template_values).toEqual(["Ana", "Magnesio"]);
  });

  it("sin nombre (text vacío) no manda template_values", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "tmpl_7", {
      text: "",
      imageUrl: "https://cdn.example.com/promo.jpg",
    });

    const body = bodyOf(fetchMock);
    expect(body.type).toBe("image");
    expect(body.template_values).toBeUndefined();
  });
});

describe("metadata — Callbell solo acepta valores string", () => {
  // Un número o booleano en metadata devuelve HTTP 400 {"metadata":["must be string"]}
  // y el envío NO sale (así fallaron todas las reactivaciones). El sender normaliza.
  it("convierte números y booleanos a string y omite null/undefined", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "tmpl_7", {
      text: "Ana",
      metadata: {
        conversation_id: "c1",
        reactivation_stage: 1,
        sales_notification: true,
        vacio: null,
      },
    });

    const body = bodyOf(fetchMock);
    expect(body.metadata).toEqual({
      conversation_id: "c1",
      reactivation_stage: "1",
      sales_notification: "true",
    });
  });

  it("sin metadata no agrega el campo", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "tmpl_7", { text: "Ana" });
    expect(bodyOf(fetchMock)).not.toHaveProperty("metadata");
  });
});

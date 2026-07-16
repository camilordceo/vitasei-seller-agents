import { describe, it, expect, vi, afterEach } from "vitest";
import { sendImage, sendTemplate, sendText, sendVideo, type KapsoCreds } from "./sender";

/**
 * Kapso es un proxy Meta-compatible: el payload es el de la Cloud API de WhatsApp.
 * Estos tests fijan esa forma (y el reintento ante el 409 "in-flight", que Callbell
 * no tiene) sin salir a la red.
 */

const creds: KapsoCreds = {
  apiKey: "k_test",
  phoneNumberId: "647015955153740",
  templateLanguage: "es_CO",
};

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      messaging_product: "whatsapp",
      contacts: [{ input: "573001112233", wa_id: "573001112233" }],
      messages: [{ id: "wamid.ABC", message_status: "accepted" }],
    }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> =>
  JSON.parse(fetchMock.mock.calls[call][1].body as string);

afterEach(() => vi.unstubAllGlobals());

describe("sendText", () => {
  it("usa la forma de Meta y devuelve el wamid", async () => {
    const fetchMock = mockFetchOk();
    const sent = await sendText(creds, "573001112233", "Hola");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/647015955153740/messages");
    expect(init.headers["X-API-Key"]).toBe("k_test");
    expect(bodyOf(fetchMock)).toEqual({
      messaging_product: "whatsapp",
      to: "573001112233",
      type: "text",
      text: { body: "Hola" },
    });
    expect(sent).toEqual({ uuid: "wamid.ABC", status: "accepted" });
  });
});

describe("sendImage / sendVideo", () => {
  it("manda la imagen por link con caption", async () => {
    const fetchMock = mockFetchOk();
    await sendImage(creds, "573001112233", "https://cdn/x.jpg", "Colágeno");
    expect(bodyOf(fetchMock)).toEqual({
      messaging_product: "whatsapp",
      to: "573001112233",
      type: "image",
      image: { link: "https://cdn/x.jpg", caption: "Colágeno" },
    });
  });

  it("omite el caption si no hay", async () => {
    const fetchMock = mockFetchOk();
    await sendImage(creds, "573001112233", "https://cdn/x.jpg", null);
    expect(bodyOf(fetchMock).image).toEqual({ link: "https://cdn/x.jpg" });
  });

  it("el video va como type:video (Callbell lo mandaba como document)", async () => {
    const fetchMock = mockFetchOk();
    await sendVideo(creds, "573001112233", "https://cdn/v.mp4", "Mira esto");
    expect(bodyOf(fetchMock)).toMatchObject({
      type: "video",
      video: { link: "https://cdn/v.mp4", caption: "Mira esto" },
    });
  });
});

describe("sendTemplate", () => {
  it("referencia por nombre + idioma del agente y variables posicionales", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "carrito_abandonado", {
      templateValues: ["Ana", "Curso X"],
    });
    expect(bodyOf(fetchMock)).toEqual({
      messaging_product: "whatsapp",
      to: "573001112233",
      type: "template",
      template: {
        name: "carrito_abandonado",
        language: { code: "es_CO" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "Curso X" },
            ],
          },
        ],
      },
    });
  });

  it("el idioma de la referencia le gana al del agente", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "promo:en_US", { templateValues: [] });
    const body = bodyOf(fetchMock) as { template: { name: string; language: { code: string } } };
    expect(body.template.name).toBe("promo");
    expect(body.template.language.code).toBe("en_US");
  });

  it("plantilla sin variables: sin components", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "aviso", { templateValues: [] });
    expect(bodyOf(fetchMock).template).toEqual({ name: "aviso", language: { code: "es_CO" } });
  });

  it("header de imagen (reactivaciones con imagen, ADR-0044)", async () => {
    const fetchMock = mockFetchOk();
    await sendTemplate(creds, "573001112233", "reactivacion_7d", {
      templateValues: ["Ana"],
      imageUrl: "https://cdn/promo.jpg",
    });
    const body = bodyOf(fetchMock) as { template: { components: unknown[] } };
    expect(body.template.components[0]).toEqual({
      type: "header",
      parameters: [{ type: "image", image: { link: "https://cdn/promo.jpg" } }],
    });
  });
});

describe("409 in-flight", () => {
  it("reintenta y termina enviando", async () => {
    const conflict = {
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: { message: "Another message is in-flight" } }),
    };
    const okRes = {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.OK" }] }),
      text: async () => "",
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(okRes);
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendText(creds, "573001112233", "Hola");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent.uuid).toBe("wamid.OK");
  });

  it("se rinde tras agotar los reintentos", async () => {
    const conflict = {
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: { message: "in-flight", code: 409 } }),
    };
    const fetchMock = vi.fn().mockResolvedValue(conflict);
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendText(creds, "573001112233", "Hola")).rejects.toThrow(/409/);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 intento + 3 reintentos
  });
});

describe("errores", () => {
  it("no reintenta un 422 (fuera de la ventana de 24h) y explica el motivo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          error: {
            message: "Cannot send non-template messages outside the 24-hour window.",
            code: 131047,
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendText(creds, "573001112233", "Hola")).rejects.toThrow(/24-hour window.*131047/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("entiende también la forma de error plana de la Platform API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Invalid API key" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendText(creds, "573001112233", "Hola")).rejects.toThrow(/Invalid API key/);
  });
});

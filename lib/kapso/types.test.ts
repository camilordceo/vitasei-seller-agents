import { describe, expect, it } from "vitest";
import {
  getContactName,
  getContactPhone,
  getConversationId,
  getMediaUrl,
  getMessageId,
  getMessageType,
  getPhoneNumberId,
  getText,
  getTranscript,
  isInboundEvent,
  unwrapEvents,
  type KapsoWebhookBody,
} from "./types";

/**
 * El payload base es el ejemplo LITERAL de la doc de Kapso
 * (docs.kapso.ai — webhook `whatsapp.message.received`, payload v2).
 */
function textEvent(): KapsoWebhookBody {
  return {
    message: {
      id: "wamid.123",
      timestamp: "1730092800",
      type: "text",
      from: "16315551181",
      text: { body: "Hola" },
      kapso: { direction: "inbound", status: "received", has_media: false, content: "Hola" },
    },
    conversation: {
      id: "conv_123",
      phone_number: "16315551181",
      status: "active",
      phone_number_id: "123456789012345",
      kapso: { contact_name: "John Doe" },
    },
    is_new_conversation: true,
    phone_number_id: "123456789012345",
  };
}

describe("unwrapEvents", () => {
  it("devuelve el evento de un payload suelto", () => {
    expect(unwrapEvents(textEvent())).toHaveLength(1);
  });

  it("desenvuelve un lote (buffering encendido)", () => {
    const batch: KapsoWebhookBody = {
      type: "whatsapp.message.received",
      batch: true,
      data: [textEvent(), textEvent()],
      batch_info: { size: 2 },
    };
    expect(unwrapEvents(batch)).toHaveLength(2);
  });

  it("desenvuelve un lote de UN solo mensaje: con buffering, hasta los sueltos llegan así", () => {
    const batch: KapsoWebhookBody = { type: "whatsapp.message.received", data: [textEvent()] };
    expect(unwrapEvents(batch)).toHaveLength(1);
  });

  it("no revienta con basura ni con un body sin mensaje", () => {
    expect(unwrapEvents(null)).toEqual([]);
    expect(unwrapEvents(undefined)).toEqual([]);
    expect(unwrapEvents({} as KapsoWebhookBody)).toEqual([]);
    expect(unwrapEvents({ data: [null, undefined] } as unknown as KapsoWebhookBody)).toEqual([]);
  });
});

describe("isInboundEvent", () => {
  it("acepta los del cliente", () => {
    expect(isInboundEvent(textEvent())).toBe(true);
  });

  it("descarta el eco de nuestros propios envíos", () => {
    const e = textEvent();
    e.message!.kapso!.direction = "outbound";
    expect(isInboundEvent(e)).toBe(false);
  });

  it("ante un payload sin bloque `kapso` asume entrante (no perder mensajes reales)", () => {
    const e = textEvent();
    delete e.message!.kapso;
    expect(isInboundEvent(e)).toBe(true);
  });
});

describe("lectura de campos", () => {
  it("saca los datos del ejemplo de la doc", () => {
    const e = textEvent();
    expect(getMessageId(e)).toBe("wamid.123");
    expect(getMessageType(e)).toBe("text");
    expect(getText(e)).toBe("Hola");
    expect(getContactPhone(e)).toBe("16315551181");
    expect(getContactName(e)).toBe("John Doe");
    expect(getPhoneNumberId(e)).toBe("123456789012345");
    expect(getConversationId(e)).toBe("conv_123");
    expect(getMediaUrl(e)).toBeNull();
    expect(getTranscript(e)).toBeNull();
  });

  it("cae a conversation.phone_number si falta message.from (BSUID de Meta)", () => {
    const e = textEvent();
    e.message!.from = null;
    expect(getContactPhone(e)).toBe("16315551181");
  });

  it("devuelve null si no hay teléfono por ningún lado: el webhook no puede procesar", () => {
    const e = textEvent();
    e.message!.from = null;
    e.conversation!.phone_number = null;
    expect(getContactPhone(e)).toBeNull();
  });

  it("normaliza el teléfono a E.164 sin '+'", () => {
    const e = textEvent();
    e.message!.from = "+1 631 555-1181";
    expect(getContactPhone(e)).toBe("16315551181");
  });

  it("enruta por phone_number_id aunque solo venga dentro de conversation", () => {
    const e = textEvent();
    e.phone_number_id = null;
    expect(getPhoneNumberId(e)).toBe("123456789012345");
  });
});

describe("media", () => {
  it("toma el caption de una imagen como texto y su media_url", () => {
    const e: KapsoWebhookBody = {
      message: {
        id: "wamid.img",
        type: "image",
        from: "16315551181",
        image: { caption: "¿este me sirve?", id: "media_id_123" },
        kapso: {
          direction: "inbound",
          has_media: true,
          media_url: "https://api.kapso.ai/media/abc",
          media_data: { url: "https://api.kapso.ai/media/abc", content_type: "image/jpeg" },
          message_type_data: { caption: "¿este me sirve?" },
        },
      },
      phone_number_id: "123456789012345",
    };
    expect(getText(e)).toBe("¿este me sirve?");
    expect(getMediaUrl(e)).toBe("https://api.kapso.ai/media/abc");
    expect(getMessageType(e)).toBe("image");
  });

  it("una imagen sin caption no tiene texto (pero sí media)", () => {
    const e: KapsoWebhookBody = {
      message: {
        id: "wamid.img2",
        type: "image",
        from: "16315551181",
        image: { id: "m1" },
        kapso: { direction: "inbound", has_media: true, media_url: "https://api.kapso.ai/media/x" },
      },
    };
    expect(getText(e)).toBeNull();
    expect(getMediaUrl(e)).toBe("https://api.kapso.ai/media/x");
  });

  it("expone la transcripción que Kapso ya hizo de la nota de voz (ahorra Whisper)", () => {
    const e: KapsoWebhookBody = {
      message: {
        id: "wamid.audio",
        type: "audio",
        from: "16315551181",
        audio: { id: "m2", voice: true },
        kapso: {
          direction: "inbound",
          has_media: true,
          media_url: "https://api.kapso.ai/media/voice",
          transcript: { text: "Hola, necesito ayuda con mi pedido" },
        },
      },
    };
    expect(getTranscript(e)).toBe("Hola, necesito ayuda con mi pedido");
  });
});

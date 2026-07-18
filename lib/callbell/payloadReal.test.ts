import { describe, expect, it } from "vitest";
import { getAttachments, getMessageType, isInboundMessageEvent } from "./types";
import { kindFromUrl } from "@/lib/messaging/media";

// Payload REAL copiado de events_log en producción (Vitasei CO, 2026-07-18).
// La URL del adjunto es la que quedó guardada en messages.media_url.
const REAL_AUDIO = {
  event: "message_created",
  payload: {
    to: "573332877350",
    from: "573192754701",
    text: "",
    uuid: "wamid.HBgMNTczMTkyNzU0NzAxFQIAEhggQUMxQkQ2QTBDREE3QTU2NjFDMDg4OTU4OTg3Mjk0ODAA",
    status: "received",
    channel: "whatsapp",
    contact: { uuid: "91d5ce46", name: "Ludy Diaz", phoneNumber: "+57 319 2754701" },
    createdAt: "2026-07-18T02:53:27Z",
    attachments: [
      "https://zhqjfwfhfciewa0c16pfllaqmsq4xlzx.s3-eu-west-3.amazonaws.com/uploads/b7e100f4-ebcc-4697-83ab-ecfdcae0db1c.mp3?X-Amz-Expires=600&X-Amz-Date=20260718T025327Z&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA4GCHFIHYAF45Y5MB%2F20260718%2Feu-west-3%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=4f284f88fca11b2575d3666813cb5c2244e2ea1ba24a9360c47df21524e60fed",
    ],
  },
};

// Mismo payload real, pero de un mensaje de texto (el 99% del tráfico).
const REAL_TEXT = {
  event: "message_created",
  payload: {
    to: "573332877350",
    from: "573192754701",
    text: "Peecio",
    uuid: "wamid.HBgMNTczMTkyNzU0NzAx",
    status: "received",
    channel: "whatsapp",
    contact: { uuid: "91d5ce46", name: "Ludy Diaz", phoneNumber: "+57 319 2754701" },
    createdAt: "2026-07-18T04:39:32Z",
  },
};

describe("payload real de Callbell (regresión del bug de media)", () => {
  it("una nota de voz real se clasifica como audio", () => {
    expect(isInboundMessageEvent(REAL_AUDIO)).toBe(true);
    expect(getAttachments(REAL_AUDIO.payload)).toHaveLength(1);
    // ANTES: payload.type es undefined → toMessageType → "other" → adjunto descartado.
    expect(REAL_AUDIO.payload).not.toHaveProperty("type");
    expect(getMessageType(REAL_AUDIO.payload)).toBe("audio");
  });

  it("un texto real se clasifica como text (no 'other')", () => {
    expect(getMessageType(REAL_TEXT.payload)).toBe("text");
  });

  it("la red de seguridad recupera las filas viejas guardadas como 'other'", () => {
    // Reproduce `effectiveType`: type='other' + media_url → se corrige por extensión.
    const mediaUrl = REAL_AUDIO.payload.attachments[0];
    expect(kindFromUrl(mediaUrl)).toBe("audio");
  });
});

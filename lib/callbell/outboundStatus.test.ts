import { describe, expect, it } from "vitest";
import { parseOutboundStatus } from "./outboundStatus";

/**
 * `message_status_updated` es el ÚNICO aviso de que un envío aceptado
 * ("enqueued") murió después en WhatsApp. Solo nos interesan los desenlaces
 * malos: los buenos llegan por miles. Ver ADR-0081.
 */

describe("parseOutboundStatus", () => {
  it("reconoce un fallo y saca la razón del payload interno", () => {
    const event = parseOutboundStatus({
      event: "message_status_updated",
      payload: {
        uuid: "m_1",
        status: "failed",
        messageStatusPayload: {
          type: "failed",
          payload: { reason: "number does not exist on WhatsApp" },
        },
      },
    });
    expect(event).toEqual({
      uuid: "m_1",
      status: "failed",
      detail: "number does not exist on WhatsApp",
    });
  });

  it("sin razón conocida devuelve el payload crudo (mejor feo que nada)", () => {
    const event = parseOutboundStatus({
      event: "message_status_updated",
      payload: {
        uuid: "m_2",
        status: "mismatch",
        messageStatusPayload: { type: "mismatch", payload: { code: 132000 } },
      },
    });
    expect(event?.status).toBe("mismatch");
    expect(event?.detail).toContain("132000");
  });

  it("ignora los estados buenos y los eventos de otro tipo", () => {
    for (const status of ["enqueued", "sent", "delivered", "read"]) {
      expect(
        parseOutboundStatus({ event: "message_status_updated", payload: { uuid: "m", status } }),
      ).toBeNull();
    }
    expect(parseOutboundStatus({ event: "message_created", payload: { uuid: "m" } })).toBeNull();
    expect(parseOutboundStatus(null)).toBeNull();
  });
});

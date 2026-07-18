import { describe, it, expect } from "vitest";
import { normalizeCall, unwrapCall } from "./types";
import { callCostUsd, formatDuration } from "./pricing";

/**
 * Normalización de un registro de llamada. Los fixtures salen de respuestas
 * REALES de la cuenta (2026-07-18): ojo con las dos desalineaciones que fija
 * este módulo — `call_status` (API) vs `status` (webhook), y `start_time`
 * epoch-ms (API) vs ISO-8601 (webhook). Ver docs/25 §2.6.
 */

const apiCall = {
  call_id: "4c826531-d90b-4e29-af06-3b4055cf2017",
  model_id: "c7b32af9-0d32-48ce-b6ed-33e5d92dfaf0",
  call_status: "completed",
  duration: 111,
  end_call_reason: "agent_goodbye",
  transcript: "bot: Hola cómo estas?\nhuman: Hola, estoy buscando una casa.",
  recording_url: "https://storage.googleapis.com/livekit-egress-synthflow/room-call_08757.mp3",
  start_time: "1762780636460",
  telephony_duration: 110307,
  executed_actions: {
    extract_info_metodo_pago: {
      name: "extract_info_metodo_pago",
      action_type: "extract_info_action_type",
      parameters_hard_coded: '{"identifier": "metodo_pago"}',
      return_value: '{"metodo_pago": "contra entrega"}',
    },
  },
};

describe("unwrapCall", () => {
  it("desenvuelve el array paginado que devuelve GET /v2/calls/{id}", () => {
    // Contra-intuitivo pero real: el endpoint de UNA llamada devuelve `calls[]`.
    const body = { status: "ok", response: { pagination: {}, calls: [apiCall] } };
    expect((unwrapCall(body) as { call_id: string }).call_id).toBe(apiCall.call_id);
  });

  it("devuelve null si no hay llamadas", () => {
    expect(unwrapCall({ response: { calls: [] } })).toBeNull();
    expect(unwrapCall(null)).toBeNull();
  });
});

describe("normalizeCall — forma de la API", () => {
  it("normaliza una llamada contestada y extrae los datos", () => {
    const call = normalizeCall(apiCall)!;
    expect(call.callId).toBe("4c826531-d90b-4e29-af06-3b4055cf2017");
    expect(call.status).toBe("completed");
    expect(call.rawStatus).toBe("completed");
    expect(call.durationSec).toBe(111);
    expect(call.answered).toBe(true);
    expect(call.extracted).toEqual({ metodo_pago: "contra entrega" });
    // epoch-ms (string) → ISO
    expect(call.startedAt).toBe(new Date(1762780636460).toISOString());
  });

  it("mapea los estados de Synthflow a nuestro vocabulario", () => {
    const at = (s: string) => normalizeCall({ ...apiCall, call_status: s })!.status;
    expect(at("completed")).toBe("completed");
    expect(at("no-answer")).toBe("no_answer");
    expect(at("busy")).toBe("no_answer");
    expect(at("hangup_on_voicemail")).toBe("no_answer");
    expect(at("failed")).toBe("failed");
    expect(at("canceled")).toBe("failed");
    expect(at("in-progress")).toBe("placed");
    expect(at("pending")).toBe("placed");
    expect(at("ringing")).toBe("placed");
    expect(at("algo-nuevo-de-synthflow")).toBe("failed");
  });

  it("un buzón de voz NO cuenta como contestada", () => {
    // 41s de duración y status completed, pero habló una máquina: si esto
    // contara como "contestada", cancelaríamos las etapas siguientes por nada.
    const call = normalizeCall({
      ...apiCall,
      duration: 41,
      end_call_reason: "voicemail",
    })!;
    expect(call.answered).toBe(false);
  });

  it("duración 0 no cuenta como contestada", () => {
    expect(normalizeCall({ ...apiCall, duration: 0 })!.answered).toBe(false);
  });
});

describe("normalizeCall — forma del webhook", () => {
  it("lee `call.status` anidado e ISO-8601", () => {
    const webhook = {
      status: "completed",
      lead: { name: "test", phone_number: "573001112233" },
      call: {
        call_id: "abc-123",
        status: "completed",
        duration: 113,
        end_call_reason: "agent_goodbye",
        start_time: "2025-10-27T10:59:46+01:00",
        transcript: "bot: hola",
        recording_url: "https://rec/1.mp3",
      },
      executed_actions: {
        info_extractor_producto: {
          action_type: "extract_info_action_type",
          parameters_hard_coded: '{"identifier": "producto"}',
          return_value: '{"producto": "Colágeno"}',
        },
      },
    };
    const call = normalizeCall(webhook)!;
    expect(call.callId).toBe("abc-123");
    expect(call.status).toBe("completed");
    expect(call.durationSec).toBe(113);
    // executed_actions en la RAÍZ, no dentro de `call`.
    expect(call.extracted).toEqual({ producto: "Colágeno" });
    expect(call.startedAt).toBe(new Date("2025-10-27T10:59:46+01:00").toISOString());
  });
});

describe("normalizeCall — robustez", () => {
  it("sin call_id devuelve null (no sabemos de qué llamada hablamos)", () => {
    expect(normalizeCall({ duration: 10 })).toBeNull();
    expect(normalizeCall(null)).toBeNull();
    expect(normalizeCall("nope")).toBeNull();
  });

  it("campos faltantes quedan en null, no lanzan", () => {
    const call = normalizeCall({ call_id: "x" })!;
    expect(call.durationSec).toBeNull();
    expect(call.transcript).toBeNull();
    expect(call.recordingUrl).toBeNull();
    expect(call.startedAt).toBeNull();
    expect(call.extracted).toEqual({});
  });
});

describe("pricing", () => {
  it("calcula el costo por minuto sobre la duración real", () => {
    expect(callCostUsd(60, 0.2)).toBe(0.2);
    expect(callCostUsd(111, 0.2)).toBe(0.37);
    expect(callCostUsd(0, 0.2)).toBe(0);
    expect(callCostUsd(null, 0.2)).toBe(0);
  });

  it("una tarifa inválida cae al default en vez de dar NaN", () => {
    expect(callCostUsd(60, 0)).toBe(0.2);
    expect(callCostUsd(60, Number.NaN)).toBe(0.2);
  });

  it("formatea la duración", () => {
    expect(formatDuration(113)).toBe("1m 53s");
    expect(formatDuration(47)).toBe("47s");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(null)).toBe("0s");
  });
});

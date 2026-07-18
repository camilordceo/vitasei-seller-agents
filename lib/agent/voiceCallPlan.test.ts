import { describe, it, expect } from "vitest";
import {
  parseVoiceConfig,
  planVoiceCalls,
  parseVoiceCountries,
  phoneAllowed,
  toE164,
  normalizeIdentifier,
  parseVoiceExtractors,
  evaluateVoiceCall,
  buildCallPrompt,
  buildCallNote,
  describeDelay,
  MAX_VOICE_STAGES,
  type VoiceCallContext,
} from "./voiceCallPlan";

describe("parseVoiceConfig", () => {
  it("lee la cadencia del ejemplo del negocio: al llegar, 24h y 72h", () => {
    expect(
      parseVoiceConfig([
        { delayMinutes: 0, guidance: "Saludar" },
        { delayMinutes: 1440 },
        { delayMinutes: 4320 },
      ]),
    ).toEqual([
      { delayMinutes: 0, guidance: "Saludar" },
      { delayMinutes: 1440, guidance: null },
      { delayMinutes: 4320, guidance: null },
    ]);
  });

  it("ordena por delay aunque vengan desordenadas", () => {
    const out = parseVoiceConfig([{ delayMinutes: 1440 }, { delayMinutes: 10 }]);
    expect(out.map((s) => s.delayMinutes)).toEqual([10, 1440]);
  });

  it("deduplica delays repetidos", () => {
    const out = parseVoiceConfig([{ delayMinutes: 10 }, { delayMinutes: 10 }]);
    expect(out).toHaveLength(1);
  });

  it("descarta inválidos sin lanzar (corre en la ruta de inbound)", () => {
    const out = parseVoiceConfig([
      { delayMinutes: -5 },
      { delayMinutes: "abc" },
      { delayMinutes: 999_999_999 },
      null,
      "nope",
      { sinDelay: 1 },
      { delayMinutes: 30 },
    ]);
    expect(out).toEqual([{ delayMinutes: 30, guidance: null }]);
  });

  it("acepta delay como string numérico y redondea", () => {
    expect(parseVoiceConfig([{ delayMinutes: "12.6" }])).toEqual([
      { delayMinutes: 13, guidance: null },
    ]);
  });

  it("corta al máximo de etapas", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ delayMinutes: i * 10 }));
    expect(parseVoiceConfig(many)).toHaveLength(MAX_VOICE_STAGES);
  });

  it("entradas no-array devuelven vacío", () => {
    expect(parseVoiceConfig(null)).toEqual([]);
    expect(parseVoiceConfig({})).toEqual([]);
    expect(parseVoiceConfig(undefined)).toEqual([]);
  });
});

describe("planVoiceCalls", () => {
  const from = Date.parse("2026-07-18T12:00:00.000Z");

  it("los delays se cuentan desde el ancla, NO son acumulativos", () => {
    const plan = planVoiceCalls(from, [
      { delayMinutes: 0, guidance: null },
      { delayMinutes: 1440, guidance: null },
      { delayMinutes: 4320, guidance: null },
    ]);
    expect(plan).toEqual([
      { stage: 1, delayMinutes: 0, scheduledAt: "2026-07-18T12:00:00.000Z" },
      { stage: 2, delayMinutes: 1440, scheduledAt: "2026-07-19T12:00:00.000Z" },
      { stage: 3, delayMinutes: 4320, scheduledAt: "2026-07-21T12:00:00.000Z" },
    ]);
  });

  it("una sola llamada a los 10 minutos", () => {
    const plan = planVoiceCalls(from, [{ delayMinutes: 10, guidance: null }]);
    expect(plan).toEqual([
      { stage: 1, delayMinutes: 10, scheduledAt: "2026-07-18T12:10:00.000Z" },
    ]);
  });
});

describe("filtro por país", () => {
  it("parsea prefijos y descarta basura", () => {
    expect(parseVoiceCountries(["57", "+1", "abc", "", "57", "12345"])).toEqual(["57", "1"]);
  });

  it("sin prefijos configurados llama a todos", () => {
    expect(phoneAllowed("573001112233", [])).toBe(true);
  });

  it("prendido para Colombia: pasa el 57, no pasa el 1", () => {
    expect(phoneAllowed("573001112233", ["57"])).toBe(true);
    expect(phoneAllowed("13055551234", ["57"])).toBe(false);
  });

  it("teléfono vacío no pasa cuando hay filtro", () => {
    expect(phoneAllowed("", ["57"])).toBe(false);
  });

  it("toE164 agrega el + que exige Synthflow", () => {
    expect(toE164("573001112233")).toBe("+573001112233");
    expect(toE164("+57 300 111 2233")).toBe("+573001112233");
    expect(toE164("")).toBe("");
  });
});

describe("normalizeIdentifier", () => {
  it("convierte a snake_case sin tildes", () => {
    expect(normalizeIdentifier("Método de Pago")).toBe("metodo_de_pago");
    expect(normalizeIdentifier("nombre y apellido")).toBe("nombre_y_apellido");
    expect(normalizeIdentifier("  Dirección!! ")).toBe("direccion");
  });

  it("no deja guiones bajos colgando", () => {
    expect(normalizeIdentifier("__producto__")).toBe("producto");
  });
});

describe("parseVoiceExtractors", () => {
  it("normaliza y conserva lo válido", () => {
    const out = parseVoiceExtractors([
      { identifier: "Método Pago", type: "single_choice", condition: "Cómo paga", choices: ["a", "b"] },
    ]);
    expect(out).toEqual([
      {
        identifier: "metodo_pago",
        type: "SINGLE_CHOICE",
        condition: "Cómo paga",
        choices: ["a", "b"],
        examples: [],
        actionId: null,
      },
    ]);
  });

  it("descarta los que no tienen instrucción", () => {
    expect(parseVoiceExtractors([{ identifier: "x", condition: "  " }])).toEqual([]);
  });

  it("deduplica por identifier normalizado", () => {
    const out = parseVoiceExtractors([
      { identifier: "producto", condition: "a" },
      { identifier: "Producto", condition: "b" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("tipo desconocido cae a OPEN_QUESTION", () => {
    const out = parseVoiceExtractors([{ identifier: "x", type: "MAGIA", condition: "c" }]);
    expect(out[0].type).toBe("OPEN_QUESTION");
  });

  it("conserva el actionId ya sincronizado", () => {
    const out = parseVoiceExtractors([{ identifier: "x", condition: "c", actionId: "act_1" }]);
    expect(out[0].actionId).toBe("act_1");
  });
});

describe("evaluateVoiceCall", () => {
  const base: VoiceCallContext = {
    conversationStatus: "active",
    aiPaused: false,
    hasOrder: false,
    agentVoiceEnabled: true,
    alreadyAnswered: false,
    stopWhenAnswered: true,
    phoneAllowed: true,
    withinSchedule: true,
    hasModelId: true,
  };

  it("caso feliz: llama", () => {
    expect(evaluateVoiceCall(base)).toEqual({ action: "place", reason: "ok" });
  });

  it("fuera de horario DIFIERE, no cancela — nadie recibe una llamada a las 3am", () => {
    expect(evaluateVoiceCall({ ...base, withinSchedule: false })).toEqual({
      action: "defer",
      reason: "outside_schedule",
    });
  });

  it("cancela si ya compró", () => {
    expect(evaluateVoiceCall({ ...base, hasOrder: true }).action).toBe("cancel");
  });

  it("cancela si la conversación ya no está activa", () => {
    expect(evaluateVoiceCall({ ...base, conversationStatus: "handed_off" })).toEqual({
      action: "cancel",
      reason: "conversation_handed_off",
    });
  });

  it("cancela si un humano tomó la conversación", () => {
    expect(evaluateVoiceCall({ ...base, aiPaused: true }).reason).toBe("ai_paused");
  });

  it("cancela si el agente apagó la voz", () => {
    expect(evaluateVoiceCall({ ...base, agentVoiceEnabled: false }).reason).toBe("voice_disabled");
  });

  it("cancela si no hay assistant configurado", () => {
    expect(evaluateVoiceCall({ ...base, hasModelId: false }).reason).toBe("no_synthflow_assistant");
  });

  it("cancela si el país no está habilitado", () => {
    expect(evaluateVoiceCall({ ...base, phoneAllowed: false }).reason).toBe("country_not_allowed");
  });

  it("si ya contestó y stopWhenAnswered está prendido, cancela las siguientes", () => {
    expect(evaluateVoiceCall({ ...base, alreadyAnswered: true }).reason).toBe("already_answered");
  });

  it("si ya contestó pero stopWhenAnswered está apagado, igual llama", () => {
    expect(
      evaluateVoiceCall({ ...base, alreadyAnswered: true, stopWhenAnswered: false }).action,
    ).toBe("place");
  });

  it("lo permanente gana sobre lo temporal: sin voz y fuera de horario → cancel", () => {
    expect(
      evaluateVoiceCall({ ...base, agentVoiceEnabled: false, withinSchedule: false }).action,
    ).toBe("cancel");
  });
});

describe("buildCallPrompt", () => {
  it("junta prompt base, objetivo de la etapa y contexto", () => {
    const out = buildCallPrompt({
      basePrompt: "Eres Ana, asesora de Vitasei.",
      guidance: "Cerrar la venta del colágeno.",
      contactName: "Camilo",
      productCategory: "Colágeno",
      lastMessages: ["Hola, cuánto cuesta?", "Te cuento: $120.000"],
    });
    expect(out).toContain("Eres Ana, asesora de Vitasei.");
    expect(out).toContain("Cerrar la venta del colágeno.");
    expect(out).toContain("Nombre del cliente: Camilo");
    expect(out).toContain("Producto por el que escribió: Colágeno");
    expect(out).toContain("Hola, cuánto cuesta?");
  });

  it("sin contexto devuelve solo el prompt base", () => {
    expect(buildCallPrompt({ basePrompt: "Hola" })).toBe("Hola");
  });
});

describe("buildCallNote", () => {
  it("arma la nota con estado, minutos y datos capturados", () => {
    const note = buildCallNote({
      status: "completed",
      durationSec: 113,
      endCallReason: "agent_goodbye",
      extracted: { producto: "Colágeno", metodo_pago: "contra entrega" },
      transcript: "bot: hola\nhuman: hola",
      recordingUrl: "https://rec/1.mp3",
    });
    expect(note).toContain("Llamada con IA — Contestada · 1m 53s");
    expect(note).toContain("Cierre: la IA se despidió");
    expect(note).toContain("• Producto: Colágeno");
    expect(note).toContain("• Metodo pago: contra entrega");
    expect(note).toContain("https://rec/1.mp3");
  });

  it("sin respuesta y sin datos: nota corta", () => {
    const note = buildCallNote({
      status: "no_answer",
      durationSec: 0,
      endCallReason: "voicemail",
      extracted: {},
      transcript: null,
      recordingUrl: null,
    });
    expect(note).toContain("Llamada con IA — Sin respuesta");
    expect(note).toContain("buzón de voz");
    expect(note).not.toContain("Datos capturados");
  });

  it("aplana un dato anidado (forma real de Synthflow)", () => {
    const note = buildCallNote({
      status: "completed",
      durationSec: 60,
      endCallReason: null,
      extracted: { datos: { nombre_cliente: "Enrique Ruiz", tipo: "apartamento" } },
      transcript: null,
      recordingUrl: null,
    });
    expect(note).toContain("• Datos: nombre_cliente: Enrique Ruiz, tipo: apartamento");
  });
});

describe("describeDelay", () => {
  it("formatea minutos, horas y días", () => {
    expect(describeDelay(0)).toBe("inmediata");
    expect(describeDelay(10)).toBe("10 min");
    expect(describeDelay(1440)).toBe("24 h");
    expect(describeDelay(4320)).toBe("3 d");
    expect(describeDelay(null)).toBe("—");
  });
});

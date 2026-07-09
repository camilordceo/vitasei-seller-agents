import { describe, it, expect } from "vitest";
import { describeEvent } from "./events";

/**
 * Humanizado del rastro de `events_log` para el panel "¿por qué no respondió?".
 * Se prueban sobre todo los eventos que EXPLICAN una no-respuesta.
 */
describe("describeEvent — por qué (no) respondió", () => {
  it("reply_skipped traduce el motivo agent-inactive", () => {
    const v = describeEvent("reply_skipped", { reason: "agent-inactive" });
    expect(v.label).toBe("No respondió");
    expect(v.detail).toMatch(/fuera de su horario/);
    expect(v.tone).toBe("warn");
  });

  it("reply_skipped con motivo desconocido usa el motivo crudo", () => {
    expect(describeEvent("reply_skipped", { reason: "algo-raro" }).detail).toBe("algo-raro");
  });

  it("process_error phase:reply incluye la fase y el error", () => {
    const v = describeEvent("process_error", { phase: "reply", error: "Callbell 400" });
    expect(v.tone).toBe("error");
    expect(v.detail).toMatch(/generar o enviar/);
    expect(v.detail).toMatch(/Callbell 400/);
  });

  it("out_of_window es warn", () => {
    expect(describeEvent("out_of_window", {}).tone).toBe("warn");
  });

  it("reply_generated / text_sent son 'good'", () => {
    expect(describeEvent("reply_generated", {}).tone).toBe("good");
    expect(describeEvent("text_sent", {}).tone).toBe("good");
  });

  it("gate_blocked lista los SKUs", () => {
    expect(describeEvent("gate_blocked", { blockedSkus: ["A1", "B2"] }).detail).toMatch(/A1, B2/);
  });

  it("tipo desconocido cae a etiqueta legible", () => {
    const v = describeEvent("some_new_event", {});
    expect(v.label).toBe("Some new event");
    expect(v.tone).toBe("neutral");
  });

  it("payload no-objeto (null) no rompe", () => {
    expect(() => describeEvent("reply_skipped", null)).not.toThrow();
    expect(describeEvent("reply_skipped", null).label).toBe("No respondió");
  });
});

import { describe, expect, it } from "vitest";
import { buildResponsesInput } from "./responsesInput";

describe("buildResponsesInput", () => {
  it("devuelve string plano cuando no hay imágenes (retro-compatible)", () => {
    expect(buildResponsesInput("hola")).toBe("hola");
    expect(buildResponsesInput("hola", [])).toBe("hola");
  });

  it("arma mensaje multimodal con texto + imágenes", () => {
    const out = buildResponsesInput("mira esto", ["data:image/png;base64,AAA"]);
    expect(Array.isArray(out)).toBe(true);
    const msg = (out as Array<{ role: string; content: unknown }>)[0];
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual([
      { type: "input_text", text: "mira esto" },
      { type: "input_image", image_url: "data:image/png;base64,AAA", detail: "auto" },
    ]);
  });

  it("incluye varias imágenes en orden", () => {
    const out = buildResponsesInput("x", ["data:1", "data:2"]);
    const content = (out as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content.map((c) => c.type)).toEqual(["input_text", "input_image", "input_image"]);
  });

  it("omite el input_text cuando solo hay imagen (sin texto)", () => {
    const out = buildResponsesInput("", ["data:image/png;base64,AAA"]);
    const msg = (out as Array<{ content: unknown }>)[0];
    expect(msg.content).toEqual([
      { type: "input_image", image_url: "data:image/png;base64,AAA", detail: "auto" },
    ]);
  });
});

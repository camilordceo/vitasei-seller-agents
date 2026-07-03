import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { generateReply } from "./responses";

/**
 * Resiliencia de `generateReply` ante un `previous_response_id` que OpenAI no
 * encuentra (típico al migrar la `OPENAI_API_KEY` a otra cuenta: los `resp_...`
 * de la cuenta vieja dejan de existir). Debe regenerar SIN encadenar en vez de
 * tumbar la respuesta. Ver ADR-0025.
 */

function fakeOpenAI(create: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { create } } as unknown as OpenAI;
}

const okResponse = (id: string) => ({
  id,
  output_text: "hola",
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
});

const baseParams = {
  model: "gpt-5-mini",
  systemPrompt: "eres un asesor",
  input: "¿cuánto vale el envío?",
  vectorStoreId: "vs_new",
};

describe("generateReply — encadenado normal", () => {
  it("pasa el previous_response_id y no marca chainReset", async () => {
    const create = vi.fn().mockResolvedValue(okResponse("resp_new"));
    const gen = await generateReply(fakeOpenAI(create), {
      ...baseParams,
      previousResponseId: "resp_prev",
    });

    expect(gen.responseId).toBe("resp_new");
    expect(gen.chainReset).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].previous_response_id).toBe("resp_prev");
  });

  it("NO manda temperature (gpt-5-mini/o-series la rechazan con 400)", async () => {
    const create = vi.fn().mockResolvedValue(okResponse("resp_new"));
    await generateReply(fakeOpenAI(create), baseParams);

    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});

describe("generateReply — cadena rota (migración de cuenta)", () => {
  it("reintenta SIN previous_response_id y marca chainReset cuando el id no existe", async () => {
    const notFound = Object.assign(new Error("Previous response with id 'resp_old' not found."), {
      status: 404,
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce(okResponse("resp_fresh"));

    const gen = await generateReply(fakeOpenAI(create), {
      ...baseParams,
      previousResponseId: "resp_old",
    });

    expect(gen.chainReset).toBe(true);
    expect(gen.responseId).toBe("resp_fresh");
    expect(create).toHaveBeenCalledTimes(2);
    // El 2º intento va SIN encadenar.
    expect(create.mock.calls[1][0].previous_response_id).toBeUndefined();
  });

  it("propaga el error si el reintento sin cadena también falla (error real, no la cadena)", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const create = vi.fn().mockRejectedValue(notFound);

    await expect(
      generateReply(fakeOpenAI(create), { ...baseParams, previousResponseId: "resp_old" }),
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("NO reintenta ni traga errores ajenos a la cadena (p.ej. API key inválida 401)", async () => {
    const unauthorized = Object.assign(new Error("Incorrect API key provided"), { status: 401 });
    const create = vi.fn().mockRejectedValue(unauthorized);

    await expect(
      generateReply(fakeOpenAI(create), { ...baseParams, previousResponseId: "resp_old" }),
    ).rejects.toThrow(/API key/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sin previous_response_id, un error se propaga tal cual (no hay cadena que soltar)", async () => {
    const err = Object.assign(new Error("boom"), { status: 404 });
    const create = vi.fn().mockRejectedValue(err);

    await expect(
      generateReply(fakeOpenAI(create), { ...baseParams, previousResponseId: null }),
    ).rejects.toThrow(/boom/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

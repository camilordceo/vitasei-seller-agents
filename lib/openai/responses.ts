import "server-only";
import type OpenAI from "openai";
import { buildResponsesInput } from "./responsesInput";

export { buildResponsesInput } from "./responsesInput";

/**
 * Generación de la respuesta del agente (Sprint 3).
 *
 * UNA sola llamada a `responses.create`. `file_search` es hosted: OpenAI busca
 * en el vector store y responde en la misma llamada — no hay loop de tools.
 * El texto que devuelve se guarda como mensaje y se envía (Sprint 4).
 */

export interface GenerateReplyParams {
  model: string;
  systemPrompt: string;
  /** Texto del turno actual (el inbound del cliente, ya con audios transcritos). */
  input: string;
  /**
   * Imágenes del turno como data URLs base64 (`data:image/...;base64,...`) o URLs.
   * Cuando hay, el input va como mensaje multimodal (input_text + input_image) y
   * el modelo "ve" las imágenes en la MISMA llamada. Ver docs/15, ADR-0022.
   */
  imageDataUrls?: string[];
  /** Vector store del catálogo; si falta, se genera sin `file_search`. */
  vectorStoreId?: string | null;
  /** Para encadenar la conversación (si no hay, arranca limpio). */
  previousResponseId?: string | null;
  temperature?: number;
  /**
   * Resultados de `file_search` (menos = menos tokens/latencia; más = más
   * recall). Default 20 (paridad con el playground de OpenAI): con 5, un archivo
   * "aparte" —p.ej. tarifas de envío— puede no entrar al top-K frente a decenas
   * de docs de producto. Ver ADR-0024.
   */
  maxNumResults?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GeneratedReply {
  responseId: string;
  text: string;
  usage: TokenUsage | null;
}

export async function generateReply(
  openai: OpenAI,
  params: GenerateReplyParams,
): Promise<GeneratedReply> {
  const tools = params.vectorStoreId
    ? [
        {
          type: "file_search" as const,
          vector_store_ids: [params.vectorStoreId],
          max_num_results: params.maxNumResults ?? 20,
        },
      ]
    : undefined;

  const response = await openai.responses.create({
    model: params.model,
    instructions: params.systemPrompt,
    input: buildResponsesInput(params.input, params.imageDataUrls),
    previous_response_id: params.previousResponseId ?? undefined,
    tools,
    temperature: params.temperature,
  });

  const u = response.usage as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined;
  const usage: TokenUsage | null = u
    ? {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      }
    : null;

  return { responseId: response.id, text: response.output_text ?? "", usage };
}

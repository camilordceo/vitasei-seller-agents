import "server-only";
import type OpenAI from "openai";

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
  /** Texto del turno actual (el inbound del cliente). */
  input: string;
  /** Vector store del catálogo; si falta, se genera sin `file_search`. */
  vectorStoreId?: string | null;
  /** Para encadenar la conversación (si no hay, arranca limpio). */
  previousResponseId?: string | null;
  temperature?: number;
  /** Resultados de `file_search` (menos = menos tokens/latencia). */
  maxNumResults?: number;
}

export interface GeneratedReply {
  responseId: string;
  text: string;
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
          max_num_results: params.maxNumResults ?? 5,
        },
      ]
    : undefined;

  const response = await openai.responses.create({
    model: params.model,
    instructions: params.systemPrompt,
    input: params.input,
    previous_response_id: params.previousResponseId ?? undefined,
    tools,
    temperature: params.temperature,
  });

  return { responseId: response.id, text: response.output_text ?? "" };
}

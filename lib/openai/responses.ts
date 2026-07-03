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
  /**
   * `true` si el `previous_response_id` no se pudo usar (de otra cuenta/proyecto
   * o expirado) y se regeneró SIN encadenar. Ocurre, sobre todo, al rotar la
   * `OPENAI_API_KEY` a otra cuenta: los IDs viejos dejan de existir. Ver ADR-0025.
   */
  chainReset: boolean;
}

/**
 * ¿El error de `responses.create` es un `previous_response_id` que OpenAI no
 * encuentra? Pasa al migrar de cuenta/proyecto (los `resp_...` no son
 * portables) o cuando el id expiró. No confundir con otros 404 (modelo, vector
 * store): si el reintento SIN cadena vuelve a fallar, el error real se propaga.
 */
function isMissingPreviousResponse(e: unknown): boolean {
  const err = e as { status?: number; message?: string } | undefined;
  const msg = (err?.message ?? "").toLowerCase();
  return (
    err?.status === 404 ||
    (msg.includes("previous response") && msg.includes("not found")) ||
    (msg.includes("previous_response_id") && msg.includes("not found"))
  );
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

  const createWith = (previousResponseId: string | undefined) =>
    openai.responses.create({
      model: params.model,
      instructions: params.systemPrompt,
      input: buildResponsesInput(params.input, params.imageDataUrls),
      previous_response_id: previousResponseId,
      tools,
      temperature: params.temperature,
    });

  const prev = params.previousResponseId ?? undefined;
  let response: Awaited<ReturnType<typeof createWith>>;
  let chainReset = false;
  try {
    response = await createWith(prev);
  } catch (e) {
    // Cadena rota (p.ej. al migrar la API key a otra cuenta): el historial
    // canónico está en Supabase — `previous_response_id` es solo conveniencia —,
    // así que reintentamos SIN encadenar. El caller persiste el NUEVO id, con lo
    // que la conversación se auto-recupera desde el siguiente turno. Ver ADR-0025.
    if (prev && isMissingPreviousResponse(e)) {
      response = await createWith(undefined);
      chainReset = true;
    } else {
      throw e;
    }
  }

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

  return { responseId: response.id, text: response.output_text ?? "", usage, chainReset };
}

import "server-only";
import type OpenAI from "openai";
import type { TokenUsage } from "./responses";

/**
 * Extracción estructurada de la orden al cerrar (`#orden-lista`) — Sprint 5.
 *
 * Es una llamada APARTE (chat.completions con `response_format: json_schema`),
 * SOLO al cerrar la orden (no en cada mensaje). Lee la conversación y devuelve
 * ítems + datos de envío en JSON. No inventa: lo que no está, va como null.
 */

export interface OrderItemDraft {
  sku: string | null;
  name: string | null;
  qty: number;
  unit_price: number | null;
}

export interface OrderShippingDraft {
  name: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
}

export interface OrderDraft {
  items: OrderItemDraft[];
  shipping: OrderShippingDraft;
  fulfillment_method: "addi" | "cod" | null;
  notes: string | null;
  total: number | null;
}

const ORDER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          qty: { type: "integer" },
          unit_price: { type: ["number", "null"] },
        },
        required: ["sku", "name", "qty", "unit_price"],
      },
    },
    shipping: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
        city: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
      },
      required: ["name", "address", "city", "phone"],
    },
    fulfillment_method: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
  },
  required: ["items", "shipping", "fulfillment_method", "notes", "total"],
};

const EXTRACTION_INSTRUCTIONS = `Eres un extractor de datos de órdenes de venta por WhatsApp.
A partir de la conversación, devuelve la orden en JSON según el schema:
- items: cada producto que el cliente confirmó comprar, con su SKU (si aparece un #ID como
  #ID7948237144230, úsalo tal cual como sku), nombre, cantidad (entero >= 1) y precio unitario
  si se mencionó.
- shipping: nombre, dirección, ciudad y teléfono del cliente, si los dio.
- fulfillment_method: "addi" o "cod" (contra entrega) según lo que eligió; null si no está claro.
- notes: cualquier detalle relevante para logística.
- NO inventes datos: lo que no esté en la conversación va como null.`;

export interface ExtractOrderResult {
  draft: OrderDraft;
  /** Tokens consumidos por esta extracción (para el costo real del dashboard). */
  usage: TokenUsage | null;
}

export async function extractOrder(
  openai: OpenAI,
  transcript: string,
  model: string,
): Promise<ExtractOrderResult> {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: EXTRACTION_INSTRUCTIONS },
      { role: "user", content: transcript },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "order_draft", strict: true, schema: ORDER_JSON_SCHEMA },
    },
  });

  // chat.completions expone prompt/completion; lo mapeamos al mismo shape que
  // Responses (input/output) para que el costo se sume igual en el dashboard.
  const u = completion.usage;
  const usage: TokenUsage | null = u
    ? {
        inputTokens: u.prompt_tokens ?? 0,
        outputTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      }
    : null;

  const content = completion.choices[0]?.message?.content ?? "{}";
  try {
    return { draft: JSON.parse(content) as OrderDraft, usage };
  } catch (e) {
    throw new Error(`extractOrder: JSON inválido (${(e as Error).message})`);
  }
}

/**
 * Traducción de `events_log` a lenguaje humano para el panel de diagnóstico de la
 * conversación ("¿por qué no respondió?"). Lógica PURA (sin I/O): recibe el `type`
 * y el `payload` crudo de un evento y devuelve una etiqueta, un detalle corto y un
 * "tono" (color). Cubre bien los eventos que explican por qué el bot respondió o
 * NO; el resto cae a una etiqueta genérica legible con el tipo crudo.
 */

export type EventTone = "neutral" | "good" | "warn" | "error";

export interface EventView {
  label: string;
  detail: string | null;
  tone: EventTone;
}

/** Lee el payload como objeto plano (los eventos guardan JSON arbitrario). */
function obj(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Motivos de `reply_skipped` en lenguaje claro. */
const SKIP_REASON: Record<string, string> = {
  "manual-mode": "estaba en modo manual (un humano la atiende)",
  "no-agent": "no hay un agente configurado para la conversación",
  "agent-inactive": "el agente estaba fuera de su horario",
};

/** Traduce un evento del rastro a algo legible para el operador. */
export function describeEvent(type: string, payload: unknown): EventView {
  const p = obj(payload);
  switch (type) {
    case "webhook_received":
      return { label: "Mensaje recibido del cliente", detail: null, tone: "neutral" };
    case "reply_generated":
      return { label: "Respuesta generada por la IA", detail: null, tone: "good" };
    case "text_sent":
      return { label: "Texto enviado al cliente", detail: null, tone: "good" };
    case "image_sent":
      return { label: "Imagen enviada al cliente", detail: str(p.sku), tone: "good" };
    case "reply_skipped": {
      const reason = str(p.reason);
      return {
        label: "No respondió",
        detail: reason ? SKIP_REASON[reason] ?? reason : null,
        tone: "warn",
      };
    }
    case "process_error": {
      const phase = str(p.phase);
      const error = str(p.error);
      const where =
        phase === "reply"
          ? "al generar o enviar la respuesta"
          : phase === "ingest"
            ? "al guardar el mensaje"
            : phase === "resolve-agent"
              ? "al resolver el agente"
              : phase;
      return {
        label: "Error al procesar",
        detail: [where, error].filter(Boolean).join(": ") || null,
        tone: "error",
      };
    }
    case "out_of_window":
      return {
        label: "Fuera de la ventana de 24 h",
        detail: "no se puede enviar sin una plantilla aprobada",
        tone: "warn",
      };
    case "gate_blocked": {
      const skus = Array.isArray(p.blockedSkus) ? (p.blockedSkus as unknown[]).join(", ") : null;
      return {
        label: "Bloqueado por el gate anti-alucinación",
        detail: skus ? `SKU que no existe en el catálogo: ${skus}` : "SKU inexistente",
        tone: "warn",
      };
    }
    case "image_missing":
      return { label: "Producto sin imagen configurada", detail: str(p.sku), tone: "warn" };
    case "chain_reset":
      return { label: "Contexto reiniciado (cadena de OpenAI)", detail: null, tone: "neutral" };
    case "order_created":
      return { label: "Orden creada", detail: null, tone: "good" };
    case "order_inferred_skipped":
      return { label: "Cierre inferido sin datos → no creó orden", detail: null, tone: "neutral" };
    case "handoff":
      return { label: "Pasó a un humano (handoff)", detail: str(p.reason), tone: "good" };
    case "audio_transcribed":
      return { label: "Nota de voz transcrita", detail: null, tone: "neutral" };
    case "audio_transcribe_failed":
      return {
        label: "No se pudo transcribir la nota de voz",
        detail: str(p.error),
        tone: "warn",
      };
    case "image_received":
      return { label: "Imagen del cliente procesada (visión)", detail: null, tone: "neutral" };
    case "image_fetch_failed":
      return { label: "No se pudo procesar la imagen del cliente", detail: null, tone: "warn" };
    case "retarget_sent":
      return { label: "Seguimiento (retarget) enviado", detail: null, tone: "good" };
    case "reactivation_sent":
      return { label: "Plantilla de reactivación enviada", detail: null, tone: "good" };
    case "reactivation_skipped":
    case "reactivation_cancelled":
    case "reactivation_deferred":
      return { label: humanizeType(type), detail: str(p.reason), tone: "neutral" };
    case "manual_on":
      return { label: "Pasó a modo manual", detail: null, tone: "neutral" };
    case "manual_off":
      return { label: "Volvió a modo automático", detail: null, tone: "neutral" };
    case "manual_message_sent":
      return { label: "Mensaje manual enviado por un operador", detail: null, tone: "neutral" };
    case "retry_requested":
      return { label: "Reintento manual solicitado", detail: null, tone: "neutral" };
    case "sales_notification_sent":
      return { label: "Aviso de venta enviado al dueño", detail: null, tone: "neutral" };
    case "sales_notification_failed":
      return { label: "Falló el aviso de venta al dueño", detail: str(p.error), tone: "warn" };
    case "call_requested":
      return { label: "El cliente pidió que lo llamen", detail: null, tone: "neutral" };
    default:
      return { label: humanizeType(type), detail: null, tone: "neutral" };
  }
}

/** Fallback: `some_event_type` → "Some event type" legible. */
function humanizeType(type: string): string {
  const s = type.replace(/[_-]+/g, " ").trim();
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : type;
}

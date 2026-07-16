/**
 * Puerto de mensajería — el contrato que el cerebro del agente usa para hablarle
 * al cliente, sin saber por qué proveedor sale (Callbell o Kapso). Lógica PURA
 * (sin I/O ni `server-only`): acá solo viven tipos y helpers testeables.
 *
 * Por qué existe: hasta ADR-0056 el flujo (`processMessage`, retargets,
 * reactivaciones, videos, Hotmart, envío manual) llamaba directo al sender de
 * Callbell. Para operar una segunda línea en **Kapso** sin duplicar el cerebro
 * (debounce, gate anti-alucinación, cierre de venta, ventana de 24h), el envío se
 * volvió un **puerto** con dos adaptadores. Cada agente elige el suyo en
 * `agents.provider`; ambos conviven en el mismo deploy. Ver docs/24, ADR-0056.
 */

/** Proveedores de WhatsApp soportados. `callbell` es el histórico (default). */
export type MessagingProviderId = "callbell" | "kapso";

export const MESSAGING_PROVIDERS: readonly MessagingProviderId[] = ["callbell", "kapso"] as const;

export const DEFAULT_PROVIDER: MessagingProviderId = "callbell";

/**
 * Normaliza el valor de `agents.provider` leído de la base. Cualquier cosa
 * desconocida (o null, o la columna ausente antes de la migración 0026) cae a
 * `callbell`: el comportamiento histórico nunca depende de la migración.
 */
export function normalizeProviderId(raw: unknown): MessagingProviderId {
  return raw === "kapso" ? "kapso" : DEFAULT_PROVIDER;
}

/** Nombre visible del proveedor (dashboard). */
export function providerLabel(id: MessagingProviderId): string {
  return id === "kapso" ? "Kapso" : "Callbell";
}

/**
 * Resultado de un envío. `uuid` es el id del mensaje EN EL PROVEEDOR (uuid en
 * Callbell, id en Kapso) y se guarda en `messages.callbell_message_uuid`, que
 * desde ADR-0056 es "el id del proveedor" (ver el comentario de la columna en la
 * migración 0026). `status` es informativo (`enqueued`, `sent`, …).
 */
export interface SentMessage {
  uuid: string | null;
  status: string | null;
}

/** Opciones comunes de un envío normal. */
export interface SendOptions {
  /** Metadata del proveedor (trazabilidad: `conversation_id`, `source`, …). */
  metadata?: Record<string, unknown>;
  /**
   * Handoff: reasigna la conversación a un equipo humano. Solo Callbell lo
   * implementa; un proveedor sin equipos lo ignora (ver `supportsHandoff`).
   */
  teamUuid?: string | null;
  /** Handoff: `bot_end` detiene el bot DEL PROVEEDOR en esa conversación. */
  botStatus?: "bot_start" | "bot_end";
}

/** Opciones de un envío de plantilla aprobada (único envío fuera de la ventana de 24h). */
export interface SendTemplateOptions {
  /**
   * Texto ya interpolado. En Callbell viaja en `content.text` (convención de las
   * plantillas de una variable); en Kapso solo se usa para lo que guardamos en
   * `messages` (las variables van por `templateValues`).
   */
  text?: string;
  /** Variables del cuerpo, EN ORDEN ({{1}}, {{2}}, …). Vacío = plantilla sin variables. */
  templateValues?: string[];
  /** Header de imagen de la plantilla (null = plantilla de solo texto). Ver ADR-0044. */
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Referencia a una plantilla aprobada, tal como se guardó en la base
 * (`agents.reactivation_template_7d/15d`, `hotmart_templates.template_uuid`).
 *
 * El formato depende del proveedor y por eso NO se interpreta acá:
 *  - Callbell: el `uuid` de la plantilla en su cuenta.
 *  - Kapso: el nombre de la plantilla (+ idioma opcional, ver `parseTemplateRef`).
 */
export type TemplateRef = string;

/**
 * Adaptador de un proveedor. El cerebro solo ve esta interfaz: no sabe de API
 * keys, canales ni shapes de payload.
 */
export interface MessagingProvider {
  readonly id: MessagingProviderId;
  /**
   * ¿El proveedor sabe reasignar a un equipo humano y apagar su propio bot
   * (`teamUuid` + `botStatus`)? Si es false, el handoff igual funciona: lo que
   * calla a NUESTRA IA es `conversations.status = 'handed_off'`, no el proveedor.
   * Ver ADR-0056 §Handoff.
   */
  readonly supportsHandoff: boolean;
  sendText(to: string, text: string, options?: SendOptions): Promise<SentMessage>;
  sendImage(
    to: string,
    url: string,
    caption?: string | null,
    options?: SendOptions,
  ): Promise<SentMessage>;
  sendVideo(
    to: string,
    url: string,
    caption?: string | null,
    options?: SendOptions,
  ): Promise<SentMessage>;
  sendTemplate(
    to: string,
    template: TemplateRef,
    options?: SendTemplateOptions,
  ): Promise<SentMessage>;
}

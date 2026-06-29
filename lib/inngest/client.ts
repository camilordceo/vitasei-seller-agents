import { Inngest, EventSchemas } from "inngest";

/**
 * Payload normalizado que el webhook encola. Mantenemos `raw` (el body completo
 * de Callbell) para poder refinar el parser contra mensajes reales y para
 * trazabilidad en `events_log`.
 */
export type WhatsappMessageReceived = {
  data: {
    /** Teléfono normalizado E.164 sin '+' (ej: 573001234567). Clave de concurrencia. */
    phone: string;
    /** UUID del mensaje en Callbell — clave de idempotencia. */
    messageUuid: string;
    /** Texto del mensaje inbound (si aplica). */
    text: string | null;
    /** Tipo de mensaje reportado por Callbell (text/image/...). */
    messageType: string | null;
    /** Nombre del contacto (si Callbell lo entrega). */
    contactName: string | null;
    /** UUID del contacto en Callbell. */
    callbellContactUuid: string | null;
    /** Referencia/href de la conversación en Callbell. */
    conversationHref: string | null;
    /** Body crudo del webhook, para trazabilidad y refinamiento del parser. */
    raw: unknown;
  };
};

type AppEvents = {
  "whatsapp/message.received": WhatsappMessageReceived;
};

export const inngest = new Inngest({
  id: "ai-seller-vitasei",
  schemas: new EventSchemas().fromRecord<AppEvents>(),
});

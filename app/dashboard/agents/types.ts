import type { CatalogProductInput } from "@/lib/openai/catalog";
import type { AgentSchedule } from "@/lib/agent/schedule";
import type { PaymentMethodConfig } from "@/lib/agent/paymentMethods";
import type { MessagingProviderId } from "@/lib/messaging/types";

/** Datos editables de un agente (marca/número) desde el dashboard. Ver docs/16, docs/24. */
export interface AgentEditInput {
  name: string;
  brand: string;
  country: string;
  whatsappNumber: string;
  /** Proveedor de WhatsApp del agente: por acá sale y por acá entra. Ver ADR-0056. */
  provider: MessagingProviderId;
  callbellChannelUuid: string;
  /** Nueva API key de Callbell; VACÍO = no cambiar (write-only, no se muestra). */
  callbellApiKey: string;
  /** Meta Phone Number ID del número en Kapso (envío + enrutamiento del inbound). */
  kapsoPhoneNumberId: string;
  /** Nueva API key de Kapso; VACÍO = no cambiar (write-only). */
  kapsoApiKey: string;
  /** Nuevo secreto de firma del webhook de Kapso; VACÍO = no cambiar (write-only). */
  kapsoWebhookSecret: string;
  /** Idioma por defecto de las plantillas de Kapso (`es`, `es_CO`…). */
  kapsoTemplateLanguage: string;
  logisticsTeamUuid: string;
  vectorStoreId: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  enabled: boolean;
  /** Horario (encendido/apagado). Ver ADR-0029. */
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  schedule: AgentSchedule;
  /** Métodos de pago del agente (tags de compra por mercado). Ver ADR-0055. */
  paymentMethods: PaymentMethodConfig[];
  /** PayPal (EE.UU.): Client ID de la app REST; vacío = feature apagado. Ver ADR-0088. */
  paypalClientId: string;
  /** Nuevo Client Secret; VACÍO = no cambiar (write-only, no se muestra). */
  paypalClientSecret: string;
  /** true = Sandbox de PayPal (pruebas); false = producción (Live). */
  paypalSandbox: boolean;
  /** Impuesto (%) por ítem, como texto (viene de un `<input>`); vacío = 0. */
  paypalTaxPercent: string;
  /** Costo de envío fijo (moneda del agente), como texto; vacío = 0. */
  paypalShipping: string;
  /** Mensaje que acompaña el link de pago (`{link}` = dónde va el link). */
  paypalMessage: string;
  /**
   * Costo de traer UNA conversación (pauta) en este mercado. Texto porque viene de
   * un `<input>`: vacío = sin configurar. Alimenta el retorno (ROAS). Ver ADR-0065.
   */
  costPerChat: string;
  /** Moneda ISO del costo por chat y de la lectura de retorno (COP, USD…). */
  costCurrency: string;
  /**
   * Moneda en la que este agente VENDE (COP · USD · MXN). Manda en Órdenes al
   * filtrar por él y se sella en cada orden nueva. Distinta de `costCurrency`,
   * que es la moneda de la pauta. Ver ADR-0068.
   */
  currency: string;
}

/** Carga de catálogo desde el editor de agente (server action `loadAgentCatalog`). */
export interface AgentCatalogInput {
  /**
   * `create` = crear/usar el vector store del agente y subir los docs;
   * `add` = agregar/actualizar productos MANTENIENDO el vector store actual (merge:
   *   no borra lo que ya había en el catálogo);
   * `existing` = solo cargar a Supabase (el store ya existe en OpenAI).
   */
  mode: "create" | "add" | "existing";
  products: CatalogProductInput[];
  filename?: string | null;
}

/**
 * Config de llamadas con IA de un agente (server action `saveVoiceConfig`).
 * Ver docs/25 y ADR-0060..0063.
 */
export interface VoiceConfigInput {
  voiceEnabled: boolean;
  /** Assistant de Synthflow que ejecuta la llamada. Se referencia, no se muta. */
  modelId: string;
  /** Número saliente en E.164 CON `+` (convención de Synthflow). */
  fromNumber: string;
  voiceId: string;
  voiceName: string;
  /** Prompt de VOZ, separado del de WhatsApp. */
  prompt: string;
  greeting: string;
  /** Vacío = no se pisa el secreto guardado (patrón del resto de credenciales). */
  apiKey: string;
  /** Etapas de la cadencia: `[{delayMinutes, guidance}]`. */
  stages: Array<{ delayMinutes: number; guidance: string | null }>;
  /** Prefijos E.164 permitidos (`["57"]`). Vacío = todos. */
  countries: string[];
  /** Extractores de información configurables por agente. */
  extractors: Array<{
    identifier: string;
    type: string;
    condition: string;
    choices: string[];
    examples: string[];
    actionId?: string | null;
    /** Este extractor dice en qué terminó la llamada (ADR-0083). Solo uno manda. */
    outcome?: boolean;
    /** Valores del resultado que significan compra → generan la orden. */
    saleValues?: string[];
    /** Campo de la orden que alimenta el dato (`name`, `address`…). */
    orderField?: string | null;
  }>;
  stopWhenAnswered: boolean;
}

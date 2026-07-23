/**
 * Tipos de la base de datos de Supabase.
 *
 * Escrito a mano a partir de `supabase/migrations/0001_init.sql`. Cuando el
 * proyecto Supabase esté provisionado se puede regenerar con:
 *   supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 *
 * Cada tabla incluye `Relationships: []` porque postgrest-js lo exige en su
 * `GenericTable` (sin ello, las operaciones tipadas colapsan a `never`).
 */

export type ConversationStatus = "active" | "handed_off" | "closed";
export type MessageDirection = "inbound" | "outbound";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "other";
/**
 * Método de pago/fulfillment. Desde ADR-0055 es TEXTO LIBRE: cada agente define
 * sus métodos (Colombia: `cod`/`addi`; EE.UU.: `zelle`; etc.). `undecided` es el
 * sentinela de "aún no elegido". El tipo se deja abierto (`string`) manteniendo las
 * claves conocidas como pista para el autocompletado.
 */
export type FulfillmentMethod = "addi" | "cod" | "undecided" | (string & {});
export type OrderStatus =
  | "pending_handoff"
  | "handed_off"
  | "confirmed"
  | "cancelled";
export type RetargetStatus =
  | "scheduled"
  | "processing"
  | "sent"
  | "skipped"
  | "cancelled"
  | "failed";
export type CallRequestStatus = "pending" | "done" | "cancelled";
/** Estado de una llamada con IA. Texto + CHECK en la base (ADR-0063). */
export type VoiceCallStatus =
  | "scheduled"
  | "processing"
  | "placed"
  | "completed"
  | "no_answer"
  | "failed"
  | "cancelled"
  | "skipped";
/** `campaign` = fila de una campaña de llamadas masivas (ADR-0084). */
export type VoiceCallTrigger = "auto" | "manual" | "request" | "campaign";
/** Estado de una campaña de llamadas masivas. Texto + CHECK (ADR-0084). */
export type VoiceCampaignStatus = "running" | "paused" | "completed" | "cancelled";
/** `voice` = la conversación nació de una llamada con IA que cerró venta (ADR-0083). */
export type ConversationSource = "whatsapp" | "hotmart" | "manual" | "other" | "voice";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      contacts: {
        Row: {
          id: string;
          callbell_contact_uuid: string | null;
          phone: string;
          name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          callbell_contact_uuid?: string | null;
          phone: string;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          callbell_contact_uuid?: string | null;
          phone?: string;
          name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          contact_id: string;
          agent_id: string | null;
          callbell_conversation_href: string | null;
          status: ConversationStatus;
          fulfillment_method: FulfillmentMethod;
          ai_paused: boolean;
          source: ConversationSource;
          hotmart_flow: boolean;
          product_category: string | null;
          openai_previous_response_id: string | null;
          assigned_team_uuid: string | null;
          last_inbound_at: string | null;
          last_inbound_message_uuid: string | null;
          last_outbound_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          agent_id?: string | null;
          callbell_conversation_href?: string | null;
          status?: ConversationStatus;
          fulfillment_method?: FulfillmentMethod;
          ai_paused?: boolean;
          source?: ConversationSource;
          hotmart_flow?: boolean;
          product_category?: string | null;
          openai_previous_response_id?: string | null;
          assigned_team_uuid?: string | null;
          last_inbound_at?: string | null;
          last_inbound_message_uuid?: string | null;
          last_outbound_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          contact_id?: string;
          agent_id?: string | null;
          callbell_conversation_href?: string | null;
          status?: ConversationStatus;
          fulfillment_method?: FulfillmentMethod;
          ai_paused?: boolean;
          source?: ConversationSource;
          hotmart_flow?: boolean;
          product_category?: string | null;
          openai_previous_response_id?: string | null;
          assigned_team_uuid?: string | null;
          last_inbound_at?: string | null;
          last_inbound_message_uuid?: string | null;
          last_outbound_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          direction: MessageDirection;
          role: MessageRole;
          type: MessageType;
          content: string | null;
          media_url: string | null;
          tags: Json;
          callbell_message_uuid: string | null;
          openai_response_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          direction: MessageDirection;
          role: MessageRole;
          type?: MessageType;
          content?: string | null;
          media_url?: string | null;
          tags?: Json;
          callbell_message_uuid?: string | null;
          openai_response_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          direction?: MessageDirection;
          role?: MessageRole;
          type?: MessageType;
          content?: string | null;
          media_url?: string | null;
          tags?: Json;
          callbell_message_uuid?: string | null;
          openai_response_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          agent_id: string;
          sku: string;
          name: string;
          description: string | null;
          price: number | null;
          currency: string;
          image_url: string | null;
          in_stock: boolean;
          vector_store_file_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          sku: string;
          name: string;
          description?: string | null;
          price?: number | null;
          currency?: string;
          image_url?: string | null;
          in_stock?: boolean;
          vector_store_file_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          sku?: string;
          name?: string;
          description?: string | null;
          price?: number | null;
          currency?: string;
          image_url?: string | null;
          in_stock?: boolean;
          vector_store_file_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          conversation_id: string;
          contact_id: string;
          status: OrderStatus;
          fulfillment_method: FulfillmentMethod;
          shipping_name: string | null;
          shipping_address: string | null;
          shipping_city: string | null;
          shipping_phone: string | null;
          notes: string | null;
          total: number | null;
          currency: string;
          /** Link de pago (invoice PayPal) de esta orden. Ver ADR-0088. */
          payment_link: string | null;
          /** Id del invoice en PayPal (INV2-...). */
          payment_link_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          contact_id: string;
          status?: OrderStatus;
          fulfillment_method: FulfillmentMethod;
          shipping_name?: string | null;
          shipping_address?: string | null;
          shipping_city?: string | null;
          shipping_phone?: string | null;
          notes?: string | null;
          total?: number | null;
          currency?: string;
          payment_link?: string | null;
          payment_link_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          contact_id?: string;
          status?: OrderStatus;
          fulfillment_method?: FulfillmentMethod;
          shipping_name?: string | null;
          shipping_address?: string | null;
          shipping_city?: string | null;
          shipping_phone?: string | null;
          notes?: string | null;
          total?: number | null;
          currency?: string;
          payment_link?: string | null;
          payment_link_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string | null;
          sku: string;
          name: string | null;
          qty: number;
          unit_price: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id?: string | null;
          sku: string;
          name?: string | null;
          qty?: number;
          unit_price?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_id?: string | null;
          sku?: string;
          name?: string | null;
          qty?: number;
          unit_price?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agents: {
        Row: {
          id: string;
          name: string;
          brand: string | null;
          country: string | null;
          whatsapp_number: string | null;
          /**
           * Proveedor de WhatsApp: 'callbell' (histórico, default) | 'kapso'.
           * Puede llegar `undefined` en runtime si la migración 0026 aún no está
           * aplicada (`selectAgents` reintenta sin las columnas nuevas), por eso
           * SIEMPRE se lee con `agentProvider()`/`normalizeProviderId()`. Ver ADR-0056.
           */
          provider: string | null;
          /** SECRETO — API key del proyecto de Kapso (header `X-API-Key`). */
          kapso_api_key: string | null;
          /** Meta Phone Number ID: path de envío + enrutamiento del inbound. */
          kapso_phone_number_id: string | null;
          /** SECRETO — `secret_key` de la firma HMAC del webhook de Kapso. */
          kapso_webhook_secret: string | null;
          /** Idioma por defecto de las plantillas de Kapso (`es`, `es_CO`, …). */
          kapso_template_language: string | null;
          callbell_channel_uuid: string | null;
          callbell_api_key: string | null;
          logistics_team_uuid: string | null;
          vector_store_id: string | null;
          model: string;
          system_prompt: string;
          temperature: number;
          enabled: boolean;
          schedule_enabled: boolean;
          schedule_timezone: string;
          schedule: Json;
          reactivation_enabled: boolean;
          reactivation_template_7d: string | null;
          reactivation_template_15d: string | null;
          reactivation_image_7d: string | null;
          reactivation_image_15d: string | null;
          hotmart_enabled: boolean;
          retarget_instruction_1: string | null;
          retarget_instruction_2: string | null;
          retarget_config: Json | null;
          payment_methods: Json | null;
          /** Config de PayPal ({client_id, client_secret, sandbox, message, tax_percent, shipping}). Ver ADR-0088. */
          paypal_config: Json | null;
          voice_enabled: boolean;
          synthflow_api_key: string | null;
          synthflow_model_id: string | null;
          synthflow_from_number: string | null;
          voice_id: string | null;
          voice_name: string | null;
          voice_prompt: string | null;
          voice_greeting: string | null;
          voice_config: Json | null;
          voice_countries: Json | null;
          voice_extractors: Json | null;
          voice_stop_when_answered: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          brand?: string | null;
          country?: string | null;
          whatsapp_number?: string | null;
          provider?: string | null;
          kapso_api_key?: string | null;
          kapso_phone_number_id?: string | null;
          kapso_webhook_secret?: string | null;
          kapso_template_language?: string | null;
          callbell_channel_uuid?: string | null;
          callbell_api_key?: string | null;
          logistics_team_uuid?: string | null;
          vector_store_id?: string | null;
          model?: string;
          system_prompt: string;
          temperature?: number;
          enabled?: boolean;
          schedule_enabled?: boolean;
          schedule_timezone?: string;
          schedule?: Json;
          reactivation_enabled?: boolean;
          reactivation_template_7d?: string | null;
          reactivation_template_15d?: string | null;
          reactivation_image_7d?: string | null;
          reactivation_image_15d?: string | null;
          hotmart_enabled?: boolean;
          retarget_instruction_1?: string | null;
          retarget_instruction_2?: string | null;
          retarget_config?: Json | null;
          payment_methods?: Json | null;
          paypal_config?: Json | null;
          voice_enabled?: boolean;
          synthflow_api_key?: string | null;
          synthflow_model_id?: string | null;
          synthflow_from_number?: string | null;
          voice_id?: string | null;
          voice_name?: string | null;
          voice_prompt?: string | null;
          voice_greeting?: string | null;
          voice_config?: Json | null;
          voice_countries?: Json | null;
          voice_extractors?: Json | null;
          voice_stop_when_answered?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          brand?: string | null;
          country?: string | null;
          whatsapp_number?: string | null;
          provider?: string | null;
          kapso_api_key?: string | null;
          kapso_phone_number_id?: string | null;
          kapso_webhook_secret?: string | null;
          kapso_template_language?: string | null;
          callbell_channel_uuid?: string | null;
          callbell_api_key?: string | null;
          logistics_team_uuid?: string | null;
          vector_store_id?: string | null;
          model?: string;
          system_prompt?: string;
          temperature?: number;
          enabled?: boolean;
          schedule_enabled?: boolean;
          schedule_timezone?: string;
          schedule?: Json;
          reactivation_enabled?: boolean;
          reactivation_template_7d?: string | null;
          reactivation_template_15d?: string | null;
          reactivation_image_7d?: string | null;
          reactivation_image_15d?: string | null;
          hotmart_enabled?: boolean;
          retarget_instruction_1?: string | null;
          retarget_instruction_2?: string | null;
          retarget_config?: Json | null;
          payment_methods?: Json | null;
          paypal_config?: Json | null;
          voice_enabled?: boolean;
          synthflow_api_key?: string | null;
          synthflow_model_id?: string | null;
          synthflow_from_number?: string | null;
          voice_id?: string | null;
          voice_name?: string | null;
          voice_prompt?: string | null;
          voice_greeting?: string | null;
          voice_config?: Json | null;
          voice_countries?: Json | null;
          voice_extractors?: Json | null;
          voice_stop_when_answered?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_config: {
        Row: {
          id: string;
          name: string;
          system_prompt: string;
          model: string;
          vector_store_id: string | null;
          temperature: number;
          version: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          system_prompt: string;
          model?: string;
          vector_store_id?: string | null;
          temperature?: number;
          version?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          system_prompt?: string;
          model?: string;
          vector_store_id?: string | null;
          temperature?: number;
          version?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      events_log: {
        Row: {
          id: string;
          conversation_id: string | null;
          type: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id?: string | null;
          type: string;
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string | null;
          type?: string;
          payload?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      /** Gasto real en pauta recibido por API (migración 0031, ADR-0082). */
      ad_spend: {
        Row: {
          id: string;
          agent_id: string;
          date: string;
          platform: string;
          account_id: string | null;
          campaign_id: string;
          campaign_name: string | null;
          spend: number;
          currency: string;
          impressions: number | null;
          clicks: number | null;
          leads: number | null;
          source: string;
          raw: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          date: string;
          platform?: string;
          account_id?: string | null;
          campaign_id?: string;
          campaign_name?: string | null;
          spend?: number;
          currency: string;
          impressions?: number | null;
          clicks?: number | null;
          leads?: number | null;
          source?: string;
          raw?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          date?: string;
          platform?: string;
          account_id?: string | null;
          campaign_id?: string;
          campaign_name?: string | null;
          spend?: number;
          currency?: string;
          impressions?: number | null;
          clicks?: number | null;
          leads?: number | null;
          source?: string;
          raw?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      voice_campaigns: {
        Row: {
          id: string;
          agent_id: string;
          name: string;
          status: VoiceCampaignStatus;
          /** Minutos entre llamada y llamada. */
          interval_minutes: number;
          guidance: string | null;
          /** Saludo propio de la campaña, con `{variables}` (ADR-0086). */
          greeting: string | null;
          /** Variables fijas de la campaña; las del archivo mandan sobre estas. */
          variables: Json | null;
          source_filename: string | null;
          total: number;
          starts_at: string;
          finished_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          name: string;
          status?: VoiceCampaignStatus;
          interval_minutes?: number;
          guidance?: string | null;
          greeting?: string | null;
          variables?: Json | null;
          source_filename?: string | null;
          total?: number;
          starts_at?: string;
          finished_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          name?: string;
          status?: VoiceCampaignStatus;
          interval_minutes?: number;
          guidance?: string | null;
          greeting?: string | null;
          variables?: Json | null;
          source_filename?: string | null;
          total?: number;
          starts_at?: string;
          finished_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      voice_calls: {
        Row: {
          id: string;
          /** NULL en las llamadas de campaña: un número frío no tiene chat (ADR-0084). */
          conversation_id: string | null;
          contact_id: string | null;
          agent_id: string | null;
          campaign_id: string | null;
          contact_name: string | null;
          variables: Json | null;
          /** Valor del extractor de resultado (`compra`, `no interesada`…). ADR-0083. */
          outcome: string | null;
          /** Orden generada por la llamada (resultado = compra). ADR-0083. */
          order_id: string | null;
          phone: string;
          stage: number;
          delay_minutes: number | null;
          trigger: VoiceCallTrigger;
          status: VoiceCallStatus;
          scheduled_at: string;
          anchor_inbound_at: string | null;
          placed_at: string | null;
          started_at: string | null;
          ended_at: string | null;
          synthflow_call_id: string | null;
          synthflow_model_id: string | null;
          call_status: string | null;
          end_call_reason: string | null;
          duration_sec: number | null;
          cost_usd: number | null;
          transcript: string | null;
          recording_url: string | null;
          summary: string | null;
          extracted: Json | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id?: string | null;
          contact_id?: string | null;
          agent_id?: string | null;
          campaign_id?: string | null;
          contact_name?: string | null;
          variables?: Json | null;
          outcome?: string | null;
          order_id?: string | null;
          phone: string;
          stage?: number;
          delay_minutes?: number | null;
          trigger?: VoiceCallTrigger;
          status?: VoiceCallStatus;
          scheduled_at?: string;
          anchor_inbound_at?: string | null;
          placed_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          synthflow_call_id?: string | null;
          synthflow_model_id?: string | null;
          call_status?: string | null;
          end_call_reason?: string | null;
          duration_sec?: number | null;
          cost_usd?: number | null;
          transcript?: string | null;
          recording_url?: string | null;
          summary?: string | null;
          extracted?: Json | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string | null;
          contact_id?: string | null;
          agent_id?: string | null;
          campaign_id?: string | null;
          contact_name?: string | null;
          variables?: Json | null;
          outcome?: string | null;
          order_id?: string | null;
          phone?: string;
          stage?: number;
          delay_minutes?: number | null;
          trigger?: VoiceCallTrigger;
          status?: VoiceCallStatus;
          scheduled_at?: string;
          anchor_inbound_at?: string | null;
          placed_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          synthflow_call_id?: string | null;
          synthflow_model_id?: string | null;
          call_status?: string | null;
          end_call_reason?: string | null;
          duration_sec?: number | null;
          cost_usd?: number | null;
          transcript?: string | null;
          recording_url?: string | null;
          summary?: string | null;
          extracted?: Json | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      retargets: {
        Row: {
          id: string;
          conversation_id: string;
          contact_id: string;
          phone: string;
          stage: number;
          delay_minutes: number | null;
          status: RetargetStatus;
          scheduled_at: string;
          anchor_inbound_at: string | null;
          sent_at: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          contact_id: string;
          phone: string;
          stage: number;
          delay_minutes?: number | null;
          status?: RetargetStatus;
          scheduled_at: string;
          anchor_inbound_at?: string | null;
          sent_at?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          contact_id?: string;
          phone?: string;
          stage?: number;
          delay_minutes?: number | null;
          status?: RetargetStatus;
          scheduled_at?: string;
          anchor_inbound_at?: string | null;
          sent_at?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      catalog_imports: {
        Row: {
          id: string;
          filename: string | null;
          status: string;
          vector_store_file_id: string | null;
          rows_imported: number | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          filename?: string | null;
          status?: string;
          vector_store_file_id?: string | null;
          rows_imported?: number | null;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          filename?: string | null;
          status?: string;
          vector_store_file_id?: string | null;
          rows_imported?: number | null;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          id: number;
          reactivation_enabled: boolean;
          reactivation_template_7d: string | null;
          reactivation_template_15d: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          reactivation_enabled?: boolean;
          reactivation_template_7d?: string | null;
          reactivation_template_15d?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          reactivation_enabled?: boolean;
          reactivation_template_7d?: string | null;
          reactivation_template_15d?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      call_requests: {
        Row: {
          id: string;
          conversation_id: string;
          contact_id: string;
          agent_id: string | null;
          phone: string;
          note: string | null;
          status: CallRequestStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          contact_id: string;
          agent_id?: string | null;
          phone: string;
          note?: string | null;
          status?: CallRequestStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          contact_id?: string;
          agent_id?: string | null;
          phone?: string;
          note?: string | null;
          status?: CallRequestStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      videos: {
        Row: {
          id: string;
          agent_id: string | null;
          keyword: string;
          video_url: string;
          caption: string | null;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id?: string | null;
          keyword: string;
          video_url: string;
          caption?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string | null;
          keyword?: string;
          video_url?: string;
          caption?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reactivations: {
        Row: {
          id: string;
          conversation_id: string;
          contact_id: string;
          phone: string;
          stage: number;
          status: RetargetStatus;
          scheduled_at: string;
          template_uuid: string | null;
          sent_at: string | null;
          cost_usd: number | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          contact_id: string;
          phone: string;
          stage: number;
          status?: RetargetStatus;
          scheduled_at: string;
          template_uuid?: string | null;
          sent_at?: string | null;
          cost_usd?: number | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          contact_id?: string;
          phone?: string;
          stage?: number;
          status?: RetargetStatus;
          scheduled_at?: string;
          template_uuid?: string | null;
          sent_at?: string | null;
          cost_usd?: number | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      hotmart_events: {
        Row: {
          id: string;
          hotmart_event_id: string;
          event_type: string;
          phone: string;
          email: string | null;
          buyer_name: string | null;
          product_id: string | null;
          product_name: string | null;
          offer_code: string | null;
          contact_id: string | null;
          conversation_id: string | null;
          agent_id: string | null;
          message_sent: boolean;
          message_uuid: string | null;
          send_error: string | null;
          raw_payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          hotmart_event_id: string;
          event_type: string;
          phone: string;
          email?: string | null;
          buyer_name?: string | null;
          product_id?: string | null;
          product_name?: string | null;
          offer_code?: string | null;
          contact_id?: string | null;
          conversation_id?: string | null;
          agent_id?: string | null;
          message_sent?: boolean;
          message_uuid?: string | null;
          send_error?: string | null;
          raw_payload: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          hotmart_event_id?: string;
          event_type?: string;
          phone?: string;
          email?: string | null;
          buyer_name?: string | null;
          product_id?: string | null;
          product_name?: string | null;
          offer_code?: string | null;
          contact_id?: string | null;
          conversation_id?: string | null;
          agent_id?: string | null;
          message_sent?: boolean;
          message_uuid?: string | null;
          send_error?: string | null;
          raw_payload?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      hotmart_templates: {
        Row: {
          id: string;
          agent_id: string | null;
          event_type: string;
          product_id: string | null;
          name: string;
          template_uuid: string | null;
          message_text: string | null;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id?: string | null;
          event_type?: string;
          product_id?: string | null;
          name: string;
          template_uuid?: string | null;
          message_text?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string | null;
          event_type?: string;
          product_id?: string | null;
          name?: string;
          template_uuid?: string | null;
          message_text?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      labels: {
        Row: {
          id: string;
          name: string;
          color: string;
          agent_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          color?: string;
          agent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          color?: string;
          agent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversation_labels: {
        Row: {
          conversation_id: string;
          label_id: string;
          created_at: string;
        };
        Insert: {
          conversation_id: string;
          label_id: string;
          created_at?: string;
        };
        Update: {
          conversation_id?: string;
          label_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      conversation_status: ConversationStatus;
      conversation_source: ConversationSource;
      message_direction: MessageDirection;
      message_role: MessageRole;
      message_type: MessageType;
      fulfillment_method: FulfillmentMethod;
      order_status: OrderStatus;
      retarget_status: RetargetStatus;
      call_request_status: CallRequestStatus;
    };
  };
}

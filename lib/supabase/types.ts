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
export type ConversationSource = "whatsapp" | "hotmart" | "manual" | "other";

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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          brand?: string | null;
          country?: string | null;
          whatsapp_number?: string | null;
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
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          brand?: string | null;
          country?: string | null;
          whatsapp_number?: string | null;
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

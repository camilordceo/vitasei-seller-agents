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
export type FulfillmentMethod = "addi" | "cod" | "undecided";
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
          callbell_conversation_href: string | null;
          status: ConversationStatus;
          fulfillment_method: FulfillmentMethod;
          openai_previous_response_id: string | null;
          assigned_team_uuid: string | null;
          last_inbound_at: string | null;
          last_inbound_message_uuid: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          callbell_conversation_href?: string | null;
          status?: ConversationStatus;
          fulfillment_method?: FulfillmentMethod;
          openai_previous_response_id?: string | null;
          assigned_team_uuid?: string | null;
          last_inbound_at?: string | null;
          last_inbound_message_uuid?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          contact_id?: string;
          callbell_conversation_href?: string | null;
          status?: ConversationStatus;
          fulfillment_method?: FulfillmentMethod;
          openai_previous_response_id?: string | null;
          assigned_team_uuid?: string | null;
          last_inbound_at?: string | null;
          last_inbound_message_uuid?: string | null;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      conversation_status: ConversationStatus;
      message_direction: MessageDirection;
      message_role: MessageRole;
      message_type: MessageType;
      fulfillment_method: FulfillmentMethod;
      order_status: OrderStatus;
      retarget_status: RetargetStatus;
    };
  };
}

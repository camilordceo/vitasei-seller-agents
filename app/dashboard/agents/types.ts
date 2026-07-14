import type { CatalogProductInput } from "@/lib/openai/catalog";
import type { AgentSchedule } from "@/lib/agent/schedule";

/** Datos editables de un agente (marca/número) desde el dashboard. Ver docs/16. */
export interface AgentEditInput {
  name: string;
  brand: string;
  country: string;
  whatsappNumber: string;
  callbellChannelUuid: string;
  /** Nueva API key de Callbell; VACÍO = no cambiar (write-only, no se muestra). */
  callbellApiKey: string;
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

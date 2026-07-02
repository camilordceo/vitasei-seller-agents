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
}

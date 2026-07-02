/**
 * Enrutamiento de inbound → agente — lógica PURA (sin I/O, sin `server-only`).
 *
 * Multi-agente: cada agente tiene un canal de Callbell y un número. Este matcher
 * elige el agente de un inbound por `callbell_channel_uuid` (primario) o
 * `whatsapp_number` (secundario). La carga de agentes y el fallback a env viven
 * en `lib/agent/agents.ts`. Ver docs/16, ADR-0023.
 */

/** Campos mínimos de un agente necesarios para enrutar. */
export interface AgentRoute {
  callbell_channel_uuid: string | null;
  whatsapp_number: string | null;
  enabled: boolean;
}

/** Identidad del inbound extraída del webhook de Callbell. */
export interface InboundRoute {
  channelUuid: string | null;
  number: string | null;
}

/**
 * Elige el agente `enabled` que corresponde al inbound. Primero por canal
 * (identificador más confiable del número), luego por número destino. Devuelve
 * null si ninguno coincide.
 */
export function matchAgent<T extends AgentRoute>(agents: T[], inbound: InboundRoute): T | null {
  const enabled = agents.filter((a) => a.enabled);

  if (inbound.channelUuid) {
    const byChannel = enabled.find(
      (a) => a.callbell_channel_uuid && a.callbell_channel_uuid === inbound.channelUuid,
    );
    if (byChannel) return byChannel;
  }

  if (inbound.number) {
    const byNumber = enabled.find(
      (a) => a.whatsapp_number && a.whatsapp_number === inbound.number,
    );
    if (byNumber) return byNumber;
  }

  return null;
}

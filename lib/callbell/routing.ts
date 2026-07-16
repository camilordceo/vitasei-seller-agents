/**
 * Enrutamiento de inbound de CALLBELL → agente — lógica PURA (sin I/O, sin
 * `server-only`).
 *
 * Multi-agente: cada agente tiene un canal de Callbell y un número. Este matcher
 * elige el agente de un inbound por `callbell_channel_uuid` (primario) o
 * `whatsapp_number` (secundario). La carga de agentes y el fallback a env viven
 * en `lib/agent/agents.ts`. Ver docs/16, ADR-0023.
 *
 * MULTI-PROVEEDOR (ADR-0056): solo se consideran agentes cuyo `provider` sea
 * Callbell. No es un detalle: durante la migración a Kapso el MISMO
 * `whatsapp_number` puede estar en dos agentes (el de Callbell y el de Kapso), y
 * sin este filtro el fallback por número cruzaría las líneas —un inbound de
 * Callbell contestado con las credenciales de Kapso—. El matcher de Kapso hace lo
 * simétrico en `lib/kapso/routing.ts`.
 */

import { normalizeProviderId } from "@/lib/messaging/types";

/** Campos mínimos de un agente necesarios para enrutar. */
export interface AgentRoute {
  callbell_channel_uuid: string | null;
  whatsapp_number: string | null;
  enabled: boolean;
  /** `agents.provider`. Ausente/null (datos previos a la migración 0026) = callbell. */
  provider?: string | null;
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
  const enabled = agents.filter(
    (a) => a.enabled && normalizeProviderId(a.provider) === "callbell",
  );

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

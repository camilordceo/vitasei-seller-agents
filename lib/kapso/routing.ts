/**
 * Enrutamiento de inbound de KAPSO → agente — lógica PURA (sin I/O).
 *
 * Simétrico a `lib/callbell/routing.ts`. Kapso identifica el número de negocio con
 * el **Meta Phone Number ID** (`phone_number_id`), que viaja top-level en todos los
 * webhooks y es también el que va en el path del envío. Es el identificador más
 * confiable, así que manda; el `whatsapp_number` queda como respaldo para el caso
 * en que el número esté cargado en el dashboard pero aún no su `phone_number_id`.
 *
 * Solo se consideran agentes con `provider = 'kapso'`: durante la prueba en paralelo
 * el mismo `whatsapp_number` puede existir en dos agentes (Callbell y Kapso) y sin
 * este filtro el respaldo por número cruzaría las líneas. Ver docs/24, ADR-0056.
 */

import { normalizeProviderId } from "@/lib/messaging/types";

/** Campos mínimos de un agente necesarios para enrutar un inbound de Kapso. */
export interface KapsoAgentRoute {
  kapso_phone_number_id: string | null;
  whatsapp_number: string | null;
  enabled: boolean;
  provider?: string | null;
}

/** Identidad del inbound extraída del webhook de Kapso. */
export interface KapsoInboundRoute {
  /** Meta Phone Number ID al que llegó el mensaje. */
  phoneNumberId: string | null;
  /** Número de negocio en E.164 sin '+', si se pudo determinar. */
  number: string | null;
}

/**
 * Elige el agente de Kapso `enabled` que corresponde al inbound: primero por
 * `phone_number_id`, luego por número. Null si ninguno coincide (no es un número
 * nuestro, o falta configurarlo en el dashboard).
 */
export function matchKapsoAgent<T extends KapsoAgentRoute>(
  agents: T[],
  inbound: KapsoInboundRoute,
): T | null {
  const enabled = agents.filter((a) => a.enabled && normalizeProviderId(a.provider) === "kapso");

  if (inbound.phoneNumberId) {
    const byId = enabled.find(
      (a) => a.kapso_phone_number_id && a.kapso_phone_number_id === inbound.phoneNumberId,
    );
    if (byId) return byId;
  }

  if (inbound.number) {
    const byNumber = enabled.find(
      (a) => a.whatsapp_number && a.whatsapp_number === inbound.number,
    );
    if (byNumber) return byNumber;
  }

  return null;
}

/**
 * Enrutamiento de inbound de KAPSO → agente — lógica PURA (sin I/O).
 *
 * Simétrico a `lib/callbell/routing.ts`, pero MÁS SIMPLE a propósito. Callbell
 * enruta por canal y, si no, por número destino, porque su webhook no siempre trae el
 * canal. Kapso no tiene esa duda: identifica el número de negocio con el **Meta Phone
 * Number ID** (`phone_number_id`), que viaja top-level en TODOS sus webhooks y es el
 * mismo que va en el path del envío. **No manda el número de negocio en ninguna
 * parte**, así que no hay respaldo por `whatsapp_number` que valga: sería código
 * muerto (`whatsapp_number` en un agente de Kapso es solo para mostrar).
 *
 * Solo se consideran agentes con `provider = 'kapso'`: durante la prueba en paralelo
 * el mismo `whatsapp_number` puede existir en dos agentes (Callbell y Kapso) y sin
 * este filtro se cruzarían las líneas. Ver docs/24, ADR-0056.
 */

import { normalizeProviderId } from "@/lib/messaging/types";

/** Campos mínimos de un agente necesarios para enrutar un inbound de Kapso. */
export interface KapsoAgentRoute {
  kapso_phone_number_id: string | null;
  enabled: boolean;
  provider?: string | null;
}

/** Identidad del inbound extraída del webhook de Kapso. */
export interface KapsoInboundRoute {
  /** Meta Phone Number ID al que llegó el mensaje. Es lo ÚNICO que identifica el número. */
  phoneNumberId: string | null;
}

/**
 * Elige el agente de Kapso `enabled` cuyo `kapso_phone_number_id` coincide. Null si
 * ninguno lo hace: no es un número nuestro, o falta pegar su Phone Number ID en el
 * dashboard (el webhook lo registra como `inbox_rejected`, que es la señal de eso).
 */
export function matchKapsoAgent<T extends KapsoAgentRoute>(
  agents: T[],
  inbound: KapsoInboundRoute,
): T | null {
  if (!inbound.phoneNumberId) return null;
  return (
    agents.find(
      (a) =>
        a.enabled &&
        normalizeProviderId(a.provider) === "kapso" &&
        a.kapso_phone_number_id === inbound.phoneNumberId,
    ) ?? null
  );
}

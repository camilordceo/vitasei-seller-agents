/**
 * Lógica PURA de solicitudes de llamada (`#llamada`) — sin I/O, testeable.
 *
 * Cuando el cliente pide que lo llamen, el modelo emite `#llamada`. El backend
 * crea una `call_requests` y avisa al dueño por WhatsApp con este texto. Ver
 * ADR-0034.
 */

export interface CallRequestNotificationInfo {
  /** Teléfono del cliente en E.164 sin '+'. */
  clientPhone: string;
  /** Nombre del contacto si se conoce. */
  contactName?: string | null;
  /** Marca/agente dueño de la conversación (para multi-marca). */
  brand?: string | null;
}

/**
 * Texto del aviso de solicitud de llamada para el dueño (WhatsApp). Puro (fácil
 * de ajustar el formato / testear).
 */
export function buildCallRequestNotification(info: CallRequestNotificationInfo): string {
  const brand = info.brand?.trim();
  const name = info.contactName?.trim();
  const lines: string[] = [`📞 Nueva solicitud de llamada${brand ? ` — ${brand}` : ""}`, ""];

  lines.push(`Cliente: ${name ? `${name} · ` : ""}+${info.clientPhone}`);
  lines.push("El cliente pidió que lo llamen. Revísalo en el panel → Llamadas.");

  return lines.join("\n");
}

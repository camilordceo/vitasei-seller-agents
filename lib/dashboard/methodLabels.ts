import { UNDECIDED_METHOD, type PaymentMethodConfig } from "@/lib/agent/paymentMethods";

/**
 * Etiquetas y opciones de método de pago para el DASHBOARD — lógica PURA.
 *
 * Desde ADR-0055 los métodos los define cada agente (`agents.payment_methods`), así
 * que el dashboard NO puede tener una lista cableada: si alguien agrega "Link de
 * pago" en el agente, esa opción tiene que aparecer en Órdenes y su nombre tiene que
 * verse en las píldoras y en Reportes. Este módulo es el único lugar donde se
 * resuelve `method → etiqueta` y `agente → opciones`. Ver ADR-0080.
 */

/** Etiqueta del sentinela "aún no se eligió método". */
export const UNDECIDED_LABEL = "Sin definir";

/**
 * Etiquetas de respaldo para las claves HISTÓRICAS (enum previo a la 0025). Solo se
 * usan si el agente no las define: lo que diga el agente siempre manda.
 */
export const LEGACY_METHOD_LABELS: Record<string, string> = {
  cod: "Contra entrega",
  addi: "Addi",
  [UNDECIDED_METHOD]: UNDECIDED_LABEL,
};

/**
 * Nombre legible derivado de la clave cuando nadie la definió:
 * `link-de-pago` → `Link de pago`. Mejor eso que mostrar el slug crudo — y MUCHO
 * mejor que el viejo fallback a "Sin definir", que hacía pasar por indefinido un
 * método real (un `zelle` se leía como si el cliente no hubiera elegido nada).
 */
export function humanizeMethod(method: string): string {
  const words = method.trim().replace(/^#/, "").split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return UNDECIDED_LABEL;
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** Etiqueta visible de un método, con el mapa del/los agente(s) si se tiene. */
export function methodLabel(
  method: string | null | undefined,
  labels?: Record<string, string>,
): string {
  const key = method && method.trim() ? method.trim() : UNDECIDED_METHOD;
  return labels?.[key] ?? LEGACY_METHOD_LABELS[key] ?? humanizeMethod(key);
}

/**
 * Mapa `method → label` juntando los métodos de VARIOS agentes (listas donde hay
 * más de una marca: Órdenes, Conversaciones, Reportes). Si dos agentes usan la
 * misma clave con distinta etiqueta, gana el primero (orden de creación).
 */
export function buildMethodLabels(
  agents: ReadonlyArray<{ paymentMethods: ReadonlyArray<PaymentMethodConfig> }>,
): Record<string, string> {
  const map: Record<string, string> = { ...LEGACY_METHOD_LABELS };
  for (const agent of agents) {
    for (const m of agent.paymentMethods) {
      if (!(m.method in map) || LEGACY_METHOD_LABELS[m.method] === map[m.method]) {
        map[m.method] = m.label;
      }
    }
  }
  return map;
}

export interface MethodOption {
  value: string;
  label: string;
}

/**
 * Opciones del selector de método de una orden: las del agente que la vendió, más
 * "Sin definir", más —si hace falta— el método actual de la orden (un método que se
 * quitó de la config no puede desaparecer del select y cambiarse solo al guardar).
 * Sin agente (orden vieja sin conversación con agente) se cae a las claves históricas.
 */
export function methodOptionsFor(
  configured: ReadonlyArray<PaymentMethodConfig> | null | undefined,
  current?: string | null,
): MethodOption[] {
  const options: MethodOption[] = [];
  const seen = new Set<string>();
  const push = (value: string, label: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label });
  };

  if (configured && configured.length > 0) {
    for (const m of configured) push(m.method, m.label);
  } else {
    push("cod", LEGACY_METHOD_LABELS.cod);
    push("addi", LEGACY_METHOD_LABELS.addi);
  }
  push(UNDECIDED_METHOD, UNDECIDED_LABEL);
  if (current) push(current, methodLabel(current, buildMethodLabels(configured ? [{ paymentMethods: configured }] : [])));
  return options;
}

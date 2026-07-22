/**
 * Validación y normalización de los envíos de gasto en pauta. Ver ADR-0082.
 *
 * PURO (sin I/O) a propósito: el endpoint solo trae los agentes y persiste; toda la
 * decisión de "esta fila sirve / esta no, y por qué" vive acá y se prueba con Vitest.
 *
 * Regla de oro del contrato: **una fila mala no tumba el lote**. Roberto manda 300
 * filas cada noche; si una campaña trae la moneda en blanco, queremos guardar las
 * otras 299 y devolverle exactamente cuál falló y por qué, no un 400 genérico que
 * lo obligue a adivinar.
 */

import { isSupportedCurrency, normalizeCurrency, SUPPORTED_CURRENCIES } from "@/lib/dashboard/currency";
import { isDayKey } from "@/lib/dashboard/report";

/** Tope de filas por request. Un lote más grande es un backfill: que lo parta. */
export const MAX_ROWS_PER_REQUEST = 1000;

/** Plataformas que sabemos nombrar. Cualquier otra se acepta tal cual (en minúsculas). */
export const KNOWN_PLATFORMS = ["meta", "google", "tiktok", "other"] as const;

/** Agente tal como lo necesita el resolutor (lo mínimo para identificarlo). */
export interface AgentIdentity {
  id: string;
  name: string;
  brand: string | null;
  whatsappNumber: string | null;
}

/** Fila lista para guardar: ya validada y con el agente resuelto. */
export interface ParsedSpendRow {
  agentId: string;
  date: string;
  platform: string;
  accountId: string | null;
  campaignId: string;
  campaignName: string | null;
  spend: number;
  currency: string;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  raw: Record<string, unknown>;
}

export interface RowError {
  /** Índice de la fila en el arreglo que mandaron: para que Roberto la ubique. */
  index: number;
  /** Campo culpable, cuando se puede señalar uno. */
  field?: string;
  message: string;
}

export interface ParseResult {
  rows: ParsedSpendRow[];
  errors: RowError[];
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

/**
 * Entero no negativo opcional (impresiones, clics, leads). Acepta el número como
 * string —las APIs de anuncios devuelven "20100" más veces de las que uno quisiera—
 * y devuelve `undefined` cuando el valor no sirve, para distinguirlo de un 0 real.
 */
function optionalCount(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

/**
 * Teléfono a la forma canónica del proyecto: E.164 sin `+` (573001112233). Sin esto,
 * el mismo número escrito como `+57 300 111 2233` no encontraría a su agente.
 */
function digits(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Resuelve a qué agente pertenece una fila. Tres formas, en orden de confianza:
 *
 *  1. `agent_id` — el uuid. Inequívoco, es lo que documentamos como preferido.
 *  2. `whatsapp_number` — el número del agente, normalizado a dígitos.
 *  3. `agent` — nombre o marca, sin distinguir mayúsculas ni espacios de sobra.
 *
 * El nombre va de último y falla si es AMBIGUO (dos agentes se llaman igual): imputar
 * el gasto al agente equivocado es peor que rechazar la fila, porque nadie se entera.
 */
export function resolveAgent(
  ref: { agentId?: unknown; whatsappNumber?: unknown; agent?: unknown },
  agents: AgentIdentity[],
): { agentId: string } | { error: string; field: string } {
  const byId = text(ref.agentId);
  if (byId) {
    const hit = agents.find((a) => a.id === byId);
    return hit ? { agentId: hit.id } : { error: `agent_id desconocido: ${byId}`, field: "agent_id" };
  }

  const phone = text(ref.whatsappNumber);
  if (phone) {
    const wanted = digits(phone);
    const hits = agents.filter((a) => a.whatsappNumber && digits(a.whatsappNumber) === wanted);
    if (hits.length === 1) return { agentId: hits[0].id };
    if (hits.length === 0) {
      return { error: `whatsapp_number sin agente: ${phone}`, field: "whatsapp_number" };
    }
    return { error: `whatsapp_number ambiguo (${hits.length} agentes): ${phone}`, field: "whatsapp_number" };
  }

  const name = text(ref.agent);
  if (name) {
    const wanted = name.toLowerCase();
    const hits = agents.filter(
      (a) => a.name.trim().toLowerCase() === wanted || (a.brand ?? "").trim().toLowerCase() === wanted,
    );
    if (hits.length === 1) return { agentId: hits[0].id };
    if (hits.length === 0) return { error: `agente desconocido: ${name}`, field: "agent" };
    return { error: `nombre de agente ambiguo (${hits.length} coinciden): ${name}`, field: "agent" };
  }

  return { error: "falta identificar el agente (agent_id, whatsapp_number o agent)", field: "agent_id" };
}

/**
 * Valida y normaliza UNA fila. Devuelve el error en vez de lanzarlo: quien llama
 * acumula y sigue con las demás.
 */
export function parseSpendRow(
  input: unknown,
  index: number,
  agents: AgentIdentity[],
): { row: ParsedSpendRow } | { error: RowError } {
  const fail = (message: string, field?: string) => ({ error: { index, field, message } });

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("la fila no es un objeto");
  }
  const r = input as Record<string, unknown>;

  const agent = resolveAgent(
    { agentId: r.agent_id, whatsappNumber: r.whatsapp_number, agent: r.agent },
    agents,
  );
  if ("error" in agent) return fail(agent.error, agent.field);

  const date = text(r.date);
  if (!date || !isDayKey(date)) {
    return fail(`date debe ser YYYY-MM-DD (recibido: ${date ?? "vacío"})`, "date");
  }

  // El gasto puede llegar como número o como string ("152340.55"): las APIs de
  // anuncios devuelven decimales en string para no perder precisión en JSON.
  const spendRaw = r.spend ?? r.cost ?? r.amount;
  const spend = Number(spendRaw);
  if (spendRaw === null || spendRaw === undefined || spendRaw === "" || !Number.isFinite(spend)) {
    return fail(`spend debe ser un número (recibido: ${JSON.stringify(spendRaw ?? null)})`, "spend");
  }
  if (spend < 0) return fail("spend no puede ser negativo (¿un reembolso?)", "spend");

  const currencyRaw = text(r.currency);
  if (!currencyRaw) return fail("falta currency", "currency");
  if (!isSupportedCurrency(currencyRaw)) {
    // Deliberadamente estricto: una moneda sin tasa se guardaría y después el
    // reporte la excluiría en silencio. Mejor que el error salga acá, en el envío.
    return fail(
      `currency sin tasa: ${currencyRaw}. Soportadas: ${SUPPORTED_CURRENCIES.join(", ")}`,
      "currency",
    );
  }

  const impressions = optionalCount(r.impressions);
  if (impressions === undefined) return fail("impressions debe ser un entero >= 0", "impressions");
  const clicks = optionalCount(r.clicks);
  if (clicks === undefined) return fail("clicks debe ser un entero >= 0", "clicks");
  const leads = optionalCount(r.leads);
  if (leads === undefined) return fail("leads debe ser un entero >= 0", "leads");

  return {
    row: {
      agentId: agent.agentId,
      date,
      platform: (text(r.platform) ?? "meta").toLowerCase(),
      accountId: text(r.account_id),
      // Sin campaña, la fila ES el total del agente ese día. Cadena vacía y no NULL:
      // el índice único de la migración no colisiona con NULLs.
      campaignId: text(r.campaign_id) ?? "",
      campaignName: text(r.campaign_name),
      spend,
      currency: normalizeCurrency(currencyRaw),
      impressions,
      clicks,
      leads,
      raw: r,
    },
  };
}

/**
 * Valida el lote completo y **deduplica dentro del propio envío**: si el mismo
 * día/campaña viene dos veces en un request, gana la última. Sin esto, el upsert
 * de Postgres falla entero con "ON CONFLICT DO UPDATE command cannot affect row a
 * second time" y se pierden las 300 filas por culpa de un duplicado.
 */
export function parseSpendBatch(input: unknown, agents: AgentIdentity[]): ParseResult {
  const errors: RowError[] = [];
  const deduped = new Map<string, ParsedSpendRow>();

  if (!Array.isArray(input)) {
    return { rows: [], errors: [{ index: -1, message: "se esperaba un arreglo de filas en `rows`" }] };
  }

  input.forEach((raw, index) => {
    const parsed = parseSpendRow(raw, index, agents);
    if ("error" in parsed) {
      errors.push(parsed.error);
      return;
    }
    const { agentId, date, platform, campaignId } = parsed.row;
    deduped.set(`${agentId}|${date}|${platform}|${campaignId}`, parsed.row);
  });

  return { rows: [...deduped.values()], errors };
}

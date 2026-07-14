/**
 * Matching PURO de videos por palabra clave (sin I/O; testeable con Vitest).
 *
 * Regla: si la RESPUESTA del bot menciona una palabra/frase configurada, se
 * dispara el video. El match es **case- y acento-insensible** y por **palabra
 * completa** (para que "magnesio" no dispare dentro de "magnesioso", y para que
 * frases con espacios como "omega 3" calcen tal cual). La decisión de enviar
 * (idempotencia, Callbell) vive en `lib/agent/videos.ts`.
 */

export interface VideoRule {
  id: string;
  keyword: string;
  videoUrl: string;
  /** Texto opcional que se envía (como mensaje aparte) junto con el video. */
  caption?: string | null;
  /** Mercado/marca dueño del video. null = global (todas las marcas). */
  agentId?: string | null;
}

// Centinela (área de uso privado) para proteger la ñ/Ñ durante la normalización:
// en español "ñ" NO es "n" (año ≠ ano), así que se preserva mientras se quitan
// los acentos de las vocales.
const ENYE = String.fromCharCode(0xe000);
// Marcas combinantes (acentos) que agrega NFD: U+0300–U+036F.
const COMBINING = /[̀-ͯ]/g;

/** Minúsculas + sin acentos de vocales (NFD), preservando la ñ. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/ñ/g, ENYE)
    .replace(/Ñ/g, ENYE)
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .split(ENYE)
    .join("ñ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Precedencia MERCADO > GLOBAL: por cada palabra clave deja **una sola** regla, la
 * del agente de la conversación si existe; si no, la global (`agentId` null). Sin
 * esto, un video global "magnesio" y el "magnesio" de Colombia calzarían los dos y
 * el cliente recibiría DOS videos (el de otro país incluido). Ver ADR-0050.
 *
 * La keyword se compara normalizada (igual que el match), así que "Colágeno" y
 * "colageno" son la MISMA palabra aunque el índice único de la BD las deje coexistir.
 * Descarta reglas con keyword vacía.
 */
export function resolveRulesForAgent(rules: VideoRule[], agentId: string): VideoRule[] {
  const byKeyword = new Map<string, VideoRule>();

  for (const rule of rules) {
    const kw = normalizeForMatch(rule.keyword ?? "").trim();
    if (!kw) continue;

    const current = byKeyword.get(kw);
    if (!current) {
      byKeyword.set(kw, rule);
      continue;
    }
    // Solo el del agente destrona a lo que ya haya (global u otra marca: el backend
    // nunca debería cargar reglas de otro agente, pero si llegan, no ganan).
    if (rule.agentId === agentId && current.agentId !== agentId) byKeyword.set(kw, rule);
  }

  return [...byKeyword.values()];
}

/**
 * Devuelve las reglas cuya `keyword` aparece como palabra completa en `replyText`
 * (normalizado). Ignora reglas con keyword vacía. No deduplica por video: eso lo
 * maneja el llamador (idempotencia por conversación).
 */
export function matchVideos(replyText: string, rules: VideoRule[]): VideoRule[] {
  const hay = normalizeForMatch(replyText ?? "");
  if (!hay.trim()) return [];

  return rules.filter((r) => {
    const kw = normalizeForMatch(r.keyword ?? "").trim();
    if (!kw) return false;
    // Límite de "palabra" = inicio/fin o cualquier cosa que no sea letra/número.
    // El flag unicode (`u`) hace que \p{L}/\p{N} cubran acentos y ñ.
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(kw)}([^\\p{L}\\p{N}]|$)`, "u");
    return re.test(hay);
  });
}

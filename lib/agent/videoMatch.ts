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

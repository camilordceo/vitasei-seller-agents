import { parseExecutedActions, type ExtractedData } from "./extractors";

/**
 * Tipos y normalización de la API de Synthflow. Módulo PURO (sin I/O).
 *
 * Todo lo que entra de Synthflow pasa por `normalizeCall` — un solo sitio— porque
 * su webhook y su API **no coinciden** (`status` vs `call_status`, ISO-8601 vs
 * epoch-ms). Como el webhook solo se usa como aviso y los datos se releen por API
 * (ADR-0061), aquí solo se parsea la forma de la **API**; la del webhook se
 * tolera por si algún día se quisiera usar directo.
 */

export const SYNTHFLOW_API_BASE = "https://api.synthflow.ai/v2";

/** Voz de `GET /v2/voices`. */
export interface SynthflowVoice {
  voice_id: string;
  name: string;
  preview?: string | null;
  provider?: string | null;
  gender?: string | null;
  languages?: string[] | null;
}

/** Tipos de Information Extractor soportados por Synthflow. */
export const EXTRACTOR_TYPES = ["OPEN_QUESTION", "SINGLE_CHOICE", "YES_NO"] as const;
export type ExtractorType = (typeof EXTRACTOR_TYPES)[number];

/** Extractor tal como lo configura el dashboard (ADR-0062). */
export interface VoiceExtractor {
  identifier: string;
  type: ExtractorType;
  condition: string;
  choices: string[];
  examples: string[];
  /** `action_id` en Synthflow; ausente mientras no se haya sincronizado. */
  actionId?: string | null;
}

/**
 * Desenlace de la llamada, ya normalizado. `status` es NUESTRO vocabulario
 * (el de la columna `voice_calls.status`), no el de Synthflow.
 */
export interface NormalizedCall {
  callId: string;
  modelId: string | null;
  /** Estado crudo de Synthflow, se guarda tal cual para diagnóstico. */
  rawStatus: string | null;
  status: "placed" | "completed" | "no_answer" | "failed";
  endCallReason: string | null;
  durationSec: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  startedAt: string | null;
  extracted: ExtractedData;
  /** true si un humano atendió (para `voice_stop_when_answered`). */
  answered: boolean;
}

/**
 * `call_status` de Synthflow → nuestro vocabulario.
 * Valores observados en la cuenta real: completed, failed, no-answer,
 * hangup_on_voicemail, busy, in-progress, pending, canceled.
 */
function mapStatus(raw: string | null): NormalizedCall["status"] {
  const s = (raw ?? "").toLowerCase().replace(/_/g, "-");
  if (s === "completed") return "completed";
  if (s === "no-answer" || s === "busy" || s === "hangup-on-voicemail" || s === "left-voicemail") {
    return "no_answer";
  }
  if (s === "pending" || s === "ringing" || s === "in-progress" || s === "registered" || s === "paused") {
    return "placed"; // sigue viva
  }
  // failed, canceled, user-canceled, spam y cualquier cosa desconocida.
  return "failed";
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * `start_time` viene como epoch-ms (string) por API y como ISO-8601 por webhook.
 * Se aceptan ambos y siempre se devuelve ISO.
 */
function normalizeStartTime(v: unknown): string | null {
  const raw = asString(v) ?? (typeof v === "number" ? String(v) : null);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw);
    // Heurística: epoch en segundos si es demasiado chico para ser ms.
    const date = new Date(raw.length <= 10 ? ms * 1000 : ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normaliza un registro de llamada de la API (o del webhook) a `NormalizedCall`.
 * Nunca lanza: ante campos faltantes deja nulls.
 */
export function normalizeCall(raw: unknown): NormalizedCall | null {
  if (!isRecord(raw)) return null;
  // El webhook anida en `call`; la API lo trae plano.
  const call = isRecord(raw.call) ? raw.call : raw;

  const callId = asString(call.call_id);
  if (!callId) return null;

  // API: `call_status`. Webhook: `status`.
  const rawStatus = asString(call.call_status) ?? asString(call.status);
  const status = mapStatus(rawStatus);
  const endCallReason = asString(call.end_call_reason);
  const durationSec = asNumber(call.duration);

  // `executed_actions` puede venir al nivel de la llamada o al raíz (webhook).
  const executed = isRecord(call.executed_actions)
    ? call.executed_actions
    : isRecord(raw.executed_actions)
      ? raw.executed_actions
      : {};

  // "Contestó" = habló un humano. Un buzón con 41s de duración NO cuenta.
  const answered =
    status === "completed" &&
    (durationSec ?? 0) > 0 &&
    endCallReason !== "voicemail" &&
    endCallReason !== "voicemail_message_left";

  return {
    callId,
    modelId: asString(call.model_id),
    rawStatus,
    status,
    endCallReason,
    durationSec,
    transcript: asString(call.transcript),
    recordingUrl: asString(call.recording_url),
    startedAt: normalizeStartTime(call.start_time),
    extracted: parseExecutedActions(executed),
    answered,
  };
}

/**
 * Desenvuelve la respuesta de Synthflow. Ojo: **`GET /v2/calls/{id}` devuelve
 * igual un array paginado**, no el objeto suelto (verificado contra la cuenta).
 */
export function unwrapCall(body: unknown): unknown | null {
  if (!isRecord(body)) return null;
  const response = isRecord(body.response) ? body.response : body;
  if (Array.isArray(response.calls)) return response.calls[0] ?? null;
  return response;
}

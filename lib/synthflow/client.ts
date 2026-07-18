import "server-only";
import {
  SYNTHFLOW_API_BASE,
  unwrapCall,
  normalizeCall,
  type NormalizedCall,
  type SynthflowVoice,
  type VoiceExtractor,
} from "./types";

/**
 * Cliente HTTP de Synthflow. Todas las rutas y formas fueron **verificadas
 * contra la cuenta real** el 2026-07-18 (ver docs/25 §2), no contra la doc:
 * su documentación tiene al menos tres errores que rompen la integración.
 */

export interface SynthflowCreds {
  apiKey: string;
  /** Base regional. La cuenta vive en la global; `api.us`/`api.eu` dan 401. */
  base?: string;
  workspaceId?: string;
}

export class SynthflowError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "SynthflowError";
  }
}

async function call(
  creds: SynthflowCreds,
  path: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string | undefined> },
): Promise<unknown> {
  const base = creds.base?.replace(/\/+$/, "") || SYNTHFLOW_API_BASE;
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    // Un 401 puede ser "key inválida" O "región equivocada": con la misma key,
    // api.us y api.eu devuelven 401 mientras la global responde 200.
    const hint =
      res.status === 401
        ? " (revisa la API key y que SYNTHFLOW_API_BASE sea la región del workspace)"
        : "";
    throw new SynthflowError(
      `Synthflow ${init?.method ?? "GET"} ${path} falló: ${res.status}${hint}`,
      res.status,
      text.slice(0, 500),
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function responseOf(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  return isRecord(body.response) ? body.response : body;
}

// --- Voces -----------------------------------------------------------------

/**
 * Lista las voces del workspace. Son ~2.100, así que se pagina hasta `max`.
 * `workspace` es **obligatorio** y es distinto de la API key.
 */
export async function listVoices(
  creds: SynthflowCreds,
  opts?: { search?: string; provider?: string; max?: number },
): Promise<SynthflowVoice[]> {
  if (!creds.workspaceId) {
    throw new Error(
      "Falta SYNTHFLOW_WORKSPACE_ID: la API de voces exige el workspace (es distinto de la API key).",
    );
  }
  const max = opts?.max ?? 300;
  const pageSize = 100;
  const out: SynthflowVoice[] = [];

  for (let offset = 0; offset < max; offset += pageSize) {
    const body = await call(creds, "/voices", {
      query: {
        workspace: creds.workspaceId,
        limit: String(pageSize),
        offset: String(offset),
        search: opts?.search,
        provider: opts?.provider,
      },
    });
    const page = responseOf(body);
    const voices = Array.isArray(page.voices) ? (page.voices as SynthflowVoice[]) : [];
    out.push(...voices);
    if (voices.length < pageSize) break;
  }
  return out;
}

/**
 * ¿La voz sirve para este idioma? `languages` es **inconsistente** en la API real
 * (conviven "english" y "en", "es", "pt"…), así que se compara por prefijo.
 */
export function voiceSpeaks(voice: SynthflowVoice, lang: string): boolean {
  const target = lang.slice(0, 2).toLowerCase();
  const langs = voice.languages ?? [];
  if (langs.length === 0) return true; // sin dato: no la escondemos
  return langs.some((l) => {
    const s = String(l).toLowerCase();
    if (s.startsWith(target)) return true;
    if (target === "es" && s.startsWith("spanish")) return true;
    if (target === "en" && s.startsWith("english")) return true;
    return false;
  });
}

// --- Llamadas --------------------------------------------------------------

export interface PlaceCallArgs {
  modelId: string;
  /** E.164 **con `+`** — convención de Synthflow, distinta a la interna. */
  phone: string;
  /** Requerido por el schema aunque la doc no lo destaque. */
  name: string;
  fromNumber?: string | null;
  prompt?: string | null;
  greeting?: string | null;
  /** Se referencian en el prompt con `{llaves}`. */
  variables?: Record<string, string>;
}

/**
 * Dispara una llamada saliente. Sale **de inmediato**: Synthflow no tiene campo
 * de agendamiento, por eso la cadencia es nuestra (ADR-0063).
 */
export async function placeCall(creds: SynthflowCreds, args: PlaceCallArgs): Promise<string> {
  const body: Record<string, unknown> = {
    model_id: args.modelId,
    phone: args.phone,
    name: args.name,
  };
  if (args.fromNumber) body.from_phone_number = args.fromNumber;
  if (args.prompt) body.prompt = args.prompt;
  if (args.greeting) body.greeting = args.greeting;
  // OJO: aquí `custom_variables` es un ARRAY de {key,value}; en otros endpoints
  // de su doc es un objeto. Verificado contra el schema de POST /v2/calls.
  const vars = Object.entries(args.variables ?? {}).filter(([, v]) => v != null && v !== "");
  if (vars.length > 0) {
    body.custom_variables = vars.map(([key, value]) => ({ key, value: String(value) }));
  }

  const res = responseOf(await call(creds, "/calls", { method: "POST", body }));
  const callId = typeof res.call_id === "string" ? res.call_id : null;
  if (!callId) {
    throw new Error(`Synthflow no devolvió call_id: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return callId;
}

/** Trae una llamada y la normaliza. Fuente de verdad del desenlace (ADR-0061). */
export async function getCall(
  creds: SynthflowCreds,
  callId: string,
): Promise<NormalizedCall | null> {
  const body = await call(creds, `/calls/${encodeURIComponent(callId)}`);
  return normalizeCall(unwrapCall(body));
}

// --- Extractores -----------------------------------------------------------

/**
 * Saneo obligatorio del texto del extractor. Synthflow advierte que pedir JSON o
 * usar `{} [] <>` puede dejar la llamada colgada en "in progress" para siempre.
 */
export function sanitizeExtractorText(text: string): string {
  return text
    .replace(/[{}[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractorBody(extractor: VoiceExtractor): Record<string, unknown> {
  const inner: Record<string, unknown> = {
    identifier: extractor.identifier,
    description: sanitizeExtractorText(extractor.condition),
  };
  if (extractor.type === "SINGLE_CHOICE") {
    inner.choices = extractor.choices.map(sanitizeExtractorText).filter(Boolean);
  }
  if (extractor.type === "OPEN_QUESTION") {
    inner.examples = extractor.examples.map(sanitizeExtractorText).filter(Boolean);
  }
  return { INFORMATION_EXTRACTOR: { [extractor.type]: inner } };
}

/** Crea un extractor y devuelve su `action_id`. */
export async function createExtractor(
  creds: SynthflowCreds,
  extractor: VoiceExtractor,
): Promise<string> {
  const res = responseOf(
    await call(creds, "/actions", { method: "POST", body: extractorBody(extractor) }),
  );
  const actionId = typeof res.action_id === "string" ? res.action_id : null;
  if (!actionId) {
    throw new Error(`Synthflow no devolvió action_id para "${extractor.identifier}".`);
  }
  return actionId;
}

/** Actualiza un extractor existente. */
export async function updateExtractor(
  creds: SynthflowCreds,
  actionId: string,
  extractor: VoiceExtractor,
): Promise<void> {
  await call(creds, `/actions/${encodeURIComponent(actionId)}`, {
    method: "PUT",
    body: extractorBody(extractor),
  });
}

export async function deleteExtractor(creds: SynthflowCreds, actionId: string): Promise<void> {
  await call(creds, `/actions/${encodeURIComponent(actionId)}`, { method: "DELETE" });
}

/** Adjunta acciones al assistant del agente. */
export async function attachActions(
  creds: SynthflowCreds,
  modelId: string,
  actionIds: string[],
): Promise<void> {
  if (actionIds.length === 0) return;
  await call(creds, "/actions/attach", {
    method: "POST",
    body: { model_id: modelId, actions: actionIds },
  });
}

export async function detachActions(
  creds: SynthflowCreds,
  modelId: string,
  actionIds: string[],
): Promise<void> {
  if (actionIds.length === 0) return;
  await call(creds, "/actions/detach", {
    method: "POST",
    body: { model_id: modelId, actions: actionIds },
  });
}

// --- Assistant -------------------------------------------------------------

/** Trae el assistant crudo (viene envuelto en `response.assistants[0]`). */
export async function getAssistant(
  creds: SynthflowCreds,
  modelId: string,
): Promise<Record<string, unknown> | null> {
  const res = responseOf(await call(creds, `/assistants/${encodeURIComponent(modelId)}`));
  if (Array.isArray(res.assistants)) {
    const first = res.assistants[0];
    return isRecord(first) ? first : null;
  }
  return isRecord(res) ? res : null;
}

/**
 * Sincroniza SOLO la voz del assistant, con **read-modify-write**: se lee el
 * `agent` completo, se cambia `voice_id` y se reenvía. Sin esto, un `PUT` con
 * cuerpo parcial puede borrarle campos a un assistant que **compartimos con otro
 * producto** (el workspace tiene 82, varios de Rentmies). Ver ADR-0060.
 */
export async function syncAssistantVoice(
  creds: SynthflowCreds,
  modelId: string,
  voiceId: string,
): Promise<void> {
  const assistant = await getAssistant(creds, modelId);
  if (!assistant) throw new Error(`No se encontró el assistant ${modelId} en Synthflow.`);

  const agent = isRecord(assistant.agent) ? { ...assistant.agent } : {};
  agent.voice_id = voiceId;

  await call(creds, `/assistants/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    body: {
      type: assistant.type ?? "outbound",
      name: assistant.name ?? "agente",
      agent,
    },
  });
}

/**
 * Apunta el webhook post-llamada (`external_webhook_url`) del assistant a la URL
 * dada, con el mismo read-modify-write que la voz (ver arriba). Como el PUT de
 * assistants no está verificado campo a campo contra la cuenta real, después de
 * escribir se relee y se confirma que el valor quedó; si no, se lanza error para
 * que el operador lo configure a mano en el panel de Synthflow.
 */
export async function syncAssistantWebhook(
  creds: SynthflowCreds,
  modelId: string,
  webhookUrl: string,
): Promise<void> {
  const assistant = await getAssistant(creds, modelId);
  if (!assistant) throw new Error(`No se encontró el assistant ${modelId} en Synthflow.`);

  const agent = isRecord(assistant.agent) ? { ...assistant.agent } : {};

  await call(creds, `/assistants/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    body: {
      type: assistant.type ?? "outbound",
      name: assistant.name ?? "agente",
      external_webhook_url: webhookUrl,
      agent,
    },
  });

  const after = await getAssistant(creds, modelId);
  const applied =
    after != null &&
    (after.external_webhook_url === webhookUrl ||
      (isRecord(after.agent) && after.agent.external_webhook_url === webhookUrl));
  if (!applied) {
    throw new Error(
      "Synthflow aceptó el cambio pero al releer el assistant el webhook no quedó guardado. " +
        "Configúralo a mano en el panel de Synthflow (external_webhook_url del assistant).",
    );
  }
}

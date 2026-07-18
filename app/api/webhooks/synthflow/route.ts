import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { readSignatureHeader, verifySynthflowSignature } from "@/lib/synthflow/signature";
import { getCall } from "@/lib/synthflow/client";
import { credsFor, finalizeVoiceCall, loadAgentVoiceConfig } from "@/lib/agent/voiceCall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Post-call webhook de Synthflow.
 *
 * **El cuerpo NO se cree.** Synthflow firma solo el `call_id`, no el payload
 * (ADR-0061), así que de todo el cuerpo se usa **únicamente el `call_id`**; los
 * datos reales se releen con `GET /v2/calls/{id}` usando la key del agente.
 * Eso además nos ahorra las desalineaciones webhook↔API (`status` vs
 * `call_status`, ISO vs epoch-ms) porque solo parseamos la forma de la API.
 *
 * El agente NO se resuelve por el payload: se resuelve por `synthflow_call_id`
 * en nuestra tabla, que es lo que permite que varios agentes compartan un mismo
 * endpoint sin ambigüedad.
 *
 * Siempre 200: Synthflow reintenta ante error, y un reintento no arregla un
 * `call_id` que no conocemos.
 */
const ok = (extra?: Record<string, unknown>) =>
  NextResponse.json({ status: "ok", ...(extra ?? {}) });

function extractCallId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as Record<string, unknown>;
  const call = typeof root.call === "object" && root.call !== null
    ? (root.call as Record<string, unknown>)
    : root;
  const id = call.call_id ?? root.call_id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ok({ ignored: "invalid-json" });
  }

  const callId = extractCallId(body);
  if (!callId) return ok({ ignored: "no-call-id" });

  // Firma sobre el `call_id`. Si hay secreto configurado, es obligatoria
  // (fail-closed, como Kapso): el endpoint es público y gasta llamadas a la API.
  const secret = env.SYNTHFLOW_WEBHOOK_SECRET;
  if (secret) {
    const signature = readSignatureHeader(req.headers);
    if (!verifySynthflowSignature(callId, signature, secret)) {
      // No se loguea en events_log: un request no autenticado no debe escribir.
      console.warn("[webhooks/synthflow] firma inválida para call_id", callId);
      return ok({ ignored: "bad-signature" });
    }
  }

  const supabase = createServiceClient();

  // La llamada tiene que ser NUESTRA: así sabemos agente y conversación sin
  // confiar en el payload, y varios agentes conviven en el mismo endpoint.
  const { data: row } = await supabase
    .from("voice_calls")
    .select("id, agent_id, status")
    .eq("synthflow_call_id", callId)
    .maybeSingle();
  if (!row) return ok({ ignored: "unknown-call" });

  const item = row as unknown as { id: string; agent_id: string | null; status: string };
  if (["completed", "no_answer", "failed", "cancelled"].includes(item.status)) {
    return ok({ ignored: "already-closed" });
  }
  if (!item.agent_id) return ok({ ignored: "no-agent" });

  try {
    const agent = await loadAgentVoiceConfig(supabase, item.agent_id);
    if (!agent) return ok({ ignored: "agent-not-found" });

    const call = await getCall(credsFor(agent), callId);
    if (!call) return ok({ ignored: "call-not-found" });

    await finalizeVoiceCall(supabase, item.id, call);
    return ok({ closed: call.status });
  } catch (e) {
    // Devolvemos 200 igual: la reconciliación del cron lo cerrará después.
    console.error(
      "[webhooks/synthflow] no se pudo cerrar la llamada:",
      e instanceof Error ? e.message : String(e),
    );
    return ok({ deferred: "reconcile" });
  }
}

/** GET para health checks / verificación de URL. */
export async function GET() {
  return ok({ endpoint: "synthflow-post-call" });
}

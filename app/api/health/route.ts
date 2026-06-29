import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check de conectividad — soporta la aceptación del Sprint 0:
 * "conexión a Supabase OK; ping a OpenAI y Callbell OK".
 *
 * GET /api/health → { supabase, openai, callbell } con "ok" o "error: ...".
 * Cada check es best-effort y aislado: si falta una credencial, ese check
 * reporta el error sin tumbar los demás.
 */

type CheckResult = "ok" | `error: ${string}`;

async function checkSupabase(): Promise<CheckResult> {
  try {
    const supabase = createServiceClient();
    // HEAD count sobre products: valida URL + service role + que el schema exista.
    const { error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true });
    if (error) return `error: ${error.message}`;
    return "ok";
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

async function checkOpenAI(): Promise<CheckResult> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return "error: falta OPENAI_API_KEY";
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return `error: HTTP ${res.status}`;
    return "ok";
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

async function checkCallbell(): Promise<CheckResult> {
  try {
    const apiKey = process.env.CALLBELL_API_KEY;
    if (!apiKey) return "error: falta CALLBELL_API_KEY";
    // Endpoint autenticado liviano: si la key es válida no devuelve 401.
    const res = await fetch("https://api.callbell.eu/v1/contacts?per_page=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      return `error: auth HTTP ${res.status}`;
    }
    if (!res.ok) return `error: HTTP ${res.status}`;
    return "ok";
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

export async function GET() {
  const [supabase, openai, callbell] = await Promise.all([
    checkSupabase(),
    checkOpenAI(),
    checkCallbell(),
  ]);

  const allOk = [supabase, openai, callbell].every((r) => r === "ok");

  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks: { supabase, openai, callbell } },
    { status: allOk ? 200 : 503 },
  );
}

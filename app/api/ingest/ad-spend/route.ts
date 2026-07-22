import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { env } from "@/lib/env";
import { isDayKey } from "@/lib/dashboard/report";
import {
  MAX_ROWS_PER_REQUEST,
  parseSpendBatch,
  type AgentIdentity,
} from "@/lib/adspend/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gasto REAL en pauta: entrada de datos desde el producto de anuncios. Ver ADR-0082
 * y el contrato para el integrador en `docs/28-api-gasto-en-pauta.md`.
 *
 * `POST` recibe un lote de filas (día × agente × plataforma × campaña) y las
 * **upsertea** — reenviar el mismo día REEMPLAZA, no suma, porque las plataformas
 * reexpresan el gasto de los últimos días.
 *
 * `GET` devuelve lo que quedó guardado, para que el integrador verifique sin
 * pedirnos capturas del dashboard.
 *
 * A DIFERENCIA de los webhooks del proyecto (que siempre responden 200 porque el
 * proveedor reintenta), acá los códigos de estado son de verdad: 401 si el token
 * está mal, 400 si el cuerpo no sirve. Esto no es un webhook con reintentos ciegos,
 * es una integración con una persona del otro lado que necesita ver el error.
 */

/** Compara en tiempo constante, tolerando longitudes distintas. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type AuthResult = { ok: true } | { ok: false; response: NextResponse };

function authorize(req: Request): AuthResult {
  const expected = env.AD_SPEND_API_KEY;
  if (!expected) {
    // Cerrado, no abierto. Ver el comentario en lib/env.ts.
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "AD_SPEND_API_KEY no está configurada en el servidor" },
        { status: 503 },
      ),
    };
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !secretMatches(token, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "token inválido (usa el header Authorization: Bearer <AD_SPEND_API_KEY>)" },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}

async function loadAgents(): Promise<AgentIdentity[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("agents").select("id, name, brand, whatsapp_number");
  if (error) throw new Error(`agents: ${error.message}`);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    name: (a.name as string) ?? "",
    brand: (a.brand as string | null) ?? null,
    whatsappNumber: (a.whatsapp_number as string | null) ?? null,
  }));
}

export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  // Se acepta `{ rows: [...] }` o el arreglo pelado: no vale la pena rebotar un
  // envío por una envoltura, y el error sería justo el más frustrante de depurar.
  const rawRows = Array.isArray(body)
    ? body
    : (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rawRows)) {
    return NextResponse.json(
      { ok: false, error: "se esperaba { rows: [...] } (o un arreglo de filas)" },
      { status: 400 },
    );
  }
  if (rawRows.length === 0) {
    return NextResponse.json({ ok: true, received: 0, upserted: 0, rejected: 0, errors: [] });
  }
  if (rawRows.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json(
      {
        ok: false,
        error: `máximo ${MAX_ROWS_PER_REQUEST} filas por request (recibidas ${rawRows.length}); parte el lote`,
      },
      { status: 413 },
    );
  }

  let agents: AgentIdentity[];
  try {
    agents = await loadAgents();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const { rows, errors } = parseSpendBatch(rawRows, agents);

  let upserted = 0;
  if (rows.length > 0) {
    const supabase = createServiceClient();
    const { error } = await supabase.from("ad_spend").upsert(
      rows.map((r) => ({
        agent_id: r.agentId,
        date: r.date,
        platform: r.platform,
        account_id: r.accountId,
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        spend: r.spend,
        currency: r.currency,
        impressions: r.impressions,
        clicks: r.clicks,
        leads: r.leads,
        source: "api",
        // El payload crudo es JSON por construcción (salió de `req.json()`); el tipo
        // generado no lo sabe.
        raw: r.raw as unknown as Json,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "agent_id,date,platform,campaign_id" },
    );
    if (error) {
      // 42P01 = falta la migración 0031. Se dice explícito: es EL error de arranque.
      const hint =
        error.code === "42P01"
          ? " — falta correr la migración supabase/migrations/0031_ad_spend.sql"
          : "";
      return NextResponse.json(
        { ok: false, error: `no se pudo guardar: ${error.message}${hint}`, rejected: errors.length, errors },
        { status: 500 },
      );
    }
    upserted = rows.length;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    received: rawRows.length,
    upserted,
    rejected: errors.length,
    // Tope al detalle: un lote entero mal formado no debe devolver 1000 mensajes.
    errors: errors.slice(0, 50),
  });
}

/**
 * Verificación: qué gasto tenemos guardado. `?from=&to=` (YYYY-MM-DD, inclusivos),
 * `?agent_id=`, `?limit=` (default 200, tope 1000). Sin filtros devuelve lo más
 * reciente, que es lo que uno quiere mirar tras un envío.
 */
export async function GET(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const agentId = url.searchParams.get("agent_id");
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;

  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value && !isDayKey(value)) {
      return NextResponse.json({ ok: false, error: `${name} debe ser YYYY-MM-DD` }, { status: 400 });
    }
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("ad_spend")
    .select("agent_id, date, platform, account_id, campaign_id, campaign_name, spend, currency, impressions, clicks, leads, updated_at")
    .order("date", { ascending: false })
    .limit(limit);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);
  if (agentId) query = query.eq("agent_id", agentId);

  const { data, error } = await query;
  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { ok: false, error: "falta la migración 0031_ad_spend.sql" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  // Total por moneda, sin homologar: acá el propósito es CUADRAR contra la
  // plataforma, y para eso el número tiene que salir en la moneda en que se pagó.
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const c = (r.currency as string) ?? "?";
    totals[c] = (totals[c] ?? 0) + Number(r.spend ?? 0);
  }

  return NextResponse.json({ ok: true, count: rows.length, totals, rows });
}

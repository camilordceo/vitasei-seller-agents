import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./types";

/**
 * Cliente Supabase con SERVICE ROLE — bypassa RLS.
 *
 * SOLO server (Inngest functions, route handlers). NUNCA exponer al cliente.
 * Se crea bajo demanda para no leer env en tiempo de import (build-safe).
 */
export function createServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      // Next (App Router, v14) cachea los `fetch` GET por defecto (Data Cache).
      // Como supabase-js lee vía `fetch`, las consultas con URL ESTABLE (lista de
      // órdenes, agregados de reportes) quedaban servidas desde ese cache: una
      // orden recién creada por el webhook NO aparecía en /orders ni en /reports
      // (aunque sí en su detalle, cuya URL `id=eq.<uuid>` es única → nunca cachea).
      // Las consultas con timestamp rodante (mensajes inbound de los últimos 30d)
      // se veían frescas solo porque su URL cambia cada render. `force-dynamic`
      // fuerza el render dinámico pero NO desactiva de forma fiable este Data Cache
      // por-fetch. `no-store` hace que TODA lectura del service client (dashboard +
      // webhook) sea en vivo; ninguna se beneficia del cache. Ver ADR-0046.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

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
  });
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Cliente Supabase para el browser (dashboard) — usa la ANON key y respeta RLS.
 * El modelo de auth fino del dashboard se define en el Sprint 6.
 */
export function createBrowserClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createClient<Database>(url, anonKey);
}

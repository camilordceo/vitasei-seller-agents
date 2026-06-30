import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

/**
 * Cliente OpenAI — SOLO server.
 *
 * Se crea bajo demanda para no leer `OPENAI_API_KEY` en tiempo de import
 * (build-safe, igual que el cliente Supabase service-role).
 */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

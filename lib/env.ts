/**
 * Acceso centralizado a variables de entorno.
 *
 * Se usan getters para que una variable faltante solo falle cuando se accede
 * en runtime (no al importar el módulo) — así `next build` no se rompe con un
 * `.env` incompleto. Los secretos (service role, API keys) son SOLO server.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa tu .env.local (ver .env.example).`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  // OpenAI
  get OPENAI_API_KEY() {
    return required("OPENAI_API_KEY");
  },
  get OPENAI_MODEL() {
    return optional("OPENAI_MODEL") ?? "gpt-5.1";
  },
  get OPENAI_VECTOR_STORE_ID() {
    return optional("OPENAI_VECTOR_STORE_ID");
  },

  // Callbell
  get CALLBELL_API_KEY() {
    return required("CALLBELL_API_KEY");
  },
  get CALLBELL_WEBHOOK_SECRET() {
    return optional("CALLBELL_WEBHOOK_SECRET");
  },
  get CALLBELL_LOGISTICS_TEAM_UUID() {
    return optional("CALLBELL_LOGISTICS_TEAM_UUID");
  },
  get CALLBELL_WHATSAPP_CHANNEL_UUID() {
    return optional("CALLBELL_WHATSAPP_CHANNEL_UUID");
  },

  // Addi (v1: solo enviar link/instrucciones; sin API — ver "No hacer en v1")
  get ADDI_LINK() {
    return optional("ADDI_LINK");
  },

  // Admin (operaciones internas como la carga de catálogo)
  get CATALOG_ADMIN_SECRET() {
    return optional("CATALOG_ADMIN_SECRET");
  },

  // Supabase
  get SUPABASE_URL() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
} as const;

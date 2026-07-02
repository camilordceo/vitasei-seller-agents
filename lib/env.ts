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

  // Debounce: ms que esperamos tras un inbound para agrupar mensajes seguidos
  // y responder una sola vez (ver ADR-0013). Default 12s.
  get REPLY_DEBOUNCE_MS() {
    const raw = optional("REPLY_DEBOUNCE_MS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : 12000;
  },

  // Retargeting: seguimientos automáticos tras dejar de responder (ver ADR-0017).
  // Kill switch global (default ON) + delays de las dos etapas (default 1h y 8h).
  get RETARGET_ENABLED() {
    const raw = optional("RETARGET_ENABLED");
    // Activo por defecto; solo se apaga con "false"/"0".
    return !(raw === "false" || raw === "0");
  },
  get RETARGET_STAGE1_MS() {
    const raw = optional("RETARGET_STAGE1_MS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000; // 1h
  },
  get RETARGET_STAGE2_MS() {
    const raw = optional("RETARGET_STAGE2_MS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 8 * 60 * 60 * 1000; // 8h
  },
  // Secret del cron (Vercel lo manda como `Authorization: Bearer <CRON_SECRET>`).
  // Si está vacío, el endpoint del cron queda abierto (solo dev).
  get CRON_SECRET() {
    return optional("CRON_SECRET");
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

  // Número de WhatsApp de la IA (E.164 sin '+'). En Callbell hay varios números
  // y un solo webhook: solo procesamos los inbound que llegan a ESTE número.
  // Si está vacío, el filtro queda desactivado (procesa todo — solo dev).
  get AGENT_WHATSAPP_NUMBER() {
    return optional("AGENT_WHATSAPP_NUMBER");
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

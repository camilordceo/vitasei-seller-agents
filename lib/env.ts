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
  // file_search: nº de fragmentos que OpenAI recupera del vector store por
  // llamada. Con pocos resultados (5) un archivo "aparte" (p.ej. tarifas de
  // envío) puede quedar fuera del top-K frente a decenas de docs de producto;
  // el playground usa 20 por defecto (por eso ahí sí aparece). Default 20;
  // subir da más recall a costa de tokens/latencia. Ver ADR-0024.
  get FILE_SEARCH_MAX_RESULTS() {
    const raw = optional("FILE_SEARCH_MAX_RESULTS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  },
  // Transcripción de notas de voz (ver docs/15, ADR-0022). Whisper por defecto.
  get OPENAI_TRANSCRIBE_MODEL() {
    return optional("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1";
  },

  // Comprensión de audio e imágenes (multimodal). Kill switch global (default ON):
  // con "false"/"0" el bot ignora el media y responde solo al texto. `MEDIA_MAX_BYTES`
  // limita la descarga de un adjunto (default 20 MB; Whisper admite hasta 25 MB).
  get MEDIA_UNDERSTANDING_ENABLED() {
    const raw = optional("MEDIA_UNDERSTANDING_ENABLED");
    return !(raw === "false" || raw === "0");
  },
  get MEDIA_MAX_BYTES() {
    const raw = optional("MEDIA_MAX_BYTES");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20 * 1024 * 1024; // 20 MB
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
  // Reactivaciones por plantilla (ver ADR-0021). El ON/OFF y los UUIDs de
  // plantilla viven en la DB (`app_settings`, editables desde el dashboard); acá
  // solo los delays de las dos etapas (default 7 y 15 días), configurables para
  // pruebas.
  get REACTIVATION_STAGE1_MS() {
    const raw = optional("REACTIVATION_STAGE1_MS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60 * 1000; // 7 días
  },
  get REACTIVATION_STAGE2_MS() {
    const raw = optional("REACTIVATION_STAGE2_MS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 15 * 24 * 60 * 60 * 1000; // 15 días
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

  // Número de WhatsApp de la IA (E.164 sin '+'). Multi-agente (docs/16, ADR-0023):
  // el enrutamiento vive en la tabla `agents`; esta env es el FALLBACK del agente
  // seed (para no caer producción mientras se pegan los IDs en el dashboard).
  get AGENT_WHATSAPP_NUMBER() {
    return optional("AGENT_WHATSAPP_NUMBER");
  },

  // Addi (v1: solo enviar link/instrucciones; sin API — ver "No hacer en v1")
  get ADDI_LINK() {
    return optional("ADDI_LINK");
  },

  // Notificación al dueño cuando el agente genera una venta (E.164 sin '+').
  // Se envía por el MISMO Callbell del agente que hizo la venta. Vacío = apagado.
  // OJO: es un mensaje libre → WhatsApp solo lo ENTREGA dentro de la ventana de 24h
  // desde que este número le escribió al negocio; para 100% de entrega, migrar a
  // una plantilla aprobada (sendTemplate). Ver notas en processMessage/notifyOwnerOfSale.
  get SALES_NOTIFY_PHONE() {
    return optional("SALES_NOTIFY_PHONE") ?? "573103565492";
  },

  // Notificación al dueño cuando un cliente pide llamada (`#llamada`), E.164 sin
  // '+'. Se envía por el MISMO Callbell del agente. Default al mismo número que
  // el aviso de venta. Vacío ("") = apagado. Mismo caveat de ventana 24h que las
  // ventas. Ver ADR-0034.
  get CALLS_NOTIFY_PHONE() {
    return optional("CALLS_NOTIFY_PHONE") ?? "573103565492";
  },

  // Admin (operaciones internas como la carga de catálogo)
  get CATALOG_ADMIN_SECRET() {
    return optional("CATALOG_ADMIN_SECRET");
  },

  // Hotmart — Carritos abandonados (ver docs/17-hotmart-carritos.md, ADR-0035)
  // Secret para validar el webhook de Hotmart.
  get HOTMART_WEBHOOK_SECRET() {
    return optional("HOTMART_WEBHOOK_SECRET");
  },
  // UUID de la plantilla de WhatsApp para carrito abandonado (Callbell).
  get HOTMART_ABANDONED_CART_TEMPLATE_UUID() {
    return optional("HOTMART_ABANDONED_CART_TEMPLATE_UUID");
  },
  // ID del agente que maneja los eventos de Hotmart (opcional; fallback al primer agente activo).
  get HOTMART_AGENT_ID() {
    return optional("HOTMART_AGENT_ID");
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

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

  // Retargeting: seguimientos automáticos tras dejar de responder (ver ADR-0017,
  // ADR-0052). Kill switch global (default ON). Los delays por etapa son el BACKSTOP
  // genérico (default 1h/8h/23h): se usan solo cuando el agente no configuró sus
  // propias etapas en el dashboard (`agents.retarget_config`). La 3ª es ~23h (y no
  // 24h) a propósito: entra en la ventana de 24h de WhatsApp y sí se entrega.
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
  get RETARGET_STAGE3_MS() {
    const raw = optional("RETARGET_STAGE3_MS");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 23 * 60 * 60 * 1000; // 23h (near-24h, dentro de ventana)
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

  // Kapso — segundo proveedor de WhatsApp (docs/24, ADR-0056). Todo es OPCIONAL:
  // la configuración real es POR AGENTE desde el dashboard (`agents.provider` +
  // `agents.kapso_*`), porque cada marca vive en su propio proyecto de Kapso. Estas
  // env son solo el fallback/atajo para el primer agente mientras se pegan los IDs,
  // igual que las de Callbell. Sin ningún agente en Kapso, nada de esto se usa.
  get KAPSO_API_KEY() {
    return optional("KAPSO_API_KEY");
  },
  // Meta Phone Number ID del número (Kapso es un proxy de la Cloud API de Meta):
  // va en el path del envío y es el campo por el que se enruta el inbound.
  get KAPSO_PHONE_NUMBER_ID() {
    return optional("KAPSO_PHONE_NUMBER_ID");
  },
  // `secret_key` con el que se registró el webhook en Kapso (firma HMAC SHA256).
  // Vacío = no se valida la firma (solo dev). Ver docs/24 §Firma.
  get KAPSO_WEBHOOK_SECRET() {
    return optional("KAPSO_WEBHOOK_SECRET");
  },
  // Idioma por defecto de las plantillas de Kapso (se referencian por nombre +
  // idioma, no por uuid como en Callbell). Default `es`.
  get KAPSO_TEMPLATE_LANGUAGE() {
    return optional("KAPSO_TEMPLATE_LANGUAGE");
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
  // ID del agente que maneja los eventos de Hotmart. FALLBACK: desde ADR-0041 el
  // agente se designa en el dashboard (agents.hotmart_enabled, /dashboard/hotmart);
  // esta env solo se usa si no hay ninguno marcado (y si no, el primer agente activo).
  get HOTMART_AGENT_ID() {
    return optional("HOTMART_AGENT_ID");
  },

  // Llamadas con IA — Synthflow (ver docs/25, ADR-0060..0063)
  // Kill switch GLOBAL. Apagado por defecto: un fallo acá llama a un cliente
  // real y cuesta plata. Prender exige además `agents.voice_enabled`.
  get VOICE_CALLS_ENABLED() {
    const raw = process.env.VOICE_CALLS_ENABLED;
    return raw === "true" || raw === "1";
  },
  // API key global; cada agente puede sobreescribirla (`agents.synthflow_api_key`).
  get SYNTHFLOW_API_KEY() {
    return optional("SYNTHFLOW_API_KEY");
  },
  // Base REGIONAL del workspace. Ojo: con la misma key, la región equivocada
  // devuelve 401 (no 404). La cuenta de Vitasei vive en la global.
  get SYNTHFLOW_API_BASE() {
    return optional("SYNTHFLOW_API_BASE") ?? "https://api.synthflow.ai/v2";
  },
  // Requerido SOLO para listar voces (`GET /v2/voices`). Es distinto de la key.
  get SYNTHFLOW_WORKSPACE_ID() {
    return optional("SYNTHFLOW_WORKSPACE_ID");
  },
  // Secreto del post-call webhook. Synthflow firma el `call_id`, no el cuerpo:
  // por eso el webhook es solo un aviso y los datos se releen por API (ADR-0061).
  get SYNTHFLOW_WEBHOOK_SECRET() {
    return optional("SYNTHFLOW_WEBHOOK_SECRET");
  },
  // Costo estimado por minuto: Synthflow NO expone costo por API.
  get SYNTHFLOW_USD_PER_MINUTE() {
    const n = Number(process.env.SYNTHFLOW_USD_PER_MINUTE);
    return Number.isFinite(n) && n > 0 ? n : 0.2;
  },

  // Gasto real en pauta (ADR-0082). Token Bearer que usa el producto de anuncios
  // para mandarnos el gasto por día. SIN esta variable el endpoint queda CERRADO
  // (503, no abierto): es una entrada de escritura pública en internet, y un
  // "abierto en dev" acá significa que cualquiera puede envenenar el ROAS.
  get AD_SPEND_API_KEY() {
    return optional("AD_SPEND_API_KEY");
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

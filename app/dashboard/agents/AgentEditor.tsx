"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveAgent, createAgent, loadAgentCatalog } from "../actions";
import {
  normalizeCatalogJson,
  resolveImageSource,
  validateCatalog,
  type CatalogProductInput,
} from "@/lib/openai/catalog";
import type { CatalogImportResult } from "@/lib/openai/catalogLoader";
import {
  isAgentActiveNow,
  COLOMBIA_HOLIDAYS_2026,
  DEFAULT_TIMEZONE,
  type AgentSchedule,
  type ScheduleWindow,
} from "@/lib/agent/schedule";
import { WeekScheduleEditor } from "./WeekScheduleEditor";
import {
  normalizePaymentTag,
  slugMethod,
  type PaymentMethodConfig,
} from "@/lib/agent/paymentMethods";
import type { AgentEditInput } from "./types";
import type { MessagingProviderId } from "@/lib/messaging/types";

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400";
const monoCls = `${inputCls} font-mono`;
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

type CatalogMode = "create" | "add" | "existing";

export interface AgentEditorInitial {
  name: string;
  brand: string;
  country: string;
  whatsappNumber: string;
  provider: MessagingProviderId;
  callbellChannelUuid: string;
  hasCallbellApiKey: boolean;
  callbellApiKeyLast4: string | null;
  kapsoPhoneNumberId: string;
  kapsoTemplateLanguage: string;
  hasKapsoApiKey: boolean;
  hasKapsoWebhookSecret: boolean;
  logisticsTeamUuid: string;
  vectorStoreId: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  schedule: AgentSchedule;
  paymentMethods: PaymentMethodConfig[];
}

/**
 * Editor de un agente (marca/número): config de IA + credenciales de Callbell + catálogo.
 * Sirve para CREAR (sin `agentId`) o EDITAR. La API key de Callbell es write-only.
 *
 * Catálogo — tres flujos (ver ADR-0028, ADR-0048):
 *  - "Crear vector store nuevo": se autogenera el store del agente y se cargan los productos
 *    del JSON a OpenAI (`file_search`) y a Supabase.
 *  - "Agregar / actualizar productos": mantiene el store actual y hace merge (no borra lo
 *    anterior); ideal para agregar uno o pocos productos. Solo al editar un agente con store.
 *  - "Ya tengo vector store": se pega el `vs_...` y el JSON se carga SOLO a Supabase.
 */
export function AgentEditor({
  agentId,
  initial,
}: {
  agentId?: string;
  initial: AgentEditorInitial;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [brand, setBrand] = useState(initial.brand);
  const [country, setCountry] = useState(initial.country);
  const [whatsappNumber, setWhatsappNumber] = useState(initial.whatsappNumber);
  const [provider, setProvider] = useState<MessagingProviderId>(initial.provider);
  const [channelUuid, setChannelUuid] = useState(initial.callbellChannelUuid);
  const [apiKey, setApiKey] = useState("");
  const [teamUuid, setTeamUuid] = useState(initial.logisticsTeamUuid);
  // Kapso (ADR-0056). Los secretos arrancan vacíos: son write-only, como la key de
  // Callbell — vacío significa "no cambiar", no "borrar".
  const [kapsoPhoneNumberId, setKapsoPhoneNumberId] = useState(initial.kapsoPhoneNumberId);
  const [kapsoTemplateLanguage, setKapsoTemplateLanguage] = useState(initial.kapsoTemplateLanguage);
  const [kapsoApiKey, setKapsoApiKey] = useState("");
  const [kapsoWebhookSecret, setKapsoWebhookSecret] = useState("");
  const [vectorStoreId, setVectorStoreId] = useState(initial.vectorStoreId);
  const [model, setModel] = useState(initial.model);
  const [temperature, setTemperature] = useState(String(initial.temperature));
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [enabled, setEnabled] = useState(initial.enabled);

  // Horario (encendido/apagado) — franjas por día. Ver ADR-0033.
  const [scheduleEnabled, setScheduleEnabled] = useState(initial.scheduleEnabled);
  const [scheduleTimezone, setScheduleTimezone] = useState(
    initial.scheduleTimezone || DEFAULT_TIMEZONE,
  );
  const [days, setDays] = useState<ScheduleWindow[][]>(initial.schedule.days);
  const [holidaysText, setHolidaysText] = useState(initial.schedule.holidays.join("\n"));

  // Métodos de pago (tags de compra por mercado). El `method` (clave guardada) sigue
  // al tag; los seeds CO conservan cod/addi mientras no se edite su tag. Ver ADR-0055.
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>(
    initial.paymentMethods,
  );
  const addPaymentMethod = () => {
    dirty();
    setPaymentMethods((prev) => [...prev, { tag: "", label: "", method: "" }]);
  };
  const removePaymentMethod = (i: number) => {
    dirty();
    setPaymentMethods((prev) => prev.filter((_, idx) => idx !== i));
  };
  const setMethodTag = (i: number, value: string) => {
    dirty();
    setPaymentMethods((prev) =>
      prev.map((m, idx) => (idx === i ? { ...m, tag: value, method: slugMethod(value) } : m)),
    );
  };
  const setMethodLabel = (i: number, value: string) => {
    dirty();
    setPaymentMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, label: value } : m)));
  };

  const buildSchedule = (): AgentSchedule => ({
    days,
    holidays: holidaysText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  });

  // Preview "activo ahora" (misma función pura que usa el backend).
  const activeNow = isAgentActiveNow({
    schedule_enabled: scheduleEnabled,
    schedule_timezone: scheduleTimezone,
    schedule: buildSchedule(),
  });

  // Catálogo. Al editar un agente que YA tiene store, el default es "add" (agregar/
  // actualizar sin borrar). Sin store todavía → "create".
  const hasStore = Boolean(agentId && initial.vectorStoreId);
  const [catalogMode, setCatalogMode] = useState<CatalogMode>(hasStore ? "add" : "create");
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductInput[] | null>(null);
  const [catalogFilename, setCatalogFilename] = useState<string | null>(null);
  const [catalogInfo, setCatalogInfo] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Estado del envío
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const clearCatalog = () => {
    setCatalogProducts(null);
    setCatalogFilename(null);
    setCatalogInfo(null);
    setCatalogError(null);
  };

  /**
   * Preview de las imágenes del JSON. El link que se ve acá es EXACTAMENTE el que queda en
   * `products.image_url` y el que Callbell le manda al cliente: no se re-hospeda nada
   * (ADR-0049). Así una foto equivocada se detecta antes de guardar, no en el chat.
   */
  const imagePreview = useMemo(() => {
    if (!catalogProducts) return null;
    const rows = catalogProducts.map((p) => {
      const src = resolveImageSource(p);
      return {
        sku: p.sku,
        name: p.name,
        url: src.kind === "url" ? src.url : null,
        base64: src.kind === "base64",
      };
    });
    return {
      rows,
      withImage: rows.filter((r) => r.url || r.base64).length,
      withoutImage: rows.filter((r) => !r.url && !r.base64).length,
    };
  }, [catalogProducts]);

  const onCatalogFile = async (file: File | null) => {
    dirty();
    setResult(null);
    clearCatalog();
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const norm = normalizeCatalogJson(parsed);
      if (norm.errors.length > 0) {
        setCatalogError(norm.errors.slice(0, 3).join(" · "));
        return;
      }
      const { errors } = validateCatalog({ products: norm.products });
      if (errors.length > 0) {
        setCatalogError(`${errors.length} problema(s): ${errors.slice(0, 3).join(" · ")}`);
        return;
      }
      setCatalogProducts(norm.products);
      setCatalogFilename(file.name);
      const fmt = norm.format === "bubble" ? "export Bubble" : "canónico";
      setCatalogInfo(`${norm.products.length} productos detectados (${fmt})`);
    } catch (e) {
      setCatalogError(e instanceof Error ? `JSON inválido: ${e.message}` : "JSON inválido");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setStatus(null);

    if (catalogError) {
      setError("Corrige el JSON de productos antes de continuar.");
      return;
    }

    const t = Number(temperature.trim());
    const payload: AgentEditInput = {
      name,
      brand,
      country,
      whatsappNumber,
      provider,
      callbellChannelUuid: channelUuid,
      callbellApiKey: apiKey,
      kapsoPhoneNumberId,
      kapsoApiKey,
      kapsoWebhookSecret,
      kapsoTemplateLanguage,
      logisticsTeamUuid: teamUuid,
      // En modo "create" el store se autogenera: guardamos vacío (null) para que el loader lo cree.
      vectorStoreId: catalogMode === "create" ? "" : vectorStoreId,
      model,
      temperature: Number.isFinite(t) ? t : 0.3,
      systemPrompt,
      enabled,
      scheduleEnabled,
      scheduleTimezone: scheduleTimezone.trim() || DEFAULT_TIMEZONE,
      schedule: buildSchedule(),
      // Normaliza cada tag; el server (parsePaymentMethods) descarta vacíos/duplicados.
      paymentMethods: paymentMethods
        .map((m) => ({
          tag: normalizePaymentTag(m.tag),
          label: m.label.trim(),
          method: m.method || slugMethod(m.tag),
        }))
        .filter((m) => m.tag.length > 0),
    };

    const hasCatalog = Boolean(catalogProducts && catalogProducts.length > 0);

    startTransition(async () => {
      try {
        // 1) Crear/guardar el agente.
        let id: string;
        if (agentId) {
          setStatus("Guardando agente…");
          await saveAgent(agentId, payload);
          id = agentId;
        } else {
          setStatus("Creando agente…");
          id = await createAgent(payload);
          if (hasCatalog) setCreatedId(id); // agente ya existe: fija link y evita doble creación
        }

        // 2) Cargar catálogo (si hay).
        if (hasCatalog) {
          setStatus("Cargando catálogo… esto puede tardar 1–2 min.");
          const res = await loadAgentCatalog(id, {
            mode: catalogMode,
            products: catalogProducts!,
            filename: catalogFilename,
          });
          setResult(res);
          setStatus(null);

          if (!res.ok) {
            setError(
              `El agente ${agentId ? "se guardó" : "se creó"}, pero el catálogo falló: ${res.errors.join(" · ")}`,
            );
            if (agentId) router.refresh();
            return;
          }

          if (agentId) {
            setApiKey("");
            setSaved(true);
            router.refresh();
          }
          // Agente nuevo: nos quedamos en el panel de resultado (con link "Abrir agente").
          return;
        }

        // 3) Sin catálogo: comportamiento previo.
        setStatus(null);
        if (agentId) {
          setApiKey("");
          setSaved(true);
          router.refresh();
        } else {
          router.push(`/dashboard/agents/${id}`);
        }
      } catch (err) {
        setStatus(null);
        setError(err instanceof Error ? err.message : "No se pudo guardar. Intenta de nuevo.");
      }
    });
  };

  const keyPlaceholder = initial.hasCallbellApiKey
    ? `•••• ${initial.callbellApiKeyLast4 ?? ""} — deja vacío para conservarla`
    : "Pega la API key de la cuenta de Callbell de esta marca";
  const kapsoKeyPlaceholder = initial.hasKapsoApiKey
    ? "•••• — deja vacío para conservarla"
    : "Pega la API key del proyecto de Kapso";
  const kapsoSecretPlaceholder = initial.hasKapsoWebhookSecret
    ? "•••• — deja vacío para conservarlo"
    : "El secret_key del webhook de Kapso (usa el global si se deja vacío)";

  const locked = isPending || createdId !== null;

  // `h-11` = 44px: es el touch target mínimo de las reglas de UI del proyecto.
  const providerBtn = (id: MessagingProviderId, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={provider === id}
      onClick={() => {
        dirty();
        setProvider(id);
      }}
      className={`inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        provider === id
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  const modeBtn = (mode: CatalogMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        dirty();
        setResult(null);
        clearCatalog();
        setCatalogMode(mode);
      }}
      aria-pressed={catalogMode === mode}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        catalogMode === mode
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Nombre + estado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="name" className={labelCls}>
            Nombre del agente
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => {
              dirty();
              setName(e.target.value);
            }}
            className={inputCls}
            placeholder="Vitasei México"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Agente habilitado"
            onClick={() => {
              dirty();
              setEnabled((v) => !v);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              enabled ? "bg-emerald-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
          {enabled ? "Habilitado" : "Deshabilitado"}
        </label>
      </div>

      {/* Marca / país */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="brand" className={labelCls}>
            Marca
          </label>
          <input
            id="brand"
            value={brand}
            onChange={(e) => {
              dirty();
              setBrand(e.target.value);
            }}
            className={inputCls}
            placeholder="Vitasei"
          />
        </div>
        <div>
          <label htmlFor="country" className={labelCls}>
            País
          </label>
          <input
            id="country"
            value={country}
            onChange={(e) => {
              dirty();
              setCountry(e.target.value);
            }}
            className={inputCls}
            placeholder="MX"
          />
        </div>
      </div>

      {/* Proveedor de WhatsApp + enrutamiento (ADR-0056) */}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">
          Proveedor de WhatsApp y enrutamiento
        </legend>

        <div className="sm:col-span-2">
          <span className={labelCls}>Proveedor</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Proveedor de WhatsApp">
            {providerBtn("callbell", "Callbell")}
            {providerBtn("kapso", "Kapso")}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Por acá entran y salen los mensajes de este agente. Los dos conviven: puedes tener
            una marca en Callbell y otra en Kapso al mismo tiempo. El resto del agente (prompt,
            catálogo, horario, retargets, pagos) funciona igual en ambos.
          </p>
        </div>

        <div>
          <label htmlFor="wa" className={labelCls}>
            Número de WhatsApp (E.164 sin +)
          </label>
          <input
            id="wa"
            value={whatsappNumber}
            onChange={(e) => {
              dirty();
              setWhatsappNumber(e.target.value);
            }}
            className={monoCls}
            placeholder="5215555555555"
          />
        </div>

        {provider === "callbell" ? (
          <>
            <div>
              <label htmlFor="chan" className={labelCls}>
                Callbell channel_uuid
              </label>
              <input
                id="chan"
                value={channelUuid}
                onChange={(e) => {
                  dirty();
                  setChannelUuid(e.target.value);
                }}
                className={monoCls}
                placeholder="UUID del canal de esta línea"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="key" className={labelCls}>
                Callbell API key{" "}
                {initial.hasCallbellApiKey ? "(configurada)" : "(usa la global si se deja vacía)"}
              </label>
              <input
                id="key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => {
                  dirty();
                  setApiKey(e.target.value);
                }}
                className={monoCls}
                placeholder={keyPlaceholder}
              />
              <p className="mt-1 text-xs text-slate-400">
                Solo si esta marca vive en otra cuenta de Callbell. Si se deja vacía, se usa la key
                global del proyecto. No se muestra por seguridad.
              </p>
            </div>
            <div>
              <label htmlFor="team" className={labelCls}>
                Equipo de logística (team_uuid)
              </label>
              <input
                id="team"
                value={teamUuid}
                onChange={(e) => {
                  dirty();
                  setTeamUuid(e.target.value);
                }}
                className={monoCls}
                placeholder="UUID del equipo (handoff)"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="kapso-pn" className={labelCls}>
                Kapso Phone Number ID
              </label>
              <input
                id="kapso-pn"
                value={kapsoPhoneNumberId}
                onChange={(e) => {
                  dirty();
                  setKapsoPhoneNumberId(e.target.value);
                }}
                className={monoCls}
                placeholder="647015955153740"
              />
              <p className="mt-1 text-xs text-slate-400">
                El <strong>Meta Phone Number ID</strong> del número (no el teléfono). Kapso lo
                lista en WhatsApp → Phone numbers. Es lo que enruta el inbound a este agente.
              </p>
            </div>
            <div>
              <label htmlFor="kapso-lang" className={labelCls}>
                Idioma de las plantillas
              </label>
              <input
                id="kapso-lang"
                value={kapsoTemplateLanguage}
                onChange={(e) => {
                  dirty();
                  setKapsoTemplateLanguage(e.target.value);
                }}
                className={monoCls}
                placeholder="es_CO"
              />
              <p className="mt-1 text-xs text-slate-400">
                En Kapso las plantillas se piden por nombre + idioma. Este es el idioma por
                defecto; una plantilla puntual puede forzar otro con <code>nombre:en_US</code>.
              </p>
            </div>
            <div>
              <label htmlFor="kapso-key" className={labelCls}>
                Kapso API key {initial.hasKapsoApiKey ? "(configurada)" : ""}
              </label>
              <input
                id="kapso-key"
                type="password"
                autoComplete="new-password"
                value={kapsoApiKey}
                onChange={(e) => {
                  dirty();
                  setKapsoApiKey(e.target.value);
                }}
                className={monoCls}
                placeholder={kapsoKeyPlaceholder}
              />
              <p className="mt-1 text-xs text-slate-400">
                API key del proyecto de Kapso (Integrations → API keys). No se muestra por
                seguridad.
              </p>
            </div>
            <div>
              <label htmlFor="kapso-secret" className={labelCls}>
                Secreto del webhook {initial.hasKapsoWebhookSecret ? "(configurado)" : ""}
              </label>
              <input
                id="kapso-secret"
                type="password"
                autoComplete="new-password"
                value={kapsoWebhookSecret}
                onChange={(e) => {
                  dirty();
                  setKapsoWebhookSecret(e.target.value);
                }}
                className={monoCls}
                placeholder={kapsoSecretPlaceholder}
              />
              <p className="mt-1 text-xs text-slate-400">
                El mismo <code>secret_key</code> con el que registraste el webhook en Kapso. Si se
                deja vacío se usa el global (<code>KAPSO_WEBHOOK_SECRET</code>).{" "}
                <strong>Es obligatorio</strong>: sin ninguno de los dos, los mensajes entrantes se
                rechazan (el webhook es público y sin firma cualquiera podría hacer que el bot
                escriba desde tu número).
              </p>
            </div>
            <p className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              En Kapso el <strong>handoff</strong> no reasigna a un equipo (no existen los
              equipos de Callbell): la conversación igual queda en <em>handed_off</em> y la IA se
              calla, pero el reparto al humano lo haces desde el inbox de Kapso.
            </p>
          </>
        )}
      </fieldset>

      {/* Catálogo (productos) */}
      <fieldset className="grid gap-4 rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Catálogo (productos)</legend>

        <div className="flex flex-wrap gap-2">
          {hasStore && modeBtn("add", "Agregar / actualizar productos")}
          {modeBtn("create", "Crear vector store nuevo")}
          {modeBtn("existing", "Ya tengo vector store")}
        </div>

        {catalogMode === "existing" ? (
          <div>
            <label htmlFor="vs" className={labelCls}>
              OpenAI vector_store_id (catálogo)
            </label>
            <input
              id="vs"
              value={vectorStoreId}
              onChange={(e) => {
                dirty();
                setVectorStoreId(e.target.value);
              }}
              className={monoCls}
              placeholder="vs_..."
            />
            <p className="mt-1 text-xs text-slate-400">
              Pega el vector store que ya armaste en OpenAI. Si subes un JSON abajo, sus productos
              entran <strong>solo a Supabase</strong> (no se re-suben al store).
            </p>
          </div>
        ) : catalogMode === "add" ? (
          <p className="text-xs text-slate-500">
            Sube un JSON con los productos a <strong>agregar o actualizar</strong> (aunque sea uno).
            Se hace <strong>merge</strong> por SKU sobre tu catálogo actual: <strong>no se borra lo
            demás</strong> y se mantiene tu vector store.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Se creará un vector store nuevo para esta marca y se conectará a la IA automáticamente.
            Sube el JSON de productos para cargarlos al store y a Supabase.
          </p>
        )}

        <div>
          <label htmlFor="catalog" className={labelCls}>
            JSON de productos{" "}
            {catalogMode === "create"
              ? "(para crear el store y cargar productos)"
              : catalogMode === "add"
                ? "(productos a agregar/actualizar)"
                : "(opcional)"}
          </label>
          <input
            id="catalog"
            type="file"
            accept=".json,application/json"
            onChange={(e) => onCatalogFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
          {catalogInfo ? (
            <p className="mt-1 text-xs font-medium text-emerald-700">✓ {catalogInfo}</p>
          ) : null}
          {catalogError ? <p className="mt-1 text-xs text-rose-600">{catalogError}</p> : null}
          <p className="mt-1 text-xs text-slate-400">
            Formatos: export tipo Bubble (ID/Titulo/…) o canónico (sku/name/…). El precio usa{" "}
            <code>PrecioConDescuento</code>.
          </p>

          {/* Imágenes del JSON: el link que se ve acá es el que se guarda y el que se manda. */}
          {imagePreview ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                <p className="text-xs font-semibold text-slate-700">
                  Imágenes del archivo{" "}
                  <span className="font-normal text-slate-500">
                    (se manda este link, no se re-suben a Supabase)
                  </span>
                </p>
                <p className="text-xs text-slate-600">
                  <span className="font-medium text-emerald-700">
                    {imagePreview.withImage} con imagen
                  </span>
                  {imagePreview.withoutImage > 0 ? (
                    <span className="text-amber-700"> · {imagePreview.withoutImage} sin imagen</span>
                  ) : null}
                </p>
              </div>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {imagePreview.rows.map((r) => (
                  <li key={r.sku} className="flex items-center gap-3 px-3 py-2">
                    {r.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- link externo arbitrario del catálogo
                      <img
                        src={r.url}
                        alt=""
                        loading="lazy"
                        className="h-11 w-11 flex-none rounded border border-slate-200 bg-slate-50 object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`flex h-11 w-11 flex-none items-center justify-center rounded border text-[10px] font-medium ${
                          r.base64
                            ? "border-slate-200 bg-slate-50 text-slate-500"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {r.base64 ? "b64" : "sin"}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-800">{r.name}</p>
                      <p className="truncate font-mono text-[11px] text-slate-500">{r.sku}</p>
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        >
                          {r.url}
                        </a>
                      ) : (
                        <p className="text-[11px] text-amber-700">
                          {r.base64
                            ? "imagen en base64 (se hospeda en Supabase: no trae link)"
                            : "sin imagen en el JSON — el bot responde solo texto"}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </fieldset>

      {/* Horario (encendido/apagado) */}
      <fieldset className="grid gap-4 rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Horario (encendido/apagado)</legend>

        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-slate-500">
            Programa cuándo responde la IA. Con esto <strong>apagado</strong>, el agente responde
            siempre (mientras esté habilitado). Fuera del horario activo, el bot calla y los
            seguimientos/reactivaciones se aplazan.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={scheduleEnabled}
            aria-label="Programar horario"
            onClick={() => {
              dirty();
              setScheduleEnabled((v) => !v);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
              scheduleEnabled ? "bg-emerald-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                scheduleEnabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {scheduleEnabled ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-slate-600">Estado ahora:</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium ${
                  activeNow ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${activeNow ? "bg-emerald-500" : "bg-slate-400"}`}
                  aria-hidden="true"
                />
                {activeNow ? "Activo (responde)" : "Inactivo (calla)"}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="tz" className={labelCls}>
                  Zona horaria
                </label>
                <input
                  id="tz"
                  value={scheduleTimezone}
                  onChange={(e) => {
                    dirty();
                    setScheduleTimezone(e.target.value);
                  }}
                  className={monoCls}
                  placeholder="America/Bogota"
                />
              </div>
            </div>

            <div>
              <div className="mb-2">
                <span className={labelCls}>Franjas horarias por día</span>
                <p className="text-xs text-slate-400">
                  Agrega las horas en que la IA responde cada día (ej. lunes 20:00–23:00, o
                  &ldquo;Todo el día&rdquo; los fines de semana). Un día sin franjas queda apagado.
                  Si <strong>no</strong> configuras ningún día ni festivo, el agente responde
                  siempre. Para una franja que cruce la medianoche, pon la hora de apagado menor que
                  la de encendido (ej. 20:00–08:00).
                </p>
              </div>
              <WeekScheduleEditor
                days={days}
                onChange={(d) => {
                  dirty();
                  setDays(d);
                }}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor="holidays" className={labelCls}>
                  Festivos activos (una fecha por línea, AAAA-MM-DD)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    dirty();
                    setHolidaysText(COLOMBIA_HOLIDAYS_2026.join("\n"));
                  }}
                  className="rounded text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
                >
                  Cargar festivos Colombia 2026
                </button>
              </div>
              <textarea
                id="holidays"
                value={holidaysText}
                onChange={(e) => {
                  dirty();
                  setHolidaysText(e.target.value);
                }}
                rows={4}
                className={`${inputCls} font-mono`}
                placeholder={"2026-01-01\n2026-01-12"}
              />
              <p className="mt-1 text-xs text-slate-400">
                Estos días el agente está activo las 24 horas. Verifica las fechas del prefill.
              </p>
            </div>
          </>
        ) : null}
      </fieldset>

      {/* Métodos de pago (tags de compra por mercado) */}
      <fieldset className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Métodos de pago</legend>
        <p className="text-xs text-slate-500">
          Tags de compra que este agente reconoce según su mercado (Colombia: contra entrega,
          Addi; EE.UU.: Zelle…). Cuando el modelo escribe el tag al cerrar, el sistema lo detecta
          para <span className="font-medium text-slate-600">generar la orden</span> y lo quita del
          texto que ve el cliente. Recuerda instruir el tag en el prompt del agente.
        </p>

        {paymentMethods.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-xs text-slate-400">
            Sin métodos configurados. Agrega al menos uno para que el agente pueda cerrar ventas.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-400 sm:grid">
              <span>Tag (lo que escribe el modelo)</span>
              <span>Nombre visible</span>
              <span className="w-9" />
            </div>
            {paymentMethods.map((m, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  type="text"
                  value={m.tag}
                  onChange={(e) => setMethodTag(i, e.target.value)}
                  placeholder="#zelle"
                  aria-label={`Tag del método ${i + 1}`}
                  className={monoCls}
                />
                <input
                  type="text"
                  value={m.label}
                  onChange={(e) => setMethodLabel(i, e.target.value)}
                  placeholder="Zelle"
                  aria-label={`Nombre del método ${i + 1}`}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => removePaymentMethod(i)}
                  aria-label={`Quitar el método ${i + 1}`}
                  className="inline-flex h-[42px] w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={addPaymentMethod}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            + Agregar método
          </button>
        </div>
      </fieldset>

      {/* IA */}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">Inteligencia artificial</legend>
        <div>
          <label htmlFor="model" className={labelCls}>
            Modelo
          </label>
          <input
            id="model"
            value={model}
            onChange={(e) => {
              dirty();
              setModel(e.target.value);
            }}
            className={inputCls}
            placeholder="gpt-5.1"
          />
        </div>
        <div>
          <label htmlFor="temp" className={labelCls}>
            Temperatura (0–2)
          </label>
          <input
            id="temp"
            inputMode="decimal"
            value={temperature}
            onChange={(e) => {
              dirty();
              setTemperature(e.target.value);
            }}
            className={inputCls}
            placeholder="0.3"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="prompt" className={labelCls}>
            System prompt
          </label>
          <textarea
            id="prompt"
            value={systemPrompt}
            onChange={(e) => {
              dirty();
              setSystemPrompt(e.target.value);
            }}
            rows={14}
            className={`${inputCls} font-mono leading-relaxed`}
            placeholder="Eres el asesor de ventas de…"
          />
        </div>
      </fieldset>

      {/* Resultado de la carga de catálogo */}
      {result && result.ok ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">Catálogo cargado ✓</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>{result.rowsImported} productos cargados/actualizados</li>
            <li>
              {result.products.filter((p) => p.imageUrl).length} imágenes guardadas con el link
              del JSON (se pueden corregir en{" "}
              <Link href="/dashboard/inventory" className="underline underline-offset-2">
                Inventario
              </Link>
              )
            </li>
            {result.vectorStoreId ? (
              <li className="font-mono break-all">vector store: {result.vectorStoreId}</li>
            ) : null}
            {result.warnings.length > 0 ? (
              <li className="text-amber-700">
                {result.warnings.length} aviso(s): {result.warnings.slice(0, 2).join(" · ")}
              </li>
            ) : null}
          </ul>
          {createdId ? (
            <Link
              href={`/dashboard/agents/${createdId}`}
              className="mt-2 inline-block font-medium underline underline-offset-2"
            >
              Abrir agente →
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={locked}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
        >
          {isPending ? "Procesando…" : agentId ? "Guardar cambios" : "Crear agente"}
        </button>
        {status ? <span className="text-sm text-slate-500">{status}</span> : null}
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Cambios guardados
          </span>
        ) : null}
        {createdId && !error ? (
          <span className="text-sm font-medium text-emerald-700">Agente creado ✓</span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </form>
  );
}

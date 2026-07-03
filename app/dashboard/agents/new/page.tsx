import Link from "next/link";
import { AgentEditor, type AgentEditorInitial } from "../AgentEditor";

export const dynamic = "force-dynamic";
// Crear el vector store y subir el catálogo (polling de OpenAI) puede tardar; damos margen.
export const maxDuration = 300;

/** Plantilla para un agente nuevo (prompt base editable antes de guardar). */
const BLANK: AgentEditorInitial = {
  name: "",
  brand: "Vitasei",
  country: "",
  whatsappNumber: "",
  callbellChannelUuid: "",
  hasCallbellApiKey: false,
  callbellApiKeyLast4: null,
  logisticsTeamUuid: "",
  vectorStoreId: "",
  model: "gpt-5.1",
  temperature: 0.3,
  systemPrompt:
    "Eres el asesor de ventas de <marca> por WhatsApp. Hablas claro, cercano y directo. Tu meta es ayudar al cliente a comprar y dejar la orden lista.",
  enabled: true,
  scheduleEnabled: false,
  scheduleTimezone: "America/Bogota",
  schedule: { window: null, fullWeekdays: [], holidays: [] },
};

export default function NewAgentPage() {
  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/agents"
        className="inline-flex items-center gap-1 rounded-md text-sm text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Agentes
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">Nuevo agente</h1>
      <p className="text-sm text-slate-500">
        Configura la nueva marca/número. En <strong>Catálogo</strong> puedes crear el vector store
        y subir los productos (JSON) de una vez, o conectar uno que ya tengas en OpenAI. Al guardar,
        ese número empieza a responder con su IA.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <AgentEditor initial={BLANK} />
      </div>
    </div>
  );
}

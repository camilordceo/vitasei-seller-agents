import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgent } from "@/lib/dashboard/queries";
import { formatDateTime } from "@/lib/dashboard/format";
import { AgentEditor, type AgentEditorInitial } from "../AgentEditor";

export const dynamic = "force-dynamic";
// Recargar el catálogo (polling del vector store) puede tardar; damos margen.
export const maxDuration = 300;

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  const agent = await getAgent(params.id);
  if (!agent) notFound();

  const initial: AgentEditorInitial = {
    name: agent.name,
    brand: agent.brand ?? "",
    country: agent.country ?? "",
    whatsappNumber: agent.whatsappNumber ?? "",
    callbellChannelUuid: agent.callbellChannelUuid ?? "",
    hasCallbellApiKey: agent.hasCallbellApiKey,
    callbellApiKeyLast4: agent.callbellApiKeyLast4,
    logisticsTeamUuid: agent.logisticsTeamUuid ?? "",
    vectorStoreId: agent.vectorStoreId ?? "",
    model: agent.model,
    temperature: agent.temperature,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    scheduleEnabled: agent.scheduleEnabled,
    scheduleTimezone: agent.scheduleTimezone,
    schedule: agent.schedule,
  };

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

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
        <span className="text-xs text-slate-400">
          {[agent.brand, agent.country].filter(Boolean).join(" · ")}
        </span>
        <span className="ml-auto text-xs text-slate-400">
          Últ. edición {formatDateTime(agent.updatedAt)}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <AgentEditor agentId={agent.id} initial={initial} />
      </div>

      <p className="px-1 text-xs text-slate-400">
        El número entra por Callbell y se enruta a este agente por su channel_uuid (o número). Si
        el canal o la API key quedan vacíos, se usa la configuración global del proyecto (env).
      </p>
    </div>
  );
}

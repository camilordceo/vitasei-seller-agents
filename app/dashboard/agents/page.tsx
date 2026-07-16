import Link from "next/link";
import { getAgents } from "@/lib/dashboard/queries";
import { providerLabel } from "@/lib/messaging/types";

export const dynamic = "force-dynamic";

/**
 * Sección Agentes (multi-marca): lista de agentes disponibles + botón para crear.
 * Cada agente enruta un número de WhatsApp a su propia IA + la cuenta de SU
 * proveedor (Callbell o Kapso). Ver docs/16, ADR-0023; docs/24, ADR-0056.
 */
export default async function AgentsPage() {
  const agents = await getAgents();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agentes</h1>
          <p className="text-sm text-slate-500">
            Cada agente es una marca/número con su propia IA, catálogo y cuenta de Callbell. Agrega
            uno pegando sus IDs y empieza a responder ese número.
          </p>
        </div>
        <Link
          href="/dashboard/agents/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Nuevo agente
        </Link>
      </div>

      {agents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Aún no hay agentes. Aplica la migración <code className="font-mono">0010</code> o crea uno.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {agents.map((a) => (
            <li key={a.id}>
              <Link
                href={`/dashboard/agents/${a.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{a.name}</span>
                    <AgentEnabledPill enabled={a.enabled} />
                    {/* Por qué proveedor sale este agente: con dos líneas vivas a la
                        vez, saberlo de un vistazo evita tocar la marca equivocada. */}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        a.provider === "kapso"
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {providerLabel(a.provider)}
                    </span>
                    {a.brand || a.country ? (
                      <span className="text-xs text-slate-400">
                        {[a.brand, a.country].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span className="font-mono">{a.whatsappNumber ?? "sin número"}</span>
                    {a.provider === "kapso" ? (
                      <span>
                        {a.kapsoPhoneNumberId ? "phone number id ✓" : "falta phone number id"}
                      </span>
                    ) : (
                      <>
                        <span>{a.callbellChannelUuid ? "canal ✓" : "canal: env"}</span>
                        <span>{a.hasCallbellApiKey ? "API key propia" : "API key: global"}</span>
                      </>
                    )}
                    <span>{a.vectorStoreId ? "catálogo ✓" : "catálogo: env"}</span>
                    <span className="font-mono">{a.model}</span>
                  </div>
                </div>
                <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentEnabledPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        enabled
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-slate-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
      {enabled ? "Activo" : "Inactivo"}
    </span>
  );
}

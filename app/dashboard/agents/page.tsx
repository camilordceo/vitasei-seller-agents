import Link from "next/link";
import { getAgents } from "@/lib/dashboard/queries";
import { providerLabel } from "@/lib/messaging/types";
import { EmptyState, PageHeader, btnPrimary } from "../ui-kit";

export const dynamic = "force-dynamic";

/**
 * Sección Agentes (multi-marca): grid de cards con estado y checklist de
 * configuración. Cada agente enruta un número de WhatsApp a su propia IA + la
 * cuenta de SU proveedor (Callbell o Kapso). Ver docs/16, ADR-0023/0056.
 */
export default async function AgentsPage() {
  const agents = await getAgents();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agentes"
        description="Cada agente es una marca/número con su propia IA, catálogo y cuenta de proveedor."
        actions={
          <Link href="/dashboard/agents/new" className={btnPrimary}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Nuevo agente
          </Link>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          title="Aún no hay agentes"
          description="Aplica la migración 0010 o crea el primero para empezar a responder un número."
          action={
            <Link href="/dashboard/agents/new" className={btnPrimary}>
              Crear agente
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => {
            const checks: Array<{ label: string; ok: boolean }> =
              a.provider === "kapso"
                ? [
                    { label: "Phone number ID", ok: Boolean(a.kapsoPhoneNumberId) },
                    { label: "Catálogo", ok: Boolean(a.vectorStoreId) },
                  ]
                : [
                    { label: "Canal", ok: Boolean(a.callbellChannelUuid) },
                    { label: "API key propia", ok: a.hasCallbellApiKey },
                    { label: "Catálogo", ok: Boolean(a.vectorStoreId) },
                  ];
            return (
              <li
                key={a.id}
                className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-5 ${
                  a.enabled ? "" : "opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                      a.enabled ? "bg-teal-50 text-teal-600" : "bg-slate-100 text-slate-400"
                    }`}
                    aria-hidden="true"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="4" y="8" width="16" height="11" rx="3" />
                      <path d="M12 8V4.5M9 13.5h.01M15 13.5h.01" strokeLinecap="round" />
                      <circle cx="12" cy="3.5" r="1" />
                    </svg>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      a.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${a.enabled ? "bg-emerald-500" : "bg-slate-400"}`}
                      aria-hidden="true"
                    />
                    {a.enabled ? "Activo" : "Inactivo"}
                  </span>
                </div>

                <h2 className="mt-4 font-display text-lg font-semibold tracking-tight text-slate-900">
                  {a.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {[a.brand, a.country].filter(Boolean).join(" · ") || "Sin marca definida"}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      a.provider === "kapso"
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {providerLabel(a.provider)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-600">
                    {a.whatsappNumber ? `+${a.whatsappNumber}` : "sin número"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-600">
                    {a.model}
                  </span>
                </div>

                <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3.5">
                  {checks.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-xs">
                      <dt className="text-slate-500">{c.label}</dt>
                      <dd
                        className={`font-medium ${c.ok ? "text-emerald-700" : "text-slate-400"}`}
                      >
                        {c.ok ? "Configurado" : "Usa env global"}
                      </dd>
                    </div>
                  ))}
                </dl>

                <Link
                  href={`/dashboard/agents/${a.id}`}
                  className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  Editar configuración
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

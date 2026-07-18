import Link from "next/link";

/** Se muestra cuando el agente no existe (p. ej. fue borrado). */
export default function AgentNotFound() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">Este agente ya no existe.</p>
      <p className="mt-1 text-xs text-slate-400">Vuelve a la lista de agentes.</p>
      <Link
        href="/dashboard/agents"
        className="mt-4 inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        Ver agentes
      </Link>
    </div>
  );
}

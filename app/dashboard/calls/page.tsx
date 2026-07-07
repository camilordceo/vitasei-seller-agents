import Link from "next/link";
import { getCallRequests } from "@/lib/dashboard/queries";
import { CallRequestList } from "../ui";
import type { CallRequestStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ value: CallRequestStatus | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendientes" },
  { value: "done", label: "Llamadas" },
  { value: "cancelled", label: "Descartadas" },
];

const VALID = new Set<string>(["pending", "done", "cancelled"]);

export default async function CallsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const raw = searchParams.status;
  const status = raw && VALID.has(raw) ? (raw as CallRequestStatus) : undefined;
  const calls = await getCallRequests({ status });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Llamadas</h1>
          <p className="text-sm text-slate-500">
            Solicitudes de llamada que pidió el cliente por WhatsApp. Márcalas como llamadas cuando
            el equipo contacte a la persona.
          </p>
        </div>
        <span className="shrink-0 text-sm text-slate-400">{calls.length}</span>
      </div>

      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f.value === "all" && !status) || f.value === status;
          const href = f.value === "all" ? "/dashboard/calls" : `/dashboard/calls?status=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className={
                active
                  ? "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <CallRequestList rows={calls} />
    </div>
  );
}

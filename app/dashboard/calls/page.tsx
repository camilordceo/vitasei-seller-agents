import Link from "next/link";
import {
  getCallRequests,
  getVoiceCalls,
  getVoiceCallStats,
  getAgents,
  type VoiceCallFilters,
} from "@/lib/dashboard/queries";

import { CallRequestList, KpiCard } from "../ui";
import { VoiceCallsPanel } from "./VoiceCallsPanel";
import { PhoneSearch } from "./PhoneSearch";
import type { CallRequestStatus, VoiceCallStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Sección Llamadas unificada (docs/25): las llamadas con IA —realizadas y
 * programadas— y las solicitudes que pide el cliente con `#llamada` conviven en
 * un solo lugar, en dos pestañas.
 */


const IconClock = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" strokeLinecap="round" />
  </svg>
);
const IconPhone = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.7 2 2 0 0 1 6 3.5Z" strokeLinejoin="round" />
  </svg>
);
const IconTimer = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M9 2.5h6M12 6v6l4 2" strokeLinecap="round" />
    <circle cx="12" cy="13" r="8" />
  </svg>
);
const IconMoney = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

type Tab = "ia" | "requests";

const BUCKETS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "scheduled", label: "Programadas" },
  { value: "done", label: "Realizadas" },
];

const STATUSES: Array<{ value: VoiceCallStatus; label: string }> = [
  { value: "completed", label: "Contestadas" },
  { value: "no_answer", label: "Sin respuesta" },
  { value: "failed", label: "Fallidas" },
  { value: "cancelled", label: "Canceladas" },
];

const REQUEST_FILTERS: Array<{ value: CallRequestStatus | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendientes" },
  { value: "done", label: "Llamadas" },
  { value: "cancelled", label: "Descartadas" },
];

const REQUEST_VALID = new Set<string>(["pending", "done", "cancelled"]);
const STATUS_VALID = new Set<string>(STATUSES.map((s) => s.value));
const BUCKET_VALID = new Set<string>(["scheduled", "done", "all"]);

interface SearchParams {
  [key: string]: string | undefined;
  tab?: string;
  bucket?: string;
  status?: string;
  agent?: string;
  phone?: string;
}

/** Reconstruye el querystring preservando los otros filtros. */
function hrefWith(params: SearchParams, key: string, value: string): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== key) next.set(k, v);
  }
  if (value && value !== "all") next.set(key, value);
  const qs = next.toString();
  return qs ? `/dashboard/calls?${qs}` : "/dashboard/calls";
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      }
    >
      {children}
    </Link>
  );
}

export default async function CallsPage({ searchParams }: { searchParams: SearchParams }) {
  const tab: Tab = searchParams.tab === "requests" ? "requests" : "ia";

  if (tab === "requests") {
    const raw = searchParams.status;
    const status = raw && REQUEST_VALID.has(raw) ? (raw as CallRequestStatus) : undefined;
    const calls = await getCallRequests({ status });

    return (
      <div className="space-y-4">
        <Header count={calls.length} />
        <Tabs tab={tab} />
        <p className="text-sm text-slate-500">
          Solicitudes de llamada que pidió el cliente por WhatsApp. Márcalas como llamadas cuando el
          equipo contacte a la persona.
        </p>
        <nav className="flex flex-wrap gap-2">
          {REQUEST_FILTERS.map((f) => (
            <Pill
              key={f.value}
              href={hrefWith({ tab: "requests" }, "status", f.value)}
              active={(f.value === "all" && !status) || f.value === status}
            >
              {f.label}
            </Pill>
          ))}
        </nav>
        <CallRequestList rows={calls} />
      </div>
    );
  }

  // --- Pestaña de llamadas con IA -------------------------------------------
  const agents = await getAgents().catch(() => []);
  const agentId = agents.some((a) => a.id === searchParams.agent) ? searchParams.agent : undefined;

  const bucketRaw = searchParams.bucket;
  const bucket = bucketRaw && BUCKET_VALID.has(bucketRaw) ? bucketRaw : "all";
  const statusRaw = searchParams.status;
  const status = statusRaw && STATUS_VALID.has(statusRaw) ? (statusRaw as VoiceCallStatus) : undefined;

  const filters: VoiceCallFilters = {
    bucket: bucket as VoiceCallFilters["bucket"],
    status,
    agentId,
    phone: searchParams.phone,
  };

  const [rows, stats] = await Promise.all([
    getVoiceCalls(filters),
    getVoiceCallStats(agentId),
  ]);

  return (
    <div className="space-y-4">
      <Header count={rows.length} />
      <Tabs tab={tab} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Programadas" value={String(stats.scheduled)} icon={IconClock} />
        <KpiCard
          label="Contestadas"
          value={String(stats.completed)}
          sub={`${stats.noAnswer} sin respuesta`}
          icon={IconPhone}
        />
        <KpiCard label="Minutos" value={String(stats.totalMinutes)} icon={IconTimer} />
        <KpiCard
          label="Costo estimado"
          value={`US$ ${stats.totalCostUsd.toFixed(2)}`}
          sub="segun tarifa por minuto"
          icon={IconMoney}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <Pill
            key={b.value}
            href={hrefWith({ ...searchParams, tab: undefined, status: undefined }, "bucket", b.value)}
            active={bucket === b.value}
          >
            {b.label}
          </Pill>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        {STATUSES.map((s) => (
          <Pill
            key={s.value}
            href={hrefWith({ ...searchParams, tab: undefined, bucket: undefined }, "status", s.value)}
            active={status === s.value}
          >
            {s.label}
          </Pill>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PhoneSearch initial={searchParams.phone ?? ""} params={searchParams} />
        {agents.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Pill href={hrefWith(searchParams, "agent", "all")} active={!agentId}>
              Todos los agentes
            </Pill>
            {agents.map((a) => (
              <Pill key={a.id} href={hrefWith(searchParams, "agent", a.id)} active={agentId === a.id}>
                {a.name}
              </Pill>
            ))}
          </div>
        ) : null}
      </div>

      <VoiceCallsPanel rows={rows} />
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Llamadas</h1>
        <p className="text-sm text-slate-500">
          Llamadas con IA (realizadas y programadas) y solicitudes de los clientes.
        </p>
      </div>
      <span className="shrink-0 text-sm text-slate-400">{count}</span>
    </div>
  );
}

function Tabs({ tab }: { tab: Tab }) {
  return (
    <nav className="flex gap-1 border-b border-slate-200">
      <TabLink href="/dashboard/calls" active={tab === "ia"}>
        Llamadas con IA
      </TabLink>
      <TabLink href="/dashboard/calls?tab=requests" active={tab === "requests"}>
        Solicitudes
      </TabLink>
    </nav>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "-mb-px border-b-2 border-slate-900 px-4 py-2 text-sm font-medium text-slate-900"
          : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      }
    >
      {children}
    </Link>
  );
}

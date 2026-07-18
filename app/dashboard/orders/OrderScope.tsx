"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  CURRENCY_LABELS,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from "@/lib/dashboard/currency";

export type OrderAgentOption = {
  id: string;
  name: string;
  brand: string | null;
  currency: CurrencyCode;
};

/**
 * Alcance de la lectura de Órdenes: por qué agente y en qué moneda. Ver ADR-0068.
 *
 * Los dos son EXCLUYENTES por diseño: con un agente elegido la moneda la manda él
 * (su mercado), así que el selector de moneda se oculta en vez de quedar visible
 * sin efecto — un control que no hace nada es peor que uno ausente. Viendo todos
 * los agentes aparece, porque ahí sí hay una mezcla que homologar.
 *
 * Navega por query params (`?agent=`, `?cur=`) preservando los demás filtros, igual
 * que el resto de Órdenes. Cambiar cualquiera vuelve a la página 1.
 */
export function OrderScope({
  agents,
  agentId,
  currency,
  preserved,
}: {
  agents: OrderAgentOption[];
  /** id del agente activo, o "" para todos. */
  agentId: string;
  /** Moneda de lectura vigente. */
  currency: CurrencyCode;
  /** Filtros a conservar (status/q/sku). Sin `page`, `agent` ni `cur`. */
  preserved: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function go(next: { agent?: string; cur?: string }) {
    const qs = new URLSearchParams(preserved);
    const nextAgent = next.agent ?? agentId;
    if (nextAgent) qs.set("agent", nextAgent);
    // La moneda solo viaja en la URL cuando manda de verdad (viendo todos los
    // agentes). Con un agente elegido sobra: se deduce de él.
    const nextCur = next.cur ?? currency;
    if (!nextAgent && nextCur) qs.set("cur", nextCur);
    const s = qs.toString();
    startTransition(() => router.push(s ? `/dashboard/orders?${s}` : "/dashboard/orders"));
  }

  const selectCls =
    "min-h-[38px] rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {agents.length > 0 && (
        <select
          aria-label="Filtrar por agente"
          value={agentId}
          disabled={isPending}
          onChange={(e) => go({ agent: e.target.value })}
          className={`${selectCls} max-w-[18rem]`}
        >
          <option value="">Todos los agentes</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.brand ? ` · ${a.brand}` : ""} ({a.currency})
            </option>
          ))}
        </select>
      )}

      {!agentId && (
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ver en</span>
          <select
            aria-label="Moneda en la que se muestran los totales"
            value={currency}
            disabled={isPending}
            onChange={(e) => go({ cur: e.target.value })}
            className={selectCls}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      )}

      {isPending && <span className="text-xs text-slate-400">Cargando…</span>}
    </div>
  );
}

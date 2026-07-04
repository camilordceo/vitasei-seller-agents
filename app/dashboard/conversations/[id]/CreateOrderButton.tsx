"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrderForConversation } from "../../actions";

/**
 * Botón "Crear orden" del panel lateral de una conversación (cuando NO tiene
 * orden). Registra a mano una venta que el agente no cerró (p. ej. confirmó sin
 * `#orden-lista`): crea una orden en blanco anclada a este contacto y abre el
 * editor para completar ítems/envío/total. La orden cuenta en métricas. Ver ADR-0032.
 */
export function CreateOrderButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const orderId = await createOrderForConversation(conversationId);
        router.push(`/dashboard/orders/${orderId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo crear la orden. Intenta de nuevo.");
      }
    });
  };

  return (
    <div className="mt-3 space-y-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        {isPending ? "Creando…" : "Crear orden"}
      </button>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

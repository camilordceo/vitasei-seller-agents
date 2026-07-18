import type { ReactNode } from "react";

/**
 * Sección plegable del dashboard.
 *
 * Se construye sobre `<details>`/`<summary>` NATIVOS a propósito: el estado de
 * abierto/cerrado lo lleva el navegador, así que el componente NO usa hooks ni
 * `"use client"` y sirve igual en un server component (Conversaciones, Órdenes)
 * que dentro de uno de cliente (VoiceSettings). Además el teclado, el foco y el
 * "buscar en la página" funcionan sin que escribamos nada.
 *
 * El contenido sigue montado al cerrar (details solo lo oculta), así que los
 * formularios de adentro no pierden lo que el operador estaba escribiendo.
 */
export function Collapsible({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  /** Línea de apoyo bajo el título (contexto o resumen de lo que hay adentro). */
  subtitle?: ReactNode;
  /** Contenido a la derecha del encabezado: conteo, estado, chips de filtros activos. */
  badge?: ReactNode;
  /** Abierta al cargar. Default cerrada (el punto es recuperar espacio). */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500 [&::-webkit-details-marker]:hidden">
        <svg
          className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          {subtitle ? <span className="mt-0.5 block text-xs text-slate-500">{subtitle}</span> : null}
        </div>
        {badge ? <span className="shrink-0 text-xs text-slate-500">{badge}</span> : null}
      </summary>
      <div className="border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

import Link from "next/link";

/** Se muestra cuando la conversación no existe (p. ej. fue borrada). */
export default function ConversationNotFound() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">Esta conversación ya no existe.</p>
      <p className="mt-1 text-xs text-slate-400">
        Puede que se haya borrado. Vuelve a la lista de conversaciones.
      </p>
      <Link
        href="/dashboard/conversations"
        className="mt-4 inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        Ver conversaciones
      </Link>
    </div>
  );
}

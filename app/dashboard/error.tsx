"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 className="text-sm font-semibold text-red-800">No se pudo cargar el panel</h2>
      <p className="mt-1 text-sm text-red-700">
        Revisa la conexión a Supabase (URL/llaves) o vuelve a intentar.
      </p>
      <p className="mt-2 break-words font-mono text-xs text-red-500">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex min-h-[40px] items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
      >
        Reintentar
      </button>
    </div>
  );
}

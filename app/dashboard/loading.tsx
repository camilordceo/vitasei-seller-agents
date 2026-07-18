export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}

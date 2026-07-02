import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Vitasei · Panel",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-md text-sm font-semibold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Vitasei · Panel
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Resumen
              </Link>
              <Link
                href="/dashboard/conversations"
                className="rounded-md px-3 py-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Conversaciones
              </Link>
              <Link
                href="/dashboard/retargets"
                className="rounded-md px-3 py-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Retargets
              </Link>
            </nav>
          </div>
          <span className="text-xs text-slate-400">Interno</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

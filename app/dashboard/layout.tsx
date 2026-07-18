import type { ReactNode } from "react";
import { SidebarNav } from "./SidebarNav";

export const metadata = {
  title: "Vitasei · AI Studio",
};

/**
 * Shell del dashboard (docs/vitasei-software-design.md §5): sidebar navy fija
 * en desktop, top bar en móvil, workspace claro con ancho máximo 1440px.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
      <SidebarNav />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-[1440px] animate-fadeUp px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

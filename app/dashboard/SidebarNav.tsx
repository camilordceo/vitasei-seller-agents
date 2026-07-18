"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Navegación del dashboard (sistema "Silent Sensei", docs/vitasei-software-design.md §5).
 *
 * Un solo nav: sidebar navy fija en desktop, top bar con panel desplegable en
 * móvil. Client component solo por el estado activo (usePathname) y el toggle
 * móvil; no toca datos.
 */

type Item = { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Operación",
    items: [
      { href: "/dashboard", label: "Resumen", icon: "grid", exact: true },
      { href: "/dashboard/conversations", label: "Conversaciones", icon: "chat" },
      { href: "/dashboard/orders", label: "Órdenes", icon: "cart" },
      { href: "/dashboard/inventory", label: "Inventario", icon: "box" },
      { href: "/dashboard/calls", label: "Llamadas", icon: "phone" },
    ],
  },
  {
    title: "Automatización",
    items: [
      { href: "/dashboard/retargets", label: "Seguimientos", icon: "repeat" },
      { href: "/dashboard/hotmart", label: "Hotmart", icon: "bag" },
      { href: "/dashboard/videos", label: "Videos", icon: "play" },
    ],
  },
  {
    title: "Análisis",
    items: [
      { href: "/dashboard/reports", label: "Reportes", icon: "bars" },
      { href: "/dashboard/agents", label: "Agentes", icon: "bot" },
    ],
  },
];

/** Íconos SVG propios (el sistema no usa emojis ni librerías de íconos). */
const ICONS = {
  grid: <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" strokeLinejoin="round" />,
  chat: <path d="M21 12a8 8 0 0 1-8 8H4l1.5-3A8 8 0 1 1 21 12Z" strokeLinejoin="round" />,
  cart: (
    <>
      <path d="M3 4h2l2.4 12h11.2L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="19.5" r="1.2" />
      <circle cx="17" cy="19.5" r="1.2" />
    </>
  ),
  box: (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" strokeLinejoin="round" />
      <path d="M4 7l8 4 8-4M12 11v10" strokeLinejoin="round" />
    </>
  ),
  phone: (
    <path
      d="M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.7 2 2 0 0 1 6 3.5Z"
      strokeLinejoin="round"
    />
  ),
  repeat: (
    <path
      d="M17 2.5 21 6.5l-4 4M21 6.5H8a4 4 0 0 0-4 4v1M7 21.5l-4-4 4-4M3 17.5h13a4 4 0 0 0 4-4v-1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6L5 8Z" strokeLinejoin="round" />
      <path d="M8.5 8a3.5 3.5 0 0 1 7 0" strokeLinecap="round" />
    </>
  ),
  play: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10.5 9.5v5l4.5-2.5-4.5-2.5Z" strokeLinejoin="round" />
    </>
  ),
  bars: <path d="M5 20V10M12 20V4M19 20v-7" strokeLinecap="round" />,
  bot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4.5M9 13.5h.01M15 13.5h.01" strokeLinecap="round" />
      <circle cx="12" cy="3.5" r="1" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />,
  close: <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />,
} as const;

function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      className={className ?? "h-[18px] w-[18px]"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-teal-600 shadow-[0_0_0_1px_rgba(255,255,255,.06),0_6px_16px_-6px_rgba(13,148,136,.7)]">
        <span className="font-display text-lg font-bold tracking-tight text-white">v</span>
      </div>
      <div>
        <div className="font-display text-base font-semibold leading-none tracking-tight text-white">
          vitasei
        </div>
        <div className="mt-1 text-[10px] font-medium uppercase leading-none tracking-[0.14em] text-slate-500">
          AI Studio
        </div>
      </div>
    </div>
  );
}

function isActive(pathname: string, item: Item): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3.5 pb-4">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {g.title}
          </div>
          {g.items.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  active
                    ? "bg-teal-500/15 text-white shadow-[inset_2px_0_0_#0D9488]"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <span className={active ? "text-teal-400" : "text-slate-500"}>
                  <Icon name={item.icon} />
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Al navegar se cierra el panel móvil (usePathname cambia con la ruta).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-[264px] flex-none flex-col bg-slate-900 lg:flex">
        <div className="px-6 pb-5 pt-6">
          <Link
            href="/dashboard"
            className="inline-block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <Brand />
          </Link>
        </div>
        <NavLinks pathname={pathname} />
        <div className="border-t border-white/5 p-3.5">
          <div className="rounded-xl border border-white/5 bg-slate-800 px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-[7px] w-[7px] animate-pulseDot rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.18)]" />
              <span className="text-xs font-medium text-slate-300">Panel interno</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              Vitasei · Beauty Boost
            </p>
          </div>
        </div>
      </aside>

      {/* Top bar móvil */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-slate-900 px-4 lg:hidden">
        <Link
          href="/dashboard"
          className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          <Brand />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          <Icon name={open ? "close" : "menu"} className="h-5 w-5" />
        </button>
      </header>

      {/* Panel móvil */}
      {open ? (
        <div className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col overflow-y-auto bg-slate-900 lg:hidden">
          <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}

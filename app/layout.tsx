import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

// Tipografía del sistema (docs/vitasei-software-design.md §3): Geist para
// títulos/números (paquete oficial `geist`, auto-hospedado), Inter para cuerpo.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "AI Seller Vitasei",
  description:
    "Agente de ventas por WhatsApp para Vitasei — Responses API + File Search + Callbell.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${inter.variable}`}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="es">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gate simple del dashboard (Basic Auth).
 *
 * El panel muestra datos de clientes (PII), así que no debe quedar público. Si
 * `DASHBOARD_PASSWORD` está configurado, exigimos Basic Auth (usuario
 * `DASHBOARD_USER`, default `admin`). Si NO está configurado, se deja pasar
 * (dev) — pero en producción DEBES ponerlo. Cuando toque, se migra a Supabase
 * Auth (doc 06).
 */
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const user = process.env.DASHBOARD_USER || "admin";
  const header = req.headers.get("authorization");

  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      if (u === user && p === password) return NextResponse.next();
    } catch {
      // credenciales mal formadas → cae al 401 de abajo
    }
  }

  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Vitasei Panel"' },
  });
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
};

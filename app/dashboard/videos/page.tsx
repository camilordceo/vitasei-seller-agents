import { getVideos, getAgents } from "@/lib/dashboard/queries";
import { VideosManager } from "./VideosManager";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const [videos, agents] = await Promise.all([getVideos(), getAgents()]);
  const agentOptions = agents.map((a) => ({
    id: a.id,
    name: a.name,
    brand: a.brand,
    country: a.country,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Videos</h1>
        <p className="text-sm text-slate-500">
          Envía un video automáticamente cuando la respuesta del bot menciona una palabra. Ej.:
          si el bot dice &ldquo;magnesio&rdquo;, se envía el video de magnesio justo después del
          mensaje (una sola vez por conversación). Cada video se asigna a un{" "}
          <strong>mercado</strong> (agente/país): el video de magnesio de Colombia sale{" "}
          <strong>solo</strong> en Colombia, y México o EE.UU. pueden tener el suyo para la misma
          palabra. Un video <strong>global</strong> aplica a los países que no tengan uno propio
          para esa palabra.
        </p>
      </div>

      <VideosManager initial={videos} agents={agentOptions} />
    </div>
  );
}

import { getVideos, getAgents } from "@/lib/dashboard/queries";
import { VideosManager } from "./VideosManager";
import { PageHeader } from "../ui-kit";

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
      <PageHeader
        title="Videos"
        description={
          <>
            Envía un video automáticamente cuando la respuesta del bot menciona una palabra
            (una sola vez por conversación). Cada video se asigna a un <strong>mercado</strong>{" "}
            (agente/país); un video <strong>global</strong> aplica a los países que no tengan
            uno propio para esa palabra.
          </>
        }
      />

      <VideosManager initial={videos} agents={agentOptions} />
    </div>
  );
}

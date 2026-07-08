import { getVideos } from "@/lib/dashboard/queries";
import { VideosManager } from "./VideosManager";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const videos = await getVideos();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Videos</h1>
        <p className="text-sm text-slate-500">
          Envía un video automáticamente cuando la respuesta del bot menciona una palabra. Ej.:
          si el bot dice &ldquo;magnesio&rdquo;, se envía el video de magnesio justo después del
          mensaje (una sola vez por conversación).
        </p>
      </div>

      <VideosManager initial={videos} />
    </div>
  );
}

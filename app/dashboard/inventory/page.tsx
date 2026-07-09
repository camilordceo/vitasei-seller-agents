import { getAgents, getAgentProducts } from "@/lib/dashboard/queries";
import { AgentPicker } from "./AgentPicker";
import { InventoryManager } from "./InventoryManager";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agents = await getAgents();

  if (agents.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Inventario</h1>
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          No hay agentes. Crea uno en <span className="font-medium">Agentes</span> y carga su
          catálogo.
        </p>
      </div>
    );
  }

  // Agente seleccionado: el del query (?agent=), o el primero.
  const selectedId =
    searchParams.agent && agents.some((a) => a.id === searchParams.agent)
      ? searchParams.agent
      : agents[0].id;

  const products = await getAgentProducts(selectedId);
  const agentOptions = agents.map((a) => ({ id: a.id, name: a.name, brand: a.brand }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inventario</h1>
        <p className="text-sm text-slate-500">
          Catálogo por agente. Cambia el <strong>link de la imagen</strong> que el bot envía por
          WhatsApp (a veces la foto de WhatsApp no es la misma que la de la página). Solo se pega el
          link — <strong>no se suben archivos</strong> y <strong>no se re-sincroniza el vector
          store</strong>.
        </p>
      </div>

      <AgentPicker agents={agentOptions} current={selectedId} />

      {/* `key` fuerza remount al cambiar de agente (reinicia búsqueda/edición). */}
      <InventoryManager key={selectedId} products={products} />
    </div>
  );
}

import { getAgents, getAgentProducts } from "@/lib/dashboard/queries";
import { formatNumber } from "@/lib/dashboard/format";
import { AgentPicker } from "./AgentPicker";
import { InventoryManager } from "./InventoryManager";
import { EmptyState, Kpi, PageHeader } from "../ui-kit";

export const dynamic = "force-dynamic";

const IconBox = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" strokeLinejoin="round" />
    <path d="M4 7l8 4 8-4M12 11v10" strokeLinejoin="round" />
  </svg>
);
const IconImage = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M5 18l5-5 3 3 3-3 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconAlert = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 4 2.8 20h18.4L12 4Z" strokeLinejoin="round" />
    <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
  </svg>
);

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agents = await getAgents();

  if (agents.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventario" description="Catálogo por agente." />
        <EmptyState
          title="Aún no hay agentes"
          description="Crea un agente en la sección Agentes y carga su catálogo para ver el inventario aquí."
        />
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

  const withImage = products.filter((p) => p.imageUrl).length;
  const withoutImage = products.length - withImage;
  const outOfStock = products.filter((p) => !p.inStock).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        description="Catálogo por agente. La imagen de cada producto es la que el bot envía por WhatsApp: se corrige pegando el link (no se suben archivos ni se re-sincroniza el vector store)."
        actions={<AgentPicker agents={agentOptions} current={selectedId} />}
      />

      {products.length > 0 ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi
            label="Productos"
            value={formatNumber(products.length)}
            sub="en el catálogo de este agente"
            icon={IconBox}
            tone="navy"
          />
          <Kpi
            label="Con imagen"
            value={formatNumber(withImage)}
            sub={
              withoutImage > 0
                ? `${formatNumber(withoutImage)} sin imagen — el bot no puede enviarles foto`
                : "todo el catálogo tiene foto"
            }
            icon={IconImage}
            tone={withoutImage > 0 ? "amber" : "teal"}
            progress={(withImage / products.length) * 100}
          />
          <Kpi
            label="Sin stock"
            value={formatNumber(outOfStock)}
            sub={outOfStock > 0 ? "el bot no los ofrece" : "todo disponible"}
            icon={IconAlert}
            tone={outOfStock > 0 ? "rose" : "neutral"}
          />
        </section>
      ) : null}

      {/* `key` fuerza remount al cambiar de agente (reinicia búsqueda/edición). */}
      <InventoryManager key={selectedId} products={products} />
    </div>
  );
}

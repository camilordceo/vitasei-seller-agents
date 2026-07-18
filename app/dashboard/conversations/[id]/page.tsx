import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversation, getConversationEvents, getVideos } from "@/lib/dashboard/queries";
import { formatCOP, formatDateTime } from "@/lib/dashboard/format";
import { StatusPill, MethodPill, ManualPill, ManualToggle, OrderStatusPill } from "../../ui";
import { ChatPanel } from "./ChatPanel";
import { RetryButton } from "./RetryButton";
import { CreateOrderButton } from "./CreateOrderButton";
import { ConversationLabels } from "./ConversationLabels";
import { ProductCategoryEditor } from "./ProductCategoryEditor";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { getLabels, getConversationLabels } from "../../actions";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const convo = await getConversation(params.id);
  if (!convo) notFound();

  const title = convo.contact?.name ?? convo.contact?.phone ?? "Conversación";

  // Ventana de 24 h de WhatsApp: desde el último mensaje entrante del cliente.
  const lastInbound = [...convo.messages].reverse().find((m) => m.direction === "inbound");
  const within24h = lastInbound
    ? Date.now() - new Date(lastInbound.createdAt).getTime() < DAY_MS
    : false;

  // Cargar etiquetas de la conversación y las disponibles + palabras de producto +
  // el rastro de eventos (para el panel de diagnóstico "¿por qué no respondió?").
  const [conversationLabels, availableLabels, videos, events] = await Promise.all([
    getConversationLabels(params.id),
    getLabels(convo.agentId),
    getVideos(),
    getConversationEvents(params.id),
  ]);
  // Sugerencias para la fuente de producto = palabras clave configuradas (videos).
  const productSuggestions = [...new Set(videos.map((v) => v.keyword))].sort();

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 rounded-md text-sm text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Volver
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <StatusPill status={convo.status} />
        <MethodPill method={convo.method} />
        {convo.aiPaused ? <ManualPill /> : null}
        {convo.hotmartFlow ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700"
            title="Entró por un carrito abandonado de Hotmart (cursos). Cuando el cliente responde, el bot recibe la marca 'Es flujo hotmart'."
          >
            Hotmart · Cursos
          </span>
        ) : null}
        <div className="ml-auto flex items-start gap-2">
          <RetryButton
            conversationId={convo.id}
            disabled={convo.status !== "active" || convo.aiPaused}
            disabledReason={
              convo.status !== "active"
                ? "La conversación no está activa (handoff o cerrada)."
                : "La IA está en pausa (modo manual). Reactívala para reintentar."
            }
          />
          <ManualToggle conversationId={convo.id} paused={convo.aiPaused} />
        </div>
      </div>

      {/* Etiquetas de la conversación */}
      <ConversationLabels
        conversationId={convo.id}
        agentId={convo.agentId}
        initialLabels={conversationLabels}
        initialAvailable={availableLabels}
      />
      {convo.aiPaused ? (
        <p className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800">
          La IA está en pausa: un agente humano atiende esta conversación. Los mensajes del
          cliente se siguen registrando aquí, pero el bot no responde.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Hilo de mensajes + compositor (chat con scroll propio) */}
        <div className="lg:col-span-2">
          <ChatPanel
            conversationId={convo.id}
            messages={convo.messages}
            within24h={within24h}
          />
        </div>

        {/* Panel lateral */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Contacto</h2>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Nombre</dt>
                <dd className="text-right text-slate-900">{convo.contact?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Teléfono</dt>
                <dd className="text-right font-mono text-slate-900">{convo.contact?.phone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Inicio</dt>
                <dd className="text-right text-slate-900">{formatDateTime(convo.createdAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Producto / fuente</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Se detecta solo por palabra clave; puedes corregirla o fijarla a mano.
            </p>
            <div className="mt-2">
              <ProductCategoryEditor
                conversationId={convo.id}
                initial={convo.productCategory}
                suggestions={productSuggestions}
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">
              Órdenes{convo.orders.length > 0 ? ` (${convo.orders.length})` : ""}
            </h2>
            {convo.orders.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {convo.orders.map((order) => (
                  <li key={order.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <OrderStatusPill status={order.status} />
                      <span className="text-sm font-medium text-slate-900">
                        {formatCOP(order.total)}
                      </span>
                    </div>
                    <dl className="mt-2 space-y-1 text-xs text-slate-600">
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-400">Creada</dt>
                        <dd className="text-right">{formatDateTime(order.createdAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-400">Ítems</dt>
                        <dd className="text-right">{order.itemsCount}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-400">Envío a</dt>
                        <dd className="text-right">
                          {order.shippingName ?? "—"}
                          {order.shippingCity ? `, ${order.shippingCity}` : ""}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      Ver / editar orden
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Sin órdenes todavía.</p>
            )}
            <CreateOrderButton
              conversationId={convo.id}
              label={convo.orders.length > 0 ? "Crear otra orden" : "Crear orden"}
            />
          </div>

          <DiagnosticsPanel events={events} />
        </aside>
      </div>
    </div>
  );
}

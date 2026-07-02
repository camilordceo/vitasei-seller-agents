import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversation } from "@/lib/dashboard/queries";
import { formatCOP, formatDateTime } from "@/lib/dashboard/format";
import { StatusPill, MethodPill, ManualPill, ManualToggle, OrderStatusPill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const convo = await getConversation(params.id);
  if (!convo) notFound();

  const title = convo.contact?.name ?? convo.contact?.phone ?? "Conversación";

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
        <div className="ml-auto">
          <ManualToggle conversationId={convo.id} paused={convo.aiPaused} />
        </div>
      </div>
      {convo.aiPaused ? (
        <p className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800">
          La IA está en pausa: un agente humano atiende esta conversación. Los mensajes del
          cliente se siguen registrando aquí, pero el bot no responde.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Hilo de mensajes */}
        <div className="lg:col-span-2">
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
            {convo.messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Sin mensajes.</p>
            ) : (
              convo.messages.map((m) => {
                const out = m.direction === "outbound";
                return (
                  <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        out ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-900"
                      }`}
                    >
                      {m.type === "image" && m.mediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.mediaUrl}
                          alt="Imagen enviada"
                          className="mb-1 max-h-56 rounded-lg"
                        />
                      ) : null}
                      {m.content ? (
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      ) : m.type !== "text" ? (
                        <p className="italic opacity-80">[{m.type}]</p>
                      ) : null}
                      {m.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.tags.map((t, i) => (
                            <span
                              key={i}
                              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                out ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span
                        className={`mt-1 block text-[10px] ${
                          out ? "text-emerald-100" : "text-slate-400"
                        }`}
                      >
                        {formatDateTime(m.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
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
            <h2 className="text-sm font-semibold text-slate-700">Orden</h2>
            {convo.order ? (
              <>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Estado</dt>
                    <dd className="text-right">
                      <OrderStatusPill status={convo.order.status} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Total</dt>
                    <dd className="text-right font-medium text-slate-900">
                      {formatCOP(convo.order.total)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Ítems</dt>
                    <dd className="text-right text-slate-900">{convo.order.itemsCount}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Envío a</dt>
                    <dd className="text-right text-slate-900">
                      {convo.order.shippingName ?? "—"}
                      {convo.order.shippingCity ? `, ${convo.order.shippingCity}` : ""}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/dashboard/orders/${convo.order.id}`}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  Ver / editar orden
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Sin orden todavía.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
          AI Seller
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Vitasei — Agente de WhatsApp
        </h1>
        <p className="mt-3 text-base text-gray-600">
          Backend del agente de ventas. El dashboard llega en el Sprint 6.
        </p>
      </div>

      <dl className="grid gap-3 text-sm">
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt className="text-gray-500">Webhook Callbell</dt>
          <dd className="font-mono text-gray-900">/api/webhooks/callbell</dd>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt className="text-gray-500">Inngest</dt>
          <dd className="font-mono text-gray-900">/api/inngest</dd>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt className="text-gray-500">Health check</dt>
          <dd className="font-mono text-gray-900">/api/health</dd>
        </div>
      </dl>

      <p className="text-xs text-gray-400">
        Stack: Next.js 14 · TypeScript · Supabase · Inngest · OpenAI · Callbell
      </p>
    </main>
  );
}

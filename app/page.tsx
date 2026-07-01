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
          Backend del agente de ventas por WhatsApp.
        </p>
        <a
          href="/dashboard"
          className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
        >
          Abrir panel
        </a>
      </div>

      <dl className="grid gap-3 text-sm">
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt className="text-gray-500">Webhook Callbell</dt>
          <dd className="font-mono text-gray-900">/api/webhooks/callbell</dd>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-2">
          <dt className="text-gray-500">Health check</dt>
          <dd className="font-mono text-gray-900">/api/health</dd>
        </div>
      </dl>

      <p className="text-xs text-gray-400">
        Stack: Next.js 14 · TypeScript · Supabase · OpenAI · Callbell
      </p>
    </main>
  );
}

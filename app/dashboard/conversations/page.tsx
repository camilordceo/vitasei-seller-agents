import { getRecentConversations } from "@/lib/dashboard/queries";
import { ConversationList } from "../ui";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const convos = await getRecentConversations(100);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conversaciones</h1>
          <p className="text-sm text-slate-500">Todas las conversaciones del agente.</p>
        </div>
        <span className="text-sm text-slate-400">{convos.length}</span>
      </div>
      <ConversationList rows={convos} />
    </div>
  );
}

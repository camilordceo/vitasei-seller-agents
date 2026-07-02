"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelScheduledRetargets } from "@/lib/agent/retarget";
import type { Json } from "@/lib/supabase/types";

/**
 * Server Actions del dashboard.
 *
 * Corren server-side con el cliente service-role (nunca llega al browser) y
 * quedan protegidas por el Basic Auth del dashboard (middleware). Ver docs/11.
 */

/**
 * Pasa una conversación a modo manual (IA en silencio) o la reactiva. Al pausar,
 * cancela también los retargets pendientes (no queremos nudges mientras un humano
 * la atiende). Loguea `manual_on`/`manual_off` para auditoría.
 */
export async function setConversationManual(
  conversationId: string,
  paused: boolean,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("conversations")
    .update({ ai_paused: paused })
    .eq("id", conversationId);
  if (error) throw new Error(`setConversationManual: ${error.message}`);

  if (paused) {
    // Best-effort: si falla el cancel, el worker igual descarta por `manual-mode`.
    try {
      await cancelScheduledRetargets(supabase, conversationId, "manual-mode");
    } catch {
      // no-op
    }
  }

  await supabase.from("events_log").insert({
    conversation_id: conversationId,
    type: paused ? "manual_on" : "manual_off",
    payload: {} as unknown as Json,
  });

  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard");
}

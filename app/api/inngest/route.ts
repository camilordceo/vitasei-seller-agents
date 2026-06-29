import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { processMessage } from "@/inngest/functions/processMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processMessage],
});

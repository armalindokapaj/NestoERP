import { apiOk, withContext } from "@/lib/api/respond";
import { getPipeline } from "@/lib/modules/sales/opportunities/pipeline.service";

/** The Kanban board's data, in two queries rather than one per column (§247). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getPipeline(context) }));
}

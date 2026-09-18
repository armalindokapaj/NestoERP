import { apiOk, withContext } from "@/lib/api/respond";
import { listWorkers } from "@/lib/modules/workforce/workforce.directory";
import { parseWorkerQuery } from "@/lib/modules/workforce/workforce.schema";

/**
 * GET /api/workforce/workers — the workforce directory (E-04 §153): everybody
 * the company employs, login or not, by trade, crew, project and site, within
 * the reader's scope. Standard work facts only — never pay or private data.
 */
export async function GET(request: Request) {
  return withContext(async (context) => apiOk(await listWorkers(context, parseWorkerQuery(new URL(request.url).searchParams))));
}

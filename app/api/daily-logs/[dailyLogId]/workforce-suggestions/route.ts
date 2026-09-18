import { z } from "zod";

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { applyWorkforceSuggestions, workforceSuggestions } from "@/lib/modules/daily-logs/daily-log.workforce";

type Params = { params: Promise<{ dailyLogId: string }> };

const applySchema = z.object({ keys: z.array(z.string().trim().min(1).max(200)).min(1, "Pick at least one.").max(200) });

/**
 * GET  /api/daily-logs/:dailyLogId/workforce-suggestions — the project's crews and assigned people that day (E-04 §182).
 * POST /api/daily-logs/:dailyLogId/workforce-suggestions — add the ones picked, as workforce entries.
 *
 * Only for somebody who may write the log's workforce section now.
 */
export async function GET(_request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => apiOk({ data: await workforceSuggestions(context, dailyLogId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const { keys } = applySchema.parse(await readJson(request));
    return apiOk({ data: await applyWorkforceSuggestions(context, dailyLogId, keys) });
  });
}

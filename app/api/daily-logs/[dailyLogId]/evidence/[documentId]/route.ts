import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { setEvidenceMeta } from "@/lib/modules/daily-logs/daily-log.links";
import { evidenceMetaSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string; documentId: string }> };

/** PUT — how a file on the log sits in its evidence: category, caption, time taken (PRD #43 §77-§79). */
export async function PUT(request: Request, { params }: Params) {
  const { dailyLogId, documentId } = await params;
  return withContext(async (context) => {
    const input = evidenceMetaSchema.parse(await readJson(request));
    return apiOk({ data: await setEvidenceMeta(context, dailyLogId, documentId, input) });
  });
}

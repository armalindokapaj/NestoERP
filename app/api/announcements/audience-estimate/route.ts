import { z } from "zod";

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { estimateAudience } from "@/lib/modules/announcements/announcement.service";
import { AUDIENCE_TYPES } from "@/lib/modules/announcements/announcement.types";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const schema = z.object({ audienceType: z.enum(AUDIENCE_TYPES), projectId: id.nullish(), departmentId: id.nullish(), selectedMemberIds: z.array(id).max(500).optional() });

/**
 * POST — the estimated number of recipients for an audience this author could
 * address, before publishing (Activity Center §90). A count only; an audience
 * the author may not address is refused as it would be on save.
 */
export async function POST(request: Request) {
  return withContext(async (context) => apiOk({ data: await estimateAudience(context, schema.parse(await readJson(request))) }));
}

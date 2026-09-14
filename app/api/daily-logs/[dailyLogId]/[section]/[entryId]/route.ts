import { AccessError } from "@/lib/access/guards";
import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { removeEntry, updateEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { SECTION_SCHEMAS } from "@/lib/modules/daily-logs/daily-log.schema";
import { SECTION_KEYS, type SectionKey } from "@/lib/modules/daily-logs/daily-log.types";

type Params = { params: Promise<{ dailyLogId: string; section: string; entryId: string }> };

function sectionOf(section: string): SectionKey {
  if (!(SECTION_KEYS as readonly string[]).includes(section)) throw new AccessError("NOT_FOUND");
  return section as SectionKey;
}

/** PATCH — change one entry; a stale `updatedAt` is a conflict (PRD #43 §159-§161). */
export async function PATCH(request: Request, { params }: Params) {
  const { dailyLogId, section, entryId } = await params;
  return withContext(async (context) => {
    const key = sectionOf(section);
    const input = SECTION_SCHEMAS[key].parse(await readJson(request));
    return apiOk({ data: await updateEntry(context, dailyLogId, key, entryId, input as never) });
  });
}

/** DELETE — remove one entry from a log still being written. */
export async function DELETE(_request: Request, { params }: Params) {
  const { dailyLogId, section, entryId } = await params;
  return withContext(async (context) => apiOk({ data: await removeEntry(context, dailyLogId, sectionOf(section), entryId) }));
}

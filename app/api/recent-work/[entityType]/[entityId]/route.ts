import { apiOk, withContext } from "@/lib/api/respond";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";
import { removeRecentItem } from "@/lib/modules/productivity/recent-work.service";

type Params = { params: Promise<{ entityType: string; entityId: string }> };

/** DELETE — forget one recent record (PRD #45 §109). */
export async function DELETE(_request: Request, { params }: Params) {
  const raw = await params;
  return withContext(async (context) => {
    const ref = entityRefSchema.parse(raw);
    await removeRecentItem(context, ref.entityType, ref.entityId);
    return apiOk({ data: { removed: true } });
  });
}

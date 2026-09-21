import { apiOk, withContext } from "@/lib/api/respond";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";
import { removeRecentItemForWorkspace } from "@/lib/modules/productivity/recent-work.service";

type Params = { params: Promise<{ entityType: string; entityId: string }> };

/**
 * DELETE — forget one recent record (PRD #45 §109).
 *
 * Group workspace: `any`. Forgetting is the person's own light write with no
 * company to get wrong: it deletes their own row for that record, in whichever
 * of their memberships holds it (Workspace Context §43).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const raw = await params;
  return withContext(
    async (context) => {
      const ref = entityRefSchema.parse(raw);
      return apiOk({ data: { removed: await removeRecentItemForWorkspace(context, ref.entityType, ref.entityId) } });
    },
    { group: "any" },
  );
}

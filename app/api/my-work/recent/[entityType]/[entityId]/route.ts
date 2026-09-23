import { apiOk, withContext } from "@/lib/api/respond";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";
import { removeRecentItemForWorkspace } from "@/lib/modules/productivity/recent-work.service";

type Params = { params: Promise<{ entityType: string; entityId: string }> };

/** DELETE — forget one recent record of the person's own; idempotent (Fast Re-entry §78, §187). Group workspace: `any`. */
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

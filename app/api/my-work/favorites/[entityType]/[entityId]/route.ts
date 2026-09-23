import { apiOk, withContext } from "@/lib/api/respond";
import { removeFavoriteForWorkspace } from "@/lib/modules/productivity/favorites.service";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";

type Params = { params: Promise<{ entityType: string; entityId: string }> };

/** DELETE — un-star; removing an already-removed favorite is still 200 (Fast Re-entry §77, §186). Group workspace: `any`. */
export async function DELETE(_request: Request, { params }: Params) {
  const raw = await params;
  return withContext(
    async (context) => {
      const ref = entityRefSchema.parse(raw);
      return apiOk({ data: { removed: await removeFavoriteForWorkspace(context, ref) } });
    },
    { group: "any" },
  );
}

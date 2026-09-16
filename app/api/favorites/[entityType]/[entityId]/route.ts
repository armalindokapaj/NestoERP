import { apiOk, withContext } from "@/lib/api/respond";
import { removeFavorite } from "@/lib/modules/productivity/favorites.service";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";

type Params = { params: Promise<{ entityType: string; entityId: string }> };

/** DELETE — remove a favorite; the record is untouched (PRD #45 §77). */
export async function DELETE(_request: Request, { params }: Params) {
  const raw = await params;
  return withContext(async (context) => {
    const ref = entityRefSchema.parse(raw);
    // `removed` reports what happened rather than what was asked for: a star
    // that was never this member's comes back false (PRD #47 §75).
    return apiOk({ data: { removed: await removeFavorite(context, ref) } });
  });
}

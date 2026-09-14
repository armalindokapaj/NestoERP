import { apiOk, withContext } from "@/lib/api/respond";
import { removeRfiReference } from "@/lib/modules/engineering/engineering.rfis";

type Params = { params: Promise<{ rfiId: string; referenceId: string }> };

/** DELETE — remove a reference (PRD #46 §91). */
export async function DELETE(_request: Request, { params }: Params) {
  const { rfiId, referenceId } = await params;
  return withContext(async (context) => {
    await removeRfiReference(context, rfiId, referenceId);
    return apiOk({ data: { removed: true } });
  });
}

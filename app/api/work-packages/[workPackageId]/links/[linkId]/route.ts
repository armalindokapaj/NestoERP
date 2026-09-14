import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkRecord } from "@/lib/modules/engineering/engineering.links";

type Params = { params: Promise<{ workPackageId: string; linkId: string }> };

/** DELETE — remove a link; the other record is untouched (PRD #46 §136). */
export async function DELETE(_request: Request, { params }: Params) {
  const { workPackageId, linkId } = await params;
  return withContext(async (context) => {
    await unlinkRecord(context, "work_package", workPackageId, linkId);
    return apiOk({ data: { removed: true } });
  });
}

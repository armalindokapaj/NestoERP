import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { voidInductionSchema } from "@/lib/modules/hse/hse.schema";
import { voidInduction } from "@/lib/modules/hse/hse.workforce";

type Params = { params: Promise<{ inductionId: string }> };

/** POST /api/hse/inductions/:inductionId/void — recorded in error; it stays, marked void (E-04 §71). */
export async function POST(request: Request, { params }: Params) {
  const { inductionId } = await params;
  return withContext(async (context) => {
    const { reason } = voidInductionSchema.parse(await readJson(request));
    await voidInduction(context, inductionId, reason);
    return apiOk({ data: { voided: true } });
  });
}

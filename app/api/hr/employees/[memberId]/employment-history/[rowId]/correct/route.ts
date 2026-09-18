import { readJson, withContext } from "@/lib/api/respond";
import { correctEmploymentHistory } from "@/lib/modules/hr/employment/employment.correction.service";
import { correctionSchema } from "@/lib/modules/hr/employment/employment.schema";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";

type Params = { params: Promise<{ memberId: string; rowId: string }> };

/**
 * POST /api/hr/employees/:memberId/employment-history/:rowId/correct — corrects
 * one history row, with a reason (E-03 §42-§44, §76). `kind` says whether the
 * row is an assignment or a status. The original stays, superseded.
 */
export async function POST(request: Request, { params }: Params) {
  const { memberId, rowId } = await params;
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = correctionSchema.parse({ ...body, rowId });
    await correctEmploymentHistory(context, memberId, input, { placement: placeMembership });
    return new Response(null, { status: 204 });
  });
}

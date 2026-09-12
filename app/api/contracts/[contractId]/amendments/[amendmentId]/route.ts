import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ amendmentId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { amendmentId } = await params;
    return apiOk({ data: await amendments.getAmendment(context, amendmentId) });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { amendmentId } = await params;
    const input = amendmentSchema.parse(await readJson(request));
    return apiOk({ data: await amendments.updateAmendment(context, amendmentId, input) });
  });
}

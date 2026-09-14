import { apiOk, withContext } from "@/lib/api/respond";
import { linkOptions } from "@/lib/modules/engineering/engineering.links";
import { linkSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ workPackageId: string }> };

/** GET — records of one type this writer could link (PRD #46 §305). */
export async function GET(request: Request, { params }: Params) {
  const { workPackageId } = await params;
  return withContext(async (context) => {
    const type = linkSchema.shape.type.parse(new URL(request.url).searchParams.get("type"));
    return apiOk({ data: await linkOptions(context, "work_package", workPackageId, type) });
  });
}

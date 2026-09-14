import { apiOk, withContext } from "@/lib/api/respond";
import { revisionFileOptions } from "@/lib/modules/engineering/engineering.documents";

type Params = { params: Promise<{ submittalId: string }> };

/** GET — files on the submittal that could become its next revision (PRD #46 §125). */
export async function GET(_request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await revisionFileOptions(context, "technical_submittal", submittalId) });
  });
}

import { apiOk, withContext } from "@/lib/api/respond";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";

type Params = { params: Promise<{ parentType: string; parentId: string }> };

/** People who could be mentioned here: this company, active, able to open the record (PRD #38 §31). */
export async function GET(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { parentType, parentId } = await params;
    const q = new URL(request.url).searchParams.get("q") ?? undefined;
    return apiOk({ data: await collaboration.listMentionableMembers(context, parentType, parentId, q) });
  });
}

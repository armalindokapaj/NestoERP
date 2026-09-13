import { apiOk, withContext } from "@/lib/api/respond";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";

type Params = { params: Promise<{ parentType: string; parentId: string }> };

/** Start watching a record's discussion. Watching never grants access (PRD #38 §32, §37). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { parentType, parentId } = await params;
    return apiOk({ data: await collaboration.setWatching(context, parentType, parentId, true) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { parentType, parentId } = await params;
    return apiOk({ data: await collaboration.setWatching(context, parentType, parentId, false) });
  });
}

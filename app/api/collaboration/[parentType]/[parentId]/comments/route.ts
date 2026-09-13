import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createCommentSchema, threadQuerySchema } from "@/lib/core/collaboration/collaboration.schema";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { AccessError } from "@/lib/access/guards";

type Params = { params: Promise<{ parentType: string; parentId: string }> };

/**
 * A record's discussion (PRD #38 §37).
 *
 * The parent is authorised on every request through the record registry; an
 * unknown type, another company's record and an unreadable one are all 404.
 */
export async function GET(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { parentType, parentId } = await params;
    const search = new URL(request.url).searchParams;
    const query = threadQuerySchema.parse({
      before: search.get("before") ?? undefined,
      limit: search.get("limit") ?? undefined,
    });
    return apiOk({ data: await collaboration.getThread(context, parentType, parentId, query) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { parentType, parentId } = await params;
    if (!checkRateLimit("WRITE", context.membershipId).allowed) {
      throw new AccessError("CONFLICT", "RATE_LIMITED");
    }
    const input = createCommentSchema.parse(await readJson(request));
    return apiOk({ data: await collaboration.createComment(context, parentType, parentId, input) }, { status: 201 });
  });
}

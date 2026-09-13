import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { editCommentSchema } from "@/lib/core/collaboration/collaboration.schema";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";

type Params = { params: Promise<{ commentId: string }> };

/** Edit your own comment (PRD #38 §34, §37). */
export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { commentId } = await params;
    const { body } = editCommentSchema.parse(await readJson(request));
    return apiOk({ data: await collaboration.editComment(context, commentId, body) });
  });
}

/** Deleting a comment archives it (PRD #38 §34, §37). */
export async function DELETE(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { commentId } = await params;
    await collaboration.archiveComment(context, commentId);
    return new Response(null, { status: 204 });
  });
}

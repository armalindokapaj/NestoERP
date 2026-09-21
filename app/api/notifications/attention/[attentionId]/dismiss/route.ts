import { withContext } from "@/lib/api/respond";
import { dismissAttentionForWorkspace } from "@/lib/core/notifications/attention.service";

type Params = { params: Promise<{ attentionId: string }> };

/**
 * POST /api/notifications/attention/:id/dismiss (PRD #25 §78, §79).
 *
 * Only items the condition marks dismissible can be dismissed: an attention
 * item exists because something is true, and hiding it does not make it false.
 * The service decides which those are.
 *
 * Group workspace: `any`. It is the person's own light write with no company to
 * get wrong: the item is found among their own attention in the companies they
 * may use and dismissed by that company's own rules (Workspace Context §45).
 */
export async function POST(_request: Request, { params }: Params) {
  const { attentionId } = await params;
  return withContext(
    async (context) => {
      await dismissAttentionForWorkspace(context, attentionId);
      return new Response(null, { status: 204 });
    },
    { group: "any" },
  );
}

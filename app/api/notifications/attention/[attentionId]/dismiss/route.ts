import { withContext } from "@/lib/api/respond";
import { dismissAttention } from "@/lib/core/notifications/attention.service";

type Params = { params: Promise<{ attentionId: string }> };

/**
 * POST /api/notifications/attention/:id/dismiss (PRD #25 §78, §79).
 *
 * Only items the condition marks dismissible can be dismissed: an attention
 * item exists because something is true, and hiding it does not make it false.
 * The service decides which those are.
 */
export async function POST(_request: Request, { params }: Params) {
  const { attentionId } = await params;
  return withContext(async (context) => {
    await dismissAttention(context, attentionId);
    return new Response(null, { status: 204 });
  });
}

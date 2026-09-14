import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { approveInputSchema, parseIdempotencyKey, reasonInputSchema } from "./approvals.schema";
import { decideApproval } from "./approvals.service";
import type { ApprovalDecision } from "./approvals.types";

/**
 * The three decision endpoints share one handler (PRD #41 §116-§118, §123,
 * §241): the command is in the path, never a status in the body, and an
 * `Idempotency-Key` header makes a retry replay the first answer.
 */
export function decisionHandler(decision: ApprovalDecision) {
  return async function POST(request: Request, { params }: { params: Promise<{ providerKey: string; approvalId: string }> }) {
    const { providerKey, approvalId } = await params;
    return withContext(async (context) => {
      if (!checkRateLimit("WRITE", context.membershipId).allowed) {
        return apiError("VALIDATION_ERROR", "Too many decisions at once. Try again shortly.");
      }
      const body = await readJson(request).catch(() => ({}));
      const input = decision === "APPROVE" ? approveInputSchema.parse(body) : reasonInputSchema.parse(body);
      const result = await decideApproval(context, providerKey, approvalId, decision, input, {
        idempotencyKey: parseIdempotencyKey(request.headers.get("idempotency-key")),
      });
      return apiOk({ data: result });
    });
  };
}

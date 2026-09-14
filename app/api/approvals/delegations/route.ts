import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createDelegation, listDelegations } from "@/lib/modules/approvals/approvals.delegation";
import { createDelegationSchema } from "@/lib/modules/approvals/approvals.schema";

/** GET /api/approvals/delegations — delegations I gave and received (PRD #41 §35). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listDelegations(context) }));
}

/** POST /api/approvals/delegations — lend my approvals for a while (PRD #41 §32-§34). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) {
      return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    }
    const input = createDelegationSchema.parse(await readJson(request));
    return apiOk({ data: await createDelegation(context, input) }, { status: 201 });
  });
}

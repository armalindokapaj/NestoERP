import { apiOk, withContext } from "@/lib/api/respond";
import { revokeDelegation } from "@/lib/modules/approvals/approvals.delegation";

type Params = { params: Promise<{ delegationId: string }> };

/** DELETE /api/approvals/delegations/:delegationId — end a delegation now (PRD #41 §169). */
export async function DELETE(_request: Request, { params }: Params) {
  const { delegationId } = await params;
  return withContext(async (context) => apiOk({ data: await revokeDelegation(context, delegationId) }));
}

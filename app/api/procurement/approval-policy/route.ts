import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { approvalPolicySchema, getApprovalPolicy, updateApprovalPolicy } from "@/lib/modules/procurement/approvals/approval.policy";

/** GET /api/procurement/approval-policy — when a purchase order needs Finance and executive decisions (PRD #41 §27, §159). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getApprovalPolicy(context) }));
}

/** PUT /api/procurement/approval-policy — Procurement's own limits, audited (PRD #41 §158). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    const input = approvalPolicySchema.parse(await readJson(request));
    return apiOk({ data: await updateApprovalPolicy(context, input) });
  });
}

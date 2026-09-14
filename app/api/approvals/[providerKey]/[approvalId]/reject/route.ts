import { decisionHandler } from "@/lib/modules/approvals/approvals.routes";

/** POST /api/approvals/:providerKey/:approvalId/reject — a reason is required (PRD #41 §117, §206). */
export const POST = decisionHandler("REJECT");

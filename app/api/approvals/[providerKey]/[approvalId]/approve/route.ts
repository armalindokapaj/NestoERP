import { decisionHandler } from "@/lib/modules/approvals/approvals.routes";

/** POST /api/approvals/:providerKey/:approvalId/approve — optional note (PRD #41 §116). */
export const POST = decisionHandler("APPROVE");

import { decisionHandler } from "@/lib/modules/approvals/approvals.routes";

/** POST /api/approvals/:providerKey/:approvalId/return — only where the source returns for revision; a reason is required (PRD #41 §118, §207). */
export const POST = decisionHandler("RETURN");

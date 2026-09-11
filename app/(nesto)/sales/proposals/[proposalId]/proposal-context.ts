import { notFound } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import type { ProposalDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Resolves the proposal every page under `/sales/proposals/[id]` needs.
 *
 * Out of scope answers 404 rather than 403: the response must not confirm that
 * a price exists to somebody who may not see it (PRD #17 §226).
 */
export async function proposalContext(
  proposalId: string,
): Promise<{ context: UserContext; proposal: ProposalDetailDTO }> {
  const context = await requireModule("sales");

  try {
    return { context, proposal: await proposals.getProposal(context, proposalId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

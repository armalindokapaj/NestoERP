import { notFound } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import type { OpportunityDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Resolves the opportunity every page under `/sales/opportunities/[id]` needs.
 *
 * Out of scope answers 404 rather than 403, so the page itself cannot confirm
 * that a deal exists to somebody who may not open it (PRD #17 §226).
 */
export async function opportunityContext(
  opportunityId: string,
): Promise<{ context: UserContext; opportunity: OpportunityDetailDTO }> {
  const context = await requireModule("sales");

  try {
    return {
      context,
      opportunity: await opportunities.getOpportunity(context, opportunityId),
    };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

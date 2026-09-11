import { notFound } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import type { LeadDetailDTO } from "@/lib/modules/sales/sales.types";

/**
 * Resolves the lead every page under `/sales/leads/[leadId]` needs.
 *
 * A lead outside the reader's scope answers 404 rather than 403, so the page
 * itself cannot confirm that a record exists to somebody who may not open it
 * (PRD #17 §226).
 */
export async function leadContext(
  leadId: string,
): Promise<{ context: UserContext; lead: LeadDetailDTO }> {
  const context = await requireModule("sales");

  try {
    return { context, lead: await leads.getLead(context, leadId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

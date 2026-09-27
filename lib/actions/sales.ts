"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionFailure } from "@/lib/actions/result";
import { invalidInput, readSubmittedLines, scalarFormValues } from "@/lib/modules/finance/finance.form-data";
import { approvalGuardFrom, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import { committed } from "@/lib/forms/committed";
import { requireCompanyContext } from "@/lib/context/current-user";
import { DuplicateLeadError } from "@/lib/modules/sales/leads/lead.service";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import {
  assignLeadSchema,
  convertLeadSchema,
  createLeadSchema,
  disqualifyLeadSchema,
  updateLeadSchema,
} from "@/lib/modules/sales/leads/lead.schema";
import {
  assignOpportunitySchema,
  createOpportunitySchema,
  linkProjectSchema,
  opportunityLostSchema,
  opportunityStageSchema,
  opportunityWonSchema,
  updateOpportunitySchema,
} from "@/lib/modules/sales/opportunities/opportunity.schema";
import {
  createProposalSchema,
  proposalRejectionSchema,
  updateProposalSchema,
} from "@/lib/modules/sales/proposals/proposal.schema";
import type { LeadDuplicateMatch } from "@/lib/modules/sales/sales.types";

/**
 * Server actions for the Sales module (PRD #17 §188, §190).
 *
 * A thin shell over the same services the API routes call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

export type SalesActionResult =
  | { ok: true; id?: string; message?: string; redirectTo?: string }
  /** `code`: the refusal's stable code, e.g. APPROVAL_SOURCE_CHANGED (AUD-10 §4). */
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]>; duplicates?: LeadDuplicateMatch[] };

function revalidateSales(recordPath?: string) {
  revalidatePath("/sales", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

function toResult(error: unknown): SalesActionResult {
  // A duplicate is a question for a person, not a failure: the form re-renders
  // with the matches and an "add anyway" button (PRD #17 §44).
  if (error instanceof DuplicateLeadError) {
    return { ok: false, error: error.message, duplicates: error.matches };
  }
  return actionFailure(error, "sales");
}

/**
 * Invalid input under canonical paths (AUD-09 §3, §7, FV-16): a proposal
 * line's error is `lineItems.<index>.<field>`, the index being the row's
 * submitted position.
 */
function invalid(error: z.ZodError, submitted: number[] | null = null): SalesActionResult {
  return invalidInput(error, submitted ? { lineItems: submitted } : {});
}

function formValues(formData: FormData): Record<string, unknown> {
  return scalarFormValues(formData);
}

const LINE_FIELDS = ["description", "quantity", "unitPrice", "taxRate"];

/**
 * Reads the repeating line fields a proposal form posts (PRD #17 §214).
 *
 * Named `lineItems.0.description` (or the older `lineItems[0].description`) —
 * the same convention Finance uses, because it is the same editor. A row
 * somebody cleared out is dropped, and every kept row remembers the index it
 * was submitted as.
 */
function lineItems(formData: FormData): { lines: Record<string, string>[]; submitted: number[] } {
  return readSubmittedLines(formData, "lineItems", LINE_FIELDS);
}

/* -------------------------------------------------------------------------- */
/* Leads                                                                       */
/* -------------------------------------------------------------------------- */

export async function createLeadAction(formData: FormData): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const values = formValues(formData);
  const parsed = createLeadSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const lead = await leads.createLead(context, parsed.data, {
      acceptDuplicate: values.acceptDuplicate === "on" || values.acceptDuplicate === "true",
    });
    id = lead.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateSales();
  return committed(`/sales/leads/${id}`);
}

export async function updateLeadAction(
  leadId: string,
  formData: FormData,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateLeadSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await leads.updateLead(context, leadId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/leads/${leadId}`);
  return committed(`/sales/leads/${leadId}`);
}

export type LeadLifecycleAction =
  | "contacted"
  | "qualify"
  | "archive"
  | "restore";

export async function leadLifecycleAction(
  leadId: string,
  action: LeadLifecycleAction,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "contacted") await leads.markLeadContacted(context, leadId);
    else if (action === "qualify") await leads.qualifyLead(context, leadId);
    else if (action === "archive") await leads.archiveLead(context, leadId);
    else await leads.restoreLead(context, leadId);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/leads/${leadId}`);
  return { ok: true };
}

export async function disqualifyLeadAction(
  leadId: string,
  reason: string,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = disqualifyLeadSchema.safeParse({ reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await leads.disqualifyLead(context, leadId, parsed.data.reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/leads/${leadId}`);
  return { ok: true };
}

export async function assignLeadAction(
  leadId: string,
  ownerMemberId: string,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = assignLeadSchema.safeParse({ ownerMemberId });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await leads.assignLead(context, leadId, parsed.data.ownerMemberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/leads/${leadId}`);
  return { ok: true };
}

export async function convertLeadAction(
  leadId: string,
  formData: FormData,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = convertLeadSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let opportunityId: string;
  try {
    const result = await leads.convertLead(context, leadId, parsed.data);
    opportunityId = result.opportunityId;
  } catch (error) {
    return toResult(error);
  }

  // The conversion may have created a client and it changed the lead, so both
  // modules' pages are stale (PRD #17 §250).
  revalidatePath("/clients", "layout");
  revalidateSales(`/sales/leads/${leadId}`);
  return committed(`/sales/opportunities/${opportunityId}`);
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

export async function createOpportunityAction(formData: FormData): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = createOpportunitySchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await opportunities.createOpportunity(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateSales();
  return committed(`/sales/opportunities/${id}`);
}

export async function updateOpportunityAction(
  opportunityId: string,
  formData: FormData,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateOpportunitySchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await opportunities.updateOpportunity(context, opportunityId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return committed(`/sales/opportunities/${opportunityId}`);
}

export async function changeStageAction(
  opportunityId: string,
  stage: string,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = opportunityStageSchema.safeParse({ stage });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await opportunities.changeStage(context, opportunityId, parsed.data.stage);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function assignOpportunityAction(
  opportunityId: string,
  ownerMemberId: string,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = assignOpportunitySchema.safeParse({ ownerMemberId });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await opportunities.assignOpportunity(context, opportunityId, parsed.data.ownerMemberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function markWonAction(
  opportunityId: string,
  formData: FormData,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = opportunityWonSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await opportunities.markWon(context, opportunityId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  // A win may have created a client and a project (PRD #17 §251).
  revalidatePath("/clients", "layout");
  revalidatePath("/projects", "layout");
  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return committed(`/sales/opportunities/${opportunityId}`);
}

export async function markLostAction(
  opportunityId: string,
  formData: FormData,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = opportunityLostSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    await opportunities.markLost(context, opportunityId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return committed(`/sales/opportunities/${opportunityId}`);
}

export type OpportunityLifecycleAction = "reopen" | "archive" | "restore";

export async function opportunityLifecycleAction(
  opportunityId: string,
  action: OpportunityLifecycleAction,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "reopen") await opportunities.reopenOpportunity(context, opportunityId);
    else if (action === "archive") await opportunities.archiveOpportunity(context, opportunityId);
    else await opportunities.restoreOpportunity(context, opportunityId);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function linkProjectAction(
  opportunityId: string,
  projectId: string,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = linkProjectSchema.safeParse({ projectId });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await opportunities.linkProject(context, opportunityId, parsed.data.projectId);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/opportunities/${opportunityId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

export async function createProposalAction(formData: FormData): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const rows = lineItems(formData);
  const parsed = createProposalSchema.safeParse({ ...formValues(formData), lineItems: rows.lines });
  if (!parsed.success) return invalid(parsed.error, rows.submitted);

  let id: string;
  try {
    id = (await proposals.createProposal(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateSales();
  return committed(`/sales/proposals/${id}`);
}

export async function updateProposalAction(
  proposalId: string,
  formData: FormData,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const rows = lineItems(formData);
  const parsed = updateProposalSchema.safeParse({ ...formValues(formData), lineItems: rows.lines });
  if (!parsed.success) return invalid(parsed.error, rows.submitted);

  try {
    await proposals.updateProposal(context, proposalId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/proposals/${proposalId}`);
  return committed(`/sales/proposals/${proposalId}`);
}

export type ProposalLifecycleAction =
  | "submit"
  | "approve"
  | "mark-sent"
  | "accept"
  | "decline"
  | "cancel"
  | "archive"
  | "restore";

/**
 * `cycle` is the approval cycle the page displayed: approving and rejecting
 * name it, and the service refuses a missing or replaced one inside its
 * transaction (AUD-10 §4, CW-02, CW-05). Other steps ignore it.
 */
export async function proposalLifecycleAction(
  proposalId: string,
  action: ProposalLifecycleAction,
  note?: string,
  cycle?: PendingCycle | null,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await proposals.submitProposal(context, proposalId);
    else if (action === "approve") await proposals.approveProposal(context, proposalId, note ?? null, approvalGuardFrom(cycle));
    else if (action === "mark-sent") await proposals.markProposalSent(context, proposalId);
    else if (action === "accept") await proposals.acceptProposal(context, proposalId);
    else if (action === "decline") await proposals.declineProposal(context, proposalId, note ?? null);
    else if (action === "cancel") await proposals.cancelProposal(context, proposalId);
    else if (action === "archive") await proposals.archiveProposal(context, proposalId);
    else await proposals.restoreProposal(context, proposalId);
  } catch (error) {
    return toResult(error);
  }

  // Accepting a proposal may move its opportunity, so both are stale (§252).
  revalidateSales(`/sales/proposals/${proposalId}`);
  return { ok: true };
}

export async function rejectProposalAction(
  proposalId: string,
  reason: string,
  cycle?: PendingCycle | null,
): Promise<SalesActionResult> {
  const context = await requireCompanyContext();

  const parsed = proposalRejectionSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await proposals.rejectProposal(context, proposalId, parsed.data.note, approvalGuardFrom(cycle));
  } catch (error) {
    return toResult(error);
  }

  revalidateSales(`/sales/proposals/${proposalId}`);
  return { ok: true };
}

/** The duplicate check the lead form runs before it offers to save (§44). */
const duplicateInputSchema = z.object({
  name: z.string().optional(),
  companyName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  excludeLeadId: z.string().optional(),
});

export async function checkLeadDuplicatesAction(
  input: z.infer<typeof duplicateInputSchema>,
): Promise<LeadDuplicateMatch[]> {
  const context = await requireCompanyContext();
  const parsed = duplicateInputSchema.safeParse(input);
  if (!parsed.success) return [];

  try {
    return await leads.checkLeadDuplicates(context, parsed.data);
  } catch {
    // A failed courtesy check must never block the form.
    return [];
  }
}

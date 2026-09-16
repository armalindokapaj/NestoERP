import type { ApprovalStepStatus, Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { Permission } from "@/config/permissions";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { delegationsTo, type ActiveDelegation } from "./approval-delegations";

/**
 * Sequential approval chains (PRD #41 §20-§26, §160-§162).
 *
 * A module that decides a record needs more than one decision writes the
 * steps when the cycle opens; this is the shared bookkeeping for them. The
 * module still owns everything that matters — when a chain applies, which
 * steps it has, what the final approval does — and calls these helpers inside
 * its own transaction.
 *
 * Three rules hold for every chain:
 *
 *   - only the current step can be decided; later steps are never actionable
 *   - the requester decides no step, unless the module's policy says so
 *   - nobody decides two steps of the same cycle, in person or on somebody's
 *     behalf: a chain of three signatures from one person is one signature
 */

type Client = Prisma.TransactionClient | typeof prisma;

export type StepPlan = {
  label: string;
  approverPermission?: Permission;
  approverRoleKey?: string;
  approverMemberId?: string;
};

export const STEP_SELECT = {
  id: true,
  stepNumber: true,
  label: true,
  approverMemberId: true,
  approverRoleKey: true,
  approverPermission: true,
  status: true,
  decidedByMemberId: true,
  onBehalfOfMemberId: true,
  decidedAt: true,
  decisionNote: true,
} as const satisfies Prisma.ApprovalStepSelect;

export type StepRow = Prisma.ApprovalStepGetPayload<{ select: typeof STEP_SELECT }>;

export async function createApprovalSteps(
  tx: Prisma.TransactionClient,
  input: { companyId: string; providerKey: string; approvalId: string; steps: StepPlan[] },
): Promise<void> {
  if (input.steps.length === 0) return;
  await tx.approvalStep.createMany({
    data: input.steps.map((step, index) => ({
      companyId: input.companyId,
      providerKey: input.providerKey,
      approvalId: input.approvalId,
      stepNumber: index + 1,
      label: step.label,
      approverPermission: step.approverPermission ?? null,
      approverRoleKey: step.approverRoleKey ?? null,
      approverMemberId: step.approverMemberId ?? null,
    })),
  });
}

export async function loadApprovalSteps(providerKey: string, approvalId: string, client: Client = prisma): Promise<StepRow[]> {
  return client.approvalStep.findMany({ where: { providerKey, approvalId }, orderBy: { stepNumber: "asc" }, select: STEP_SELECT });
}

/** Steps for many cycles at once, keyed by approval id. */
export async function loadApprovalStepsFor(providerKey: string, approvalIds: string[], client: Client = prisma): Promise<Map<string, StepRow[]>> {
  const map = new Map<string, StepRow[]>();
  if (approvalIds.length === 0) return map;
  const rows = await client.approvalStep.findMany({
    where: { providerKey, approvalId: { in: approvalIds } },
    orderBy: [{ approvalId: "asc" }, { stepNumber: "asc" }],
    select: { ...STEP_SELECT, approvalId: true },
  });
  for (const row of rows) {
    const list = map.get(row.approvalId) ?? [];
    list.push(row);
    map.set(row.approvalId, list);
  }
  return map;
}

/** The step that can be decided now: the first one still pending. */
export function currentStepOf(steps: StepRow[]): StepRow | null {
  return steps.find((step) => step.status === "PENDING") ?? null;
}

/** Members who already decided a step of this cycle, in person or by proxy. */
function priorDeciders(steps: StepRow[]): Set<string> {
  const people = new Set<string>();
  for (const step of steps) {
    if (step.decidedByMemberId) people.add(step.decidedByMemberId);
    if (step.onBehalfOfMemberId) people.add(step.onBehalfOfMemberId);
  }
  return people;
}

export type StepEligibility =
  | { eligible: true; onBehalfOfMemberId: string | null }
  | { eligible: false; reason: "SELF_APPROVAL" | "ALREADY_DECIDED_STEP" | "RESERVED_FOR_LATER_STEP" | "NOT_APPROVER" };

/**
 * Whether this person may decide this step now, and on whose behalf.
 *
 * `canReadAs` answers whether a given member could read the record. It is
 * asked of the delegator too: a delegation lends the delegator's authority,
 * so it can never reach a record the delegator could not decide (PRD #41 §33).
 */
export async function stepEligibility(
  context: UserContext,
  step: StepRow,
  options: {
    providerKey: string;
    steps: StepRow[];
    submittedByMemberId: string;
    allowSelf?: boolean;
    canReadAs?: (memberContext: UserContext) => Promise<boolean>;
    now?: Date;
    /** Delegations already loaded for this person, when checking many steps at once. */
    delegations?: ActiveDelegation[];
  },
): Promise<StepEligibility> {
  const me = context.membershipId;
  if (me === options.submittedByMemberId && !options.allowSelf) return { eligible: false, reason: "SELF_APPROVAL" };
  const prior = priorDeciders(options.steps.filter((row) => row.stepNumber !== step.stepNumber));
  if (prior.has(me)) return { eligible: false, reason: "ALREADY_DECIDED_STEP" };
  // A later step that belongs to this person — by name or by role — is theirs to
  // take, so an earlier one goes to somebody else; otherwise the only CEO could
  // approve step one and leave the executive step with nobody able to decide it.
  const reservedLater = options.steps.some(
    (row) =>
      row.stepNumber > step.stepNumber &&
      row.status === "PENDING" &&
      (row.approverMemberId === me || (row.approverRoleKey !== null && row.approverRoleKey === context.role)),
  );
  if (reservedLater) return { eligible: false, reason: "RESERVED_FOR_LATER_STEP" };

  // A step may name a permission, a person or a role — or a person or role who
  // must also hold the permission (a timesheet's designated approver, PRD #42 §74).
  const permitted = !step.approverPermission || can(context, step.approverPermission as Permission);
  if (!step.approverMemberId && !step.approverRoleKey) {
    return permitted ? { eligible: true, onBehalfOfMemberId: null } : { eligible: false, reason: "NOT_APPROVER" };
  }
  if (!permitted) return { eligible: false, reason: "NOT_APPROVER" };

  if (step.approverMemberId === me) return { eligible: true, onBehalfOfMemberId: null };
  if (step.approverRoleKey && context.role === step.approverRoleKey) return { eligible: true, onBehalfOfMemberId: null };

  // Standing in for somebody the step belongs to.
  const lent = options.delegations ?? (await delegationsTo(context.companyId, me, options.providerKey, { now: options.now }));
  if (lent.length === 0) return { eligible: false, reason: "NOT_APPROVER" };
  const lenders = await prisma.companyMember.findMany({
    where: { companyId: context.companyId, id: { in: lent.map((row) => row.fromMemberId) }, status: "ACTIVE" },
    select: { id: true, role: { select: { key: true } } },
  });
  const candidates = lenders.filter(
    (lender) =>
      lender.id !== options.submittedByMemberId &&
      !prior.has(lender.id) &&
      (step.approverMemberId ? lender.id === step.approverMemberId : lender.role.key === step.approverRoleKey),
  );
  if (candidates.length === 0) return { eligible: false, reason: "NOT_APPROVER" };
  if (!options.canReadAs) return { eligible: true, onBehalfOfMemberId: candidates[0].id };
  const contexts = await buildMemberContexts(context.companyId, candidates.map((row) => row.id));
  for (const candidate of candidates) {
    const lenderContext = contexts.get(candidate.id);
    if (lenderContext && (await options.canReadAs(lenderContext))) return { eligible: true, onBehalfOfMemberId: candidate.id };
  }
  return { eligible: false, reason: "NOT_APPROVER" };
}

/**
 * Who could decide this step, for telling them and for refusing a chain
 * nobody can finish (PRD #41 §161). Delegates are not listed: they are told
 * through the delegator's assignments when they open the queue.
 */
export async function eligibleMembersForStep(
  companyId: string,
  step: Pick<StepRow, "approverMemberId" | "approverRoleKey" | "approverPermission">,
  options: { exclude: string[]; canReadAs: (memberContext: UserContext) => Promise<boolean>; limit?: number },
): Promise<string[]> {
  const where: Prisma.CompanyMemberWhereInput = {
    companyId,
    status: "ACTIVE",
    user: { status: "ACTIVE" },
    id: { notIn: options.exclude },
    ...(step.approverMemberId ? { id: step.approverMemberId } : {}),
    ...(step.approverRoleKey && !step.approverMemberId ? { role: { key: step.approverRoleKey } } : {}),
  };
  if (step.approverMemberId && options.exclude.includes(step.approverMemberId)) return [];
  const members = await prisma.companyMember.findMany({ where, select: { id: true }, take: 500 });
  const contexts = await buildMemberContexts(companyId, members.map((row) => row.id));
  const eligible: string[] = [];
  for (const [memberId, memberContext] of contexts) {
    if (step.approverPermission && !can(memberContext, step.approverPermission as Permission)) continue;
    if (!(await options.canReadAs(memberContext))) continue;
    eligible.push(memberId);
    if (options.limit && eligible.length >= options.limit) break;
  }
  return eligible;
}

/**
 * Records a step decision. Conditional on the step still pending, so two
 * approvers of the same step pressing at once settle it once (PRD #41 §125).
 */
export async function settleStep(
  tx: Prisma.TransactionClient,
  context: UserContext,
  step: StepRow,
  status: Extract<ApprovalStepStatus, "APPROVED" | "REJECTED" | "RETURNED">,
  note: string | null,
  onBehalfOfMemberId: string | null,
): Promise<void> {
  const result = await tx.approvalStep.updateMany({
    where: { id: step.id, status: "PENDING" },
    data: { status, decidedByMemberId: context.membershipId, onBehalfOfMemberId, decidedAt: new Date(), decisionNote: note },
  });
  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This step has already been decided.", { code: "APPROVAL_ALREADY_DECIDED" });
  }
}

/** Steps nobody will reach once the cycle has ended early. */
export async function closeOpenSteps(
  tx: Prisma.TransactionClient,
  providerKey: string,
  approvalId: string,
  status: Extract<ApprovalStepStatus, "CANCELLED" | "SKIPPED"> = "CANCELLED",
): Promise<void> {
  await tx.approvalStep.updateMany({ where: { providerKey, approvalId, status: "PENDING" }, data: { status } });
}

/**
 * Points the open steps of one cycle at a different approver (PRD #48 §212).
 *
 * The source module decides who decides — a timesheet follows its member to
 * whoever approves for them now. The routing row is the approvals platform's,
 * so it is moved from here, in the caller's transaction (PRD #48 §86, §106).
 * Only pending steps move: a decision already taken stays attributed to
 * whoever took it.
 */
export async function reassignOpenSteps(
  tx: Prisma.TransactionClient,
  providerKey: string,
  approvalId: string,
  approverMemberId: string,
): Promise<number> {
  const { count } = await tx.approvalStep.updateMany({
    where: { providerKey, approvalId, status: "PENDING" },
    data: { approverMemberId },
  });
  return count;
}

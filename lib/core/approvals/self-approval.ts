import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { eligibleMembersForStep, reservedForLaterStep, type StepRow } from "@/lib/core/approvals/approval-steps";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import type { RecordType } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";

/**
 * Deciding your own request (2026-11).
 *
 * Every approval refuses the person who asked for it: somebody else checks the
 * invoice, the price, the contract. That stays the rule for everybody. The one
 * exception is the CEO, and anybody holding CEO access: they run the company
 * end to end, and in a small company there may be nobody else who could decide
 * what they asked for. So they may decide their own request, but only when no
 * other active member of the company could decide it, and when they do it is
 * written down: an activity line on the record and an audit event, both saying
 * it was self-approved because nobody else could.
 *
 * "Could decide it" is the same question the module asks of the person
 * deciding: an active member with a login (not suspended, not the requester,
 * not anybody else the module bars from it) who holds the grant to decide and
 * whose scope reaches the record. With one CEO and one CEO-access holder, each
 * is somebody else who can decide for the other, so the other one must.
 *
 * A module's own `*.approval.self` grant (held by the Owner) is a different,
 * older thing: it lets its holder decide their own without conditions, and is
 * left as it is.
 */

/** Whether this person holds the CEO's rights here: the CEO role, or CEO access on top of their own role. */
export function holdsCeoRights(context: Pick<UserContext, "role" | "ceoAccess">): boolean {
  return context.role === "CEO" || context.ceoAccess === true;
}

export type DeciderTest = {
  /** The record being decided: somebody else counts only if their scope reaches it. */
  record: { type: RecordType; id: string };
  /** Whether a member's grants let them decide it: the same test the module puts to the person deciding. */
  mayDecide(member: UserContext): boolean;
  /** Further reach the module asks for, beyond reading the record (a project's manager, a designated approver). */
  reaches?(member: UserContext): Promise<boolean> | boolean;
  /** Members the module bars from deciding it besides the person deciding: who carried out the inspection, who requested the permit. */
  barred?: ReadonlyArray<string | null | undefined>;
};

export type OtherDecider = { memberId: string; name: string };

/**
 * The other members of this company, as contexts, built once per request for
 * the person asking. Contexts are per request and per person, so a WeakMap
 * keeps nothing beyond the request.
 */
const colleagues = new WeakMap<UserContext, Promise<UserContext[]>>();

function colleaguesOf(context: UserContext): Promise<UserContext[]> {
  let cached = colleagues.get(context);
  if (!cached) {
    cached = (async () => {
      const members = await prisma.companyMember.findMany({
        where: { companyId: context.companyId, status: "ACTIVE", user: { status: "ACTIVE" }, id: { not: context.membershipId } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 1000,
      });
      // Only an active member of an active company with an active login gets a context.
      const contexts = await buildMemberContexts(context.companyId, members.map((member) => member.id));
      return members.map((member) => contexts.get(member.id)).filter((member): member is UserContext => Boolean(member));
    })();
    colleagues.set(context, cached);
  }
  return cached;
}

/** Up to `limit` other members who could decide this, by name. */
export async function otherDeciders(context: UserContext, test: DeciderTest, limit = 3): Promise<OtherDecider[]> {
  const barred = new Set([context.membershipId, ...(test.barred ?? [])].filter((id): id is string => Boolean(id)));
  const { canReadRecord } = await import("@/lib/core/records/record.registry");
  const found: OtherDecider[] = [];
  for (const member of await colleaguesOf(context)) {
    if (barred.has(member.membershipId)) continue;
    if (!test.mayDecide(member)) continue;
    if (!(await canReadRecord(member, test.record.type, test.record.id))) continue;
    if (test.reaches && !(await test.reaches(member))) continue;
    found.push({ memberId: member.membershipId, name: member.fullName });
    if (found.length >= limit) break;
  }
  return found;
}

export type OwnDecision =
  /** Not their own: the ordinary rules apply. */
  | { own: false }
  /** Their own, and allowed: by the module's own self grant, or because nobody else could decide it. */
  | { own: true; allowed: true; because: "SELF_GRANT" | "NOBODY_ELSE" }
  /** Their own, and refused. `others` names who could decide it, when the rule looked. */
  | { own: true; allowed: false; others: OtherDecider[] };

/**
 * How the rule answers for this person and this record, without refusing or
 * recording anything: what a page asks before it offers Approve.
 */
export async function ownDecision(
  context: UserContext,
  input: { own: boolean; selfPermission?: Permission | null } & DeciderTest,
): Promise<OwnDecision> {
  if (!input.own) return { own: false };
  if (input.selfPermission && can(context, input.selfPermission)) return { own: true, allowed: true, because: "SELF_GRANT" };
  // Everybody else keeps the old rule, and nobody is asked about them.
  if (!holdsCeoRights(context)) return { own: true, allowed: false, others: [] };
  const others = await otherDeciders(context, input);
  return others.length === 0 ? { own: true, allowed: true, because: "NOBODY_ELSE" } : { own: true, allowed: false, others };
}

/** Whether this person may decide this record as far as the self rule goes: the boolean a capability flag needs. */
export async function mayDecideOwn(context: UserContext, input: { own: boolean; selfPermission?: Permission | null } & DeciderTest): Promise<boolean> {
  if (!input.own) return true;
  const decision = await ownDecision(context, input);
  return decision.own && decision.allowed;
}

/**
 * The same rule for one step of a chain (PRD #41 §21): somebody else counts if
 * the step could go to them — the step's person, role or permission, a reader
 * of the record, not anybody who decided an earlier step of it, and not anybody
 * a later pending step is kept for. The last is `stepEligibility`'s own rule:
 * the only CEO, who takes the Executive step, may not take the Procurement
 * step before it, so counting them here would leave that step to nobody.
 */
export async function ownStepDecision(
  context: UserContext,
  input: {
    submittedByMemberId: string;
    selfPermission?: Permission | null;
    step: StepRow;
    steps: StepRow[];
    canReadAs?: (member: UserContext) => Promise<boolean>;
  },
): Promise<OwnDecision> {
  if (input.submittedByMemberId !== context.membershipId) return { own: false };
  if (input.selfPermission && can(context, input.selfPermission)) return { own: true, allowed: true, because: "SELF_GRANT" };
  if (!holdsCeoRights(context)) return { own: true, allowed: false, others: [] };
  const prior = input.steps
    .filter((row) => row.stepNumber !== input.step.stepNumber)
    .flatMap((row) => [row.decidedByMemberId, row.onBehalfOfMemberId])
    .filter((id): id is string => Boolean(id));
  const ids = await eligibleMembersForStep(context.companyId, input.step, {
    exclude: [context.membershipId, ...prior],
    canReadAs: input.canReadAs ?? (async () => true),
    skip: (member) => reservedForLaterStep(member, input.step, input.steps),
    limit: 3,
  });
  if (ids.length === 0) return { own: true, allowed: true, because: "NOBODY_ELSE" };
  const members = await prisma.companyMember.findMany({
    where: { companyId: context.companyId, id: { in: ids } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return { own: true, allowed: false, others: members.map((member) => ({ memberId: member.id, name: `${member.user.firstName} ${member.user.lastName}` })) };
}

/** "Ana Hoxha, Besnik Dema": who could decide it, as a refusal names them. */
export function deciderNames(others: readonly OtherDecider[]): string {
  return others.map((other) => other.name).join(", ");
}

/** The refusal a CEO gets when somebody else could decide it: the module's own words do not name anybody. */
export function namedRefusal(others: readonly OtherDecider[]): AccessError {
  return new AccessError(
    "FORBIDDEN",
    `You asked for this, so somebody else has to decide it. ${deciderNames(others)} can.`,
    { code: "SELF_APPROVAL", approvers: others.map((other) => other.name) },
  );
}

export type OwnDecisionCheck = { own: boolean; selfPermission?: Permission | null } & DeciderTest & {
  /** The module's own refusal, as it was before this rule. */
  refusal(): Error;
  /** The transaction the decision is written in: a self-approval is recorded in it, or not at all. */
  tx: Prisma.TransactionClient;
  /** What the record is called in the audit log; the record type's noun when absent. */
  label?: string;
  projectId?: string | null;
  /** What was decided, for the record. */
  decision?: string;
};

/**
 * The one check every approval makes of the person deciding: refuses their own
 * request unless the rule allows it, and records it when it was allowed because
 * nobody else could decide it.
 */
export async function assertOwnDecisionAllowed(context: UserContext, input: OwnDecisionCheck): Promise<OwnDecision> {
  const decision = await ownDecision(context, input);
  if (!decision.own) return decision;
  if (!decision.allowed) throw decision.others.length > 0 ? namedRefusal(decision.others) : input.refusal();
  if (decision.because === "NOBODY_ELSE") await recordSelfApproval(input.tx, context, input);
  return decision;
}

/**
 * The record of a self-approval: one activity line on the record, where its
 * history is read, and one audit event, both saying nobody else could decide it.
 */
export async function recordSelfApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: { record: { type: RecordType; id: string }; label?: string; projectId?: string | null; decision?: string },
): Promise<void> {
  const { recordDefinition } = await import("@/lib/core/records/record.registry");
  const definition = recordDefinition(input.record.type);
  const entityType = definition?.activityEntityType ?? input.record.type;
  const projectId = input.projectId ?? null;
  await recordActivity(tx, context, {
    module: definition?.moduleKey ?? "approvals",
    entityType,
    entityId: input.record.id,
    action: "APPROVAL_SELF_APPROVED",
    message: "decided their own request, as nobody else in the company could",
    metadata: { selfApproved: true, reason: "NO_OTHER_APPROVER", recordType: input.record.type, ...(input.decision ? { decision: input.decision } : {}), ...(projectId ? { projectId } : {}) },
  });
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.APPROVAL_SELF_APPROVED,
      entity: { type: entityType, id: input.record.id, label: input.label ?? definition?.noun ?? input.record.type },
      ...(projectId ? { projectId } : {}),
      after: { selfApproved: true, reason: "NO_OTHER_APPROVER", recordType: input.record.type, decision: input.decision ?? null },
      metadata: { selfApproved: true, reason: "NO_OTHER_APPROVER", recordType: input.record.type, decision: input.decision ?? null },
    },
    { tx },
  );
}

import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { approvalError, memberNames, personOrUnknown } from "./approvals.provider";
import { approvalProviders } from "./approvals.registry";
import type { CreateDelegationInput } from "./approvals.schema";
import type { ApprovalDelegationDTO, ApprovalProviderKey } from "./approvals.types";

/**
 * Approval delegation (PRD #41 §32-§35, §169-§173, §245, §270).
 *
 * Lending your approvals for a while — a holiday, a site visit — without
 * changing anybody's role. The rules, each enforced here:
 *
 *   - same company, both people active, never to yourself
 *   - bounded in time, at most 90 days
 *   - scoped to one source, or every source you decide
 *   - the delegate must already open that source: a delegation lends the
 *     authority to decide what is assigned to you, never module access
 *   - one hop: nobody delegates to a person who is away themselves, and no
 *     pair can lend to each other over the same days
 *   - one live delegation per source at a time
 *
 * What it lends is what is *assigned* to the delegator: a document review
 * addressed to them, a chain step that belongs to their role. Approvals that
 * belong to a permission are already open to anyone holding it.
 */

const DAY = 86_400_000;
const MAX_DAYS = 90;

function assertCenter(context: UserContext): void {
  assertModule(context, "approvals");
  assertPermission(context, "approvals.view");
}

function providerLabel(key: string | null): string {
  if (!key) return "All approvals";
  return approvalProviders.all().find((provider) => provider.key === key)?.label ?? key;
}

const SELECT = {
  id: true,
  fromMemberId: true,
  toMemberId: true,
  providerKey: true,
  startsAt: true,
  endsAt: true,
  reason: true,
  active: true,
  revokedAt: true,
  createdByMemberId: true,
} satisfies Prisma.ApprovalDelegationSelect;

type Row = Prisma.ApprovalDelegationGetPayload<{ select: typeof SELECT }>;

function stateOf(row: Row, now: Date): ApprovalDelegationDTO["state"] {
  if (row.revokedAt || !row.active) return "REVOKED";
  if (row.endsAt <= now) return "ENDED";
  if (row.startsAt > now) return "UPCOMING";
  return "ACTIVE";
}

async function toDTOs(context: UserContext, rows: Row[], now = new Date()): Promise<ApprovalDelegationDTO[]> {
  const names = await memberNames(context.companyId, rows.flatMap((row) => [row.fromMemberId, row.toMemberId]));
  return rows.map((row) => {
    const state = stateOf(row, now);
    return {
      id: row.id,
      from: personOrUnknown(names, row.fromMemberId),
      to: personOrUnknown(names, row.toMemberId),
      providerKey: row.providerKey as ApprovalProviderKey | null,
      providerLabel: providerLabel(row.providerKey),
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      reason: row.reason,
      state,
      canRevoke: (state === "ACTIVE" || state === "UPCOMING") && (row.fromMemberId === context.membershipId || row.createdByMemberId === context.membershipId),
    };
  });
}

export async function listDelegations(context: UserContext): Promise<{ given: ApprovalDelegationDTO[]; received: ApprovalDelegationDTO[]; canManage: boolean }> {
  assertCenter(context);
  const since = new Date(Date.now() - 30 * DAY);
  const rows = await prisma.approvalDelegation.findMany({
    where: {
      companyId: context.companyId,
      OR: [{ fromMemberId: context.membershipId }, { toMemberId: context.membershipId }],
      endsAt: { gt: since },
    },
    orderBy: [{ startsAt: "desc" }],
    take: 50,
    select: SELECT,
  });
  const dtos = await toDTOs(context, rows);
  return {
    given: dtos.filter((row) => row.from.memberId === context.membershipId),
    received: dtos.filter((row) => row.to.memberId === context.membershipId),
    canManage: can(context, "approvals.delegation.manage"),
  };
}

/** People who could stand in for this person on the chosen source (§34). */
export async function delegateOptions(context: UserContext, input: { q?: string; providerKey?: ApprovalProviderKey | null }) {
  assertCenter(context);
  assertPermission(context, "approvals.delegation.manage");
  const term = input.q?.trim().slice(0, 80);
  const candidates = await prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      id: { not: context.membershipId },
      user: {
        status: "ACTIVE",
        ...(term ? { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }] } : {}),
      },
    },
    orderBy: [{ user: { firstName: "asc" } }],
    take: 60,
    select: { id: true, jobTitle: true, user: { select: { firstName: true, lastName: true } } },
  });
  const contexts = await buildMemberContexts(context.companyId, candidates.map((row) => row.id));
  const provider = input.providerKey ? approvalProviders.getProvider(input.providerKey) : null;
  return candidates
    .filter((row) => {
      const candidate = contexts.get(row.id);
      return Boolean(candidate && can(candidate, "approvals.view") && (!provider || provider.available(candidate)));
    })
    .slice(0, 20)
    .map((row) => ({ memberId: row.id, fullName: `${row.user.firstName} ${row.user.lastName}`, jobTitle: row.jobTitle }));
}

function overlapping(startsAt: Date, endsAt: Date): Prisma.ApprovalDelegationWhereInput {
  return { active: true, revokedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } };
}

/** Same source, or either side covering every source. */
function sameScope(providerKey: string | null): Prisma.ApprovalDelegationWhereInput {
  return providerKey ? { OR: [{ providerKey: null }, { providerKey }] } : {};
}

export async function createDelegation(context: UserContext, input: CreateDelegationInput): Promise<ApprovalDelegationDTO> {
  assertCenter(context);
  assertPermission(context, "approvals.delegation.manage");

  if (input.toMemberId === context.membershipId) throw approvalError("DELEGATE_SELF", "Choose somebody other than yourself.", "VALIDATION_ERROR");

  const startsAt = new Date(`${input.startsOn}T00:00:00.000Z`);
  const endsAt = new Date(new Date(`${input.endsOn}T00:00:00.000Z`).getTime() + DAY);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  if (startsAt < today) throw approvalError("DELEGATION_IN_PAST", "A delegation cannot start in the past.", "VALIDATION_ERROR");
  if (endsAt.getTime() - startsAt.getTime() > MAX_DAYS * DAY) {
    throw approvalError("DELEGATION_TOO_LONG", `A delegation lasts at most ${MAX_DAYS} days.`, "VALIDATION_ERROR");
  }

  // Same company, active, and already able to open what is lent (§33, §34, §245).
  const delegate = (await buildMemberContexts(context.companyId, [input.toMemberId])).get(input.toMemberId);
  if (!delegate) throw approvalError("DELEGATE_NOT_ALLOWED", "That person cannot receive delegated approvals.", "VALIDATION_ERROR");
  const provider = input.providerKey ? approvalProviders.getProvider(input.providerKey) : null;
  if (!can(delegate, "approvals.view") || (provider && !provider.available(delegate))) {
    throw approvalError(
      "DELEGATE_NO_ACCESS",
      provider ? `${delegate.fullName} cannot open ${provider.label}, so they cannot decide its approvals.` : `${delegate.fullName} cannot use the Approvals Center.`,
      "VALIDATION_ERROR",
    );
  }
  if (provider && !provider.available(context)) {
    throw approvalError("DELEGATOR_NO_ACCESS", `You do not decide ${provider.label} approvals, so there is nothing to lend.`, "VALIDATION_ERROR");
  }

  const window = overlapping(startsAt, endsAt);
  const [circular, delegateAway, duplicate] = await Promise.all([
    prisma.approvalDelegation.count({ where: { companyId: context.companyId, fromMemberId: input.toMemberId, toMemberId: context.membershipId, ...window } }),
    prisma.approvalDelegation.count({ where: { companyId: context.companyId, fromMemberId: input.toMemberId, ...window } }),
    prisma.approvalDelegation.count({ where: { companyId: context.companyId, fromMemberId: context.membershipId, ...window, ...sameScope(input.providerKey) } }),
  ]);
  if (circular > 0) throw approvalError("DELEGATION_CIRCULAR", `${delegate.fullName} has delegated their approvals to you over those days.`);
  if (delegateAway > 0) throw approvalError("DELEGATE_AWAY", `${delegate.fullName} has delegated their own approvals over those days, so they cannot take yours.`);
  if (duplicate > 0) throw approvalError("DELEGATION_OVERLAP", "You already have a delegation covering those days for these approvals.");

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.approvalDelegation.create({
      data: {
        companyId: context.companyId,
        fromMemberId: context.membershipId,
        toMemberId: input.toMemberId,
        providerKey: input.providerKey,
        startsAt,
        endsAt,
        reason: input.reason,
        createdByMemberId: context.membershipId,
      },
      select: SELECT,
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.APPROVAL_DELEGATION_CREATED,
        entity: { type: "approval_delegation", id: created.id, label: `Delegation to ${delegate.fullName}` },
        after: {
          fromMemberId: context.membershipId,
          toMemberId: input.toMemberId,
          providerKey: input.providerKey,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          hasReason: Boolean(input.reason),
        },
      },
      { tx },
    );
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.APPROVAL_DELEGATED,
      moduleKey: "approvals",
      entityType: "approval_delegation",
      entityId: created.id,
      actorMemberId: context.membershipId,
      payload: {
        fromMemberId: context.membershipId,
        toMemberId: input.toMemberId,
        fromName: context.fullName,
        toName: delegate.fullName,
        window: `${providerLabel(input.providerKey)}, ${input.startsOn} to ${input.endsOn}`,
      },
    });
    return created;
  });

  return (await toDTOs(context, [row]))[0];
}

export async function revokeDelegation(context: UserContext, delegationId: string): Promise<ApprovalDelegationDTO> {
  assertCenter(context);
  const row = await prisma.approvalDelegation.findFirst({ where: { id: delegationId, companyId: context.companyId }, select: SELECT });
  if (!row || (row.fromMemberId !== context.membershipId && row.createdByMemberId !== context.membershipId)) {
    throw new AccessError("NOT_FOUND");
  }
  const now = new Date();
  if (row.revokedAt || !row.active || row.endsAt <= now) throw approvalError("DELEGATION_ENDED", "This delegation has already ended.");

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.approvalDelegation.updateMany({
      where: { id: row.id, active: true, revokedAt: null },
      data: { active: false, revokedAt: now, revokedByMemberId: context.membershipId },
    });
    if (result.count === 0) throw approvalError("DELEGATION_ENDED", "This delegation has already ended.");
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.APPROVAL_DELEGATION_REVOKED,
        entity: { type: "approval_delegation", id: row.id },
        after: { fromMemberId: row.fromMemberId, toMemberId: row.toMemberId, providerKey: row.providerKey, revokedAt: now.toISOString() },
      },
      { tx },
    );
    return tx.approvalDelegation.findUniqueOrThrow({ where: { id: row.id }, select: SELECT });
  });
  return (await toDTOs(context, [updated]))[0];
}

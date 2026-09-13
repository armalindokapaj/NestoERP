import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { businessDateString, toBusinessDate } from "../hr.date";
import { buildEmployeeScopeWhere } from "../hr.scope";
import type { CreateCompensationInput } from "../hr.schema";
import type { CompensationDTO } from "../hr.types";

/**
 * Compensation (PRD #16 §58–§68).
 *
 * The most confidential thing HR holds, and the rules reflect that:
 *
 *   - `hr.compensation.view` is never implied by employee access, and never
 *     implied by it being your own pay (PRD #16 §17, §67).
 *   - Pay is effective-dated, not overwritten. A raise closes the current
 *     record and opens a new one in the same transaction, so what somebody was
 *     paid last year survives (PRD #16 §65, §189).
 *   - The amount never reaches the activity trail. "Their pay changed" is the
 *     auditable fact; the number is in the record, behind the permission
 *     (PRD #16 §269, §270).
 */

const MODULE = "hr" as const;
const ENTITY = "Compensation";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listCompensation(
  context: UserContext,
  memberId: string,
): Promise<CompensationDTO[]> {
  assertModule(context, MODULE);
  // No self-service exception: seeing your own salary is a company decision,
  // not something the module assumes (PRD #16 §67).
  assertPermission(context, "hr.compensation.view");

  const profile = await requireProfile(context, memberId);

  const rows = await prisma.compensation.findMany({
    where: { employeeProfileId: profile.id },
    orderBy: [{ effectiveFrom: "desc" }],
    select: {
      id: true,
      currency: true,
      payType: true,
      baseAmount: true,
      effectiveFrom: true,
      effectiveTo: true,
      notes: true,
      createdAt: true,
      createdByMemberId: true,
    },
  });

  const recorders = await prisma.companyMember.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.createdByMemberId))] } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  const nameById = new Map(
    recorders.map((member) => [
      member.id,
      `${member.user.firstName} ${member.user.lastName}`,
    ]),
  );

  return rows.map((row) => ({
    id: row.id,
    currency: row.currency,
    payType: row.payType,
    baseAmount: toAmountString(row.baseAmount),
    effectiveFrom: businessDateString(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? businessDateString(row.effectiveTo) : null,
    // The open record is the current one: exactly one exists per employee, and
    // a partial unique index guarantees it (PRD #16 §189).
    isCurrent: row.effectiveTo === null,
    notes: row.notes,
    recordedBy: nameById.get(row.createdByMemberId) ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** The open record alone, for the compensation report. */
export async function currentCompensation(context: UserContext, profileIds: string[]) {
  if (profileIds.length === 0 || !can(context, "hr.compensation.view")) return new Map();

  const rows = await prisma.compensation.findMany({
    where: { employeeProfileId: { in: profileIds }, effectiveTo: null },
    select: {
      employeeProfileId: true,
      currency: true,
      payType: true,
      baseAmount: true,
      effectiveFrom: true,
    },
  });

  return new Map(rows.map((row) => [row.employeeProfileId, row]));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Records a new pay level (PRD #16 §65).
 *
 * The current record is closed the day before the new one starts, in the same
 * transaction. Doing it in two steps would leave a moment where an employee had
 * two open salaries — or none.
 */
export async function recordCompensation(
  context: UserContext,
  memberId: string,
  input: CreateCompensationInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.compensation.update");

  const profile = await requireProfile(context, memberId);
  const effectiveFrom = toBusinessDate(input.effectiveFrom);

  await prisma.$transaction(async (tx) => {
    const current = await tx.compensation.findFirst({
      where: { employeeProfileId: profile.id, effectiveTo: null },
      select: { id: true, effectiveFrom: true },
    });

    if (current) {
      if (effectiveFrom.getTime() <= current.effectiveFrom.getTime()) {
        throw new AccessError(
          "VALIDATION_ERROR",
          `The current pay record starts on ${businessDateString(current.effectiveFrom)}. A new one has to start after that.`,
        );
      }

      // Closed the day before the new record opens, so the two periods meet
      // without overlapping (PRD #16 §189).
      const closesOn = new Date(effectiveFrom);
      closesOn.setUTCDate(closesOn.getUTCDate() - 1);

      await tx.compensation.update({
        where: { id: current.id },
        data: { effectiveTo: closesOn, updatedByMemberId: context.membershipId },
      });
    }

    await tx.compensation.create({
      data: {
        companyId: context.companyId,
        employeeProfileId: profile.id,
        currency: input.currency,
        payType: input.payType,
        baseAmount: input.baseAmount,
        effectiveFrom,
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: memberId,
      action: "HR_COMPENSATION_RECORDED",
      // Deliberately no amount and no currency: the trail records that pay
      // changed and who changed it, not what anybody earns (PRD #16 §270).
      message: "recorded a new compensation record",
      metadata: {
        memberId,
        effectiveFrom: businessDateString(effectiveFrom),
        payType: input.payType,
      } as Prisma.InputJsonValue,
    });

    /*
     * The audit policy for this action lists `amount` in redactFields, so the
     * writer stores the fact that pay changed and the effective date while
     * dropping the figure itself (PRD #28 §124, PRD #16 §270).
     */
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.HR_COMPENSATION_CHANGED,
        entity: { type: ENTITY, id: memberId },
        after: {
          amount: String(input.baseAmount),
          currency: input.currency,
          effectiveFrom: businessDateString(effectiveFrom),
        },
      },
      { tx },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireProfile(context: UserContext, memberId: string) {
  // Read through the HR scope, so an employee this reader cannot see has no
  // compensation to read either (PRD #16 §203).
  return assertFound(
    await prisma.employeeProfile.findFirst({
      where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: memberId }] },
      select: { id: true, companyMemberId: true },
    }),
  );
}

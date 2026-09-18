import type { Prisma } from "@prisma/client";

import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { dbDay, type Day } from "@/lib/modules/hr/employment/employment.dates";
import { auditEmployment, type HistoryActor } from "@/lib/modules/hr/employment/employment.history";

/**
 * The workforce's door for an employment that ends (E-04 §105, §110-§112;
 * ADR 0006). HR owns the employment and decides when it ends — a termination,
 * a plan withdrawn, a transfer to another company of the group — and is handed
 * this door to call inside the same transaction, the way it is handed the
 * organization's placement door. HR only imports its type, so neither domain
 * depends on the other.
 *
 * Crew memberships and project assignments running past the last day end on
 * it; those that would only have started after it never happened and are
 * withdrawn. Nothing earlier is touched: the history of who worked where stays
 * whole (§105: preserve attendance, work logs, HSE history).
 */
export type WorkforceEndDoor = (
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    employmentId: string;
    /** The last day worked here, inclusive. */
    lastDay: Day;
    reason: "TERMINATION" | "LEGAL_ENTITY_TRANSFER";
    actor: HistoryActor;
  },
) => Promise<void>;

const REASON_TEXT = { TERMINATION: "Employment ended", LEGAL_ENTITY_TRANSFER: "Transferred to another company" } as const;

export const endWorkforce: WorkforceEndDoor = async (tx, input) => {
  const last = dbDay(input.lastDay);
  const owned = { employeeProfileId: input.employmentId, companyId: input.companyId };
  const running = { ...owned, startDate: { lte: last }, OR: [{ endDate: null }, { endDate: { gt: last } }] };
  const later = { ...owned, startDate: { gt: last } };
  const endedByUserId = input.actor.kind === "member" ? input.actor.context.userId : input.actor.onBehalfOfUserId;
  const ending = { endDate: last, endReason: REASON_TEXT[input.reason], endedByUserId };

  const [crewWithdrawn, assignmentsWithdrawn] = await Promise.all([tx.workforceCrewMember.deleteMany({ where: later }), tx.employeeProjectAssignment.deleteMany({ where: later })]);
  const [crewEnded, assignmentsEnded] = await Promise.all([tx.workforceCrewMember.updateMany({ where: running, data: ending }), tx.employeeProjectAssignment.updateMany({ where: running, data: ending })]);

  if (crewWithdrawn.count + assignmentsWithdrawn.count + crewEnded.count + assignmentsEnded.count === 0) return;
  await auditEmployment(tx, input.actor, input.companyId, {
    actionKey: AuditAction.WORKFORCE_ENDED_WITH_EMPLOYMENT,
    entity: { type: "EmployeeProfile", id: input.employmentId, label: "Employment" },
    after: {
      employeeProfileId: input.employmentId,
      lastDay: input.lastDay,
      reason: input.reason,
      crewMembershipsEnded: crewEnded.count,
      crewMembershipsWithdrawn: crewWithdrawn.count,
      projectAssignmentsEnded: assignmentsEnded.count,
      projectAssignmentsWithdrawn: assignmentsWithdrawn.count,
    },
  });
};

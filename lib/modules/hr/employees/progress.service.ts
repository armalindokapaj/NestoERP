import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { businessDateString } from "../hr.calendar";
import { buildEmployeeScopeWhere } from "../hr.scope";
import { Prisma, type EmploymentStatus, type HrProgressStatus } from "@prisma/client";

import { runInTransaction } from "@/lib/core/transactions/transaction";

/**
 * Onboarding and offboarding readiness (PRD #16 §116–§125).
 *
 * V0.1 tracks a status per employment record, not a checklist: the tasks
 * themselves are canonical Task records, so HR never grows a second task engine
 * (PRD #16 §118, §125).
 */
export type ProgressKind = "onboarding" | "offboarding";

export type ProgressRow = {
  employeeId: string;
  fullName: string;
  department: string | null;
  manager: string | null;
  managerMemberId: string | null;
  /** The start date when onboarding, the end date when offboarding. */
  date: string | null;
  employmentStatus: EmploymentStatus;
  progress: HrProgressStatus;
};

/** Employment states each list is about (PRD #16 §120, §124). */
const RELEVANT_EMPLOYMENT: Record<ProgressKind, EmploymentStatus[]> = {
  onboarding: ["PLANNED", "ACTIVE"],
  offboarding: ["ACTIVE", "ON_LEAVE", "SUSPENDED", "ENDED"],
};

/** How many open records one worklist shows; the page says so when there are more (AUD-08 §4). */
export const PROGRESS_SHOWN = 100;

export async function listProgress(
  context: UserContext,
  kind: ProgressKind,
): Promise<ProgressRow[] & { total: number }> {
  assertModule(context, "hr");
  assertPermission(context, kind === "onboarding" ? "hr.onboarding.view" : "hr.offboarding.view");

  const field = kind === "onboarding" ? "onboardingStatus" : "offboardingStatus";

  const where: Prisma.EmployeeProfileWhereInput = {
    AND: [
      buildEmployeeScopeWhere(context),
      // Open work only: completed and not-required are done with.
      { [field]: { in: ["NOT_STARTED", "IN_PROGRESS"] } },
      { employmentStatus: { in: RELEVANT_EMPLOYMENT[kind] } },
    ],
  };

  /*
   * The count and the rows from one snapshot, soonest first, the undated last
   * and the id breaking ties (AUD-08 §4, DT-04, DT-06). A worklist longer than
   * PROGRESS_SHOWN keeps its cap but reports its total, so the page says "the
   * first N of M" instead of passing a cut list off as all of it.
   */
  const { records, total } = await runInTransaction(
    `hr.${kind}.list`,
    async (tx) => ({
      total: await tx.employeeProfile.count({ where }),
      records: await tx.employeeProfile.findMany({
        where,
        orderBy: [kind === "onboarding" ? { startDate: { sort: "asc", nulls: "last" } } : { endDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: PROGRESS_SHOWN,
        select: {
          id: true,
          startDate: true,
          endDate: true,
          employmentStatus: true,
          onboardingStatus: true,
          offboardingStatus: true,
          personProfile: { select: { firstName: true, lastName: true } },
          department: { select: { name: true } },
          managerMember: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 },
  );

  const rows = records.map((record) => {
    const date = kind === "onboarding" ? record.startDate : record.endDate;

    return {
      employeeId: record.id,
      fullName: `${record.personProfile.firstName} ${record.personProfile.lastName}`,
      department: record.department?.name ?? null,
      manager: record.managerMember
        ? `${record.managerMember.user.firstName} ${record.managerMember.user.lastName}`
        : null,
      managerMemberId: record.managerMember?.id ?? null,
      date: date ? businessDateString(date) : null,
      employmentStatus: record.employmentStatus,
      progress: kind === "onboarding" ? record.onboardingStatus : record.offboardingStatus,
    };
  });
  return Object.assign(rows, { total });
}

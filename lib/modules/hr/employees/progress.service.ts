import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { businessDateString } from "../hr.calendar";
import { memberAddressed } from "../hr.person";
import { buildEmployeeScopeWhere } from "../hr.scope";
import type { EmploymentStatus, HrProgressStatus } from "@prisma/client";

/**
 * Onboarding and offboarding readiness (PRD #16 §116–§125).
 *
 * V0.1 tracks a status per employment record, not a checklist: the tasks
 * themselves are canonical Task records, so HR never grows a second task engine
 * (PRD #16 §118, §125).
 */
export type ProgressKind = "onboarding" | "offboarding";

export type ProgressRow = {
  memberId: string;
  fullName: string;
  department: string | null;
  manager: string | null;
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

export async function listProgress(
  context: UserContext,
  kind: ProgressKind,
): Promise<ProgressRow[]> {
  assertModule(context, "hr");
  assertPermission(context, kind === "onboarding" ? "hr.onboarding.view" : "hr.offboarding.view");

  const field = kind === "onboarding" ? "onboardingStatus" : "offboardingStatus";

  const records = await prisma.employeeProfile.findMany({
    where: {
      AND: [
        buildEmployeeScopeWhere(context),
        // Open work only: completed and not-required are done with.
        { [field]: { in: ["NOT_STARTED", "IN_PROGRESS"] } },
        { employmentStatus: { in: RELEVANT_EMPLOYMENT[kind] } },
      ],
    },
    orderBy: kind === "onboarding" ? [{ startDate: "asc" }] : [{ endDate: "asc" }],
    take: 100,
    select: {
      companyMemberId: true,
      startDate: true,
      endDate: true,
      employmentStatus: true,
      onboardingStatus: true,
      offboardingStatus: true,
      companyMember: {
        select: {
          user: { select: { firstName: true, lastName: true } },
          department: { select: { name: true } },
        },
      },
      managerMember: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });

  return records.map(memberAddressed).map((record) => {
    const date = kind === "onboarding" ? record.startDate : record.endDate;

    return {
      memberId: record.companyMemberId,
      fullName: `${record.companyMember.user.firstName} ${record.companyMember.user.lastName}`,
      department: record.companyMember.department?.name ?? null,
      manager: record.managerMember
        ? `${record.managerMember.user.firstName} ${record.managerMember.user.lastName}`
        : null,
      date: date ? businessDateString(date) : null,
      employmentStatus: record.employmentStatus,
      progress: kind === "onboarding" ? record.onboardingStatus : record.offboardingStatus,
    };
  });
}

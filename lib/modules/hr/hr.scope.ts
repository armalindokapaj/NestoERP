import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";

/**
 * HR scope (PRD #16 §164–§168).
 *
 * Three scopes, and one deliberate refusal:
 *
 *   SELF        their own employment record and nothing else
 *   DEPARTMENT  their department, plus themselves
 *   COMPANY     everyone
 *   PROJECT     treated as SELF
 *
 * PROJECT is folded into SELF on purpose (PRD #16 §168). A project manager
 * needs to know who is on their project — that is Team's job — and turning
 * that into access to those people's employment records, leave and attendance
 * would make HR confidentiality a side effect of project membership.
 */

export type HrScopeKind = "SELF" | "DEPARTMENT" | "COMPANY";

export function hrScopeKind(context: UserContext): HrScopeKind {
  const scope = getModuleScope(context, "hr");
  if (scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  return "SELF";
}

export function hasCompanyHrScope(context: UserContext): boolean {
  return hrScopeKind(context) === "COMPANY";
}

/** The memberships this reader may see an employment record for. */
export function buildHrMemberScopeWhere(context: UserContext): Prisma.CompanyMemberWhereInput {
  const kind = hrScopeKind(context);
  const base: Prisma.CompanyMemberWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [{ id: context.membershipId }, { departmentId: context.department.id }],
    };
  }

  return { ...base, id: context.membershipId };
}

export function buildEmployeeScopeWhere(
  context: UserContext,
): Prisma.EmployeeProfileWhereInput {
  const kind = hrScopeKind(context);
  // HR screens address employment by membership, so a record still waiting
  // for its login is not one of them (E-06 §25); see `memberAddressed`.
  const base: Prisma.EmployeeProfileWhereInput = {
    companyId: context.companyId,
    companyMemberId: { not: null },
  };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { companyMemberId: context.membershipId },
        { companyMember: { departmentId: context.department.id } },
      ],
    };
  }

  return { ...base, companyMemberId: context.membershipId };
}

export function buildLeaveScopeWhere(context: UserContext): Prisma.LeaveRequestWhereInput {
  const kind = hrScopeKind(context);
  const base: Prisma.LeaveRequestWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { companyMemberId: context.membershipId },
        { employeeProfile: { companyMember: { departmentId: context.department.id } } },
      ],
    };
  }

  return { ...base, companyMemberId: context.membershipId };
}

export function buildAttendanceScopeWhere(
  context: UserContext,
): Prisma.AttendanceRecordWhereInput {
  const kind = hrScopeKind(context);
  const base: Prisma.AttendanceRecordWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { companyMemberId: context.membershipId },
        { employeeProfile: { companyMember: { departmentId: context.department.id } } },
      ],
    };
  }

  return { ...base, companyMemberId: context.membershipId };
}

/**
 * Whether this record is the reader's own.
 *
 * Self-service turns on this and nothing else: a person may file their own
 * leave and see their own employment record while holding no HR permission
 * over anybody (PRD #16 §16, §74).
 */
export function isSelf(context: UserContext, companyMemberId: string): boolean {
  return companyMemberId === context.membershipId;
}

/**
 * May this reader see a record at all — through an HR grant, or because it is
 * theirs?
 */
export function canReadOwn(
  context: UserContext,
  companyMemberId: string,
  selfPermission: Parameters<typeof can>[1],
): boolean {
  return isSelf(context, companyMemberId) && can(context, selfPermission);
}

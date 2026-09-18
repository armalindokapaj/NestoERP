import { can, canAccessModule } from "@/lib/access/can";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { EmploymentViewDTO } from "@/lib/modules/people/people.types";
import { hrScopeKind } from "../hr.scope";

/**
 * A person's employments, as HR lets this reader see them (E-01 §98, §106,
 * §111; ADR 0002 decision 4).
 *
 * The people profile has an Employment tab, and it must not be a second door to
 * HR records with rules of its own. So each employment is judged in its own
 * company, by the reader's membership there, with HR's own rules: the HR
 * module on, `hr.employee.view` within HR's scope (company, department or
 * self), or the employee's own `hr.self.employment`. A company the reader does
 * not work in shows nothing, whatever their session holds. Records without a
 * login count, as HR's company-wide readers see them.
 *
 * Pay is never here: the compensation page is linked, and checks again.
 */
export async function employmentsVisibleTo(session: UserContext, personProfileId: string): Promise<EmploymentViewDTO[]> {
  const employments = await prisma.employeeProfile.findMany({
    where: { personProfileId, company: { parentGroupId: session.parentGroupId } },
    select: {
      id: true,
      companyId: true,
      companyMemberId: true,
      employeeNumber: true,
      employmentStatus: true,
      employmentType: true,
      startDate: true,
      probationEndDate: true,
      endDate: true,
      workLocation: true,
      workLocationType: true,
      jobTitle: true,
      department: { select: { name: true } },
      company: { select: { id: true, name: true, legalName: true, registrationNumber: true } },
      companyMember: { select: { departmentId: true } },
      managerMember: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });

  const contexts = new Map<string, UserContext | null>();
  const visible: EmploymentViewDTO[] = [];
  for (const employment of employments) {
    if (!contexts.has(employment.companyId)) contexts.set(employment.companyId, await contextInCompany(session, employment.companyId));
    const context = contexts.get(employment.companyId);
    if (!context || !canAccessModule(context, "hr")) continue;

    const own = employment.companyMemberId !== null && employment.companyMemberId === context.membershipId;
    const kind = hrScopeKind(context);
    const inScope =
      kind === "COMPANY" ||
      own ||
      (kind === "DEPARTMENT" && context.department !== null && employment.companyMember?.departmentId === context.department.id);
    const allowed = (can(context, "hr.employee.view") && inScope) || (own && can(context, "hr.self.employment"));
    if (!allowed) continue;

    // HR's own pages are addressed by membership, in the session's company.
    const hrHref = employment.companyMemberId && employment.companyId === session.companyId ? `/hr/employees/${employment.companyMemberId}` : null;
    visible.push({
      id: employment.id,
      company: employment.company,
      employeeNumber: employment.employeeNumber,
      status: employment.employmentStatus,
      type: employment.employmentType,
      startDate: employment.startDate?.toISOString() ?? null,
      probationEndDate: employment.probationEndDate?.toISOString() ?? null,
      endDate: employment.endDate?.toISOString() ?? null,
      workLocation: [employment.workLocationType ? employment.workLocationType.charAt(0) + employment.workLocationType.slice(1).toLowerCase() : null, employment.workLocation].filter(Boolean).join(", ") || null,
      department: employment.department?.name ?? null,
      jobTitle: employment.jobTitle,
      manager: employment.managerMember ? `${employment.managerMember.user.firstName} ${employment.managerMember.user.lastName}` : null,
      hrHref,
      // Pay is HR's alone, its own permission included: self-service does not reach it (PRD #16 §17).
      compensationHref: hrHref && can(context, "hr.compensation.view") ? `${hrHref}/compensation` : null,
    });
  }
  return visible;
}

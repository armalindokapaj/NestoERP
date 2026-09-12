import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Who can see which safety records (PRD #22 §244–§248).
 *
 * Four doors, widest first:
 *
 *   COMPANY   the safety function, which must see every incident in the company
 *             or it cannot run safety at all,
 *   PROJECT   site people, who see the safety on the jobs they are on,
 *   ASSIGNED  whoever was actually given the inspection or the action — an
 *             inspector must reach their own work even when it sits on a
 *             project they are not a member of (PRD #22 §247),
 *   SELF      what somebody reported themselves (PRD #22 §248).
 *
 * SELF matters more here than in other modules. Reporting a hazard is the most
 * widely granted act in HSE, and somebody who reports one must be able to see
 * what became of it — a report that vanishes from its reporter's view is a
 * report nobody makes twice.
 */

export type HseScopeKind = "SELF" | "ASSIGNED" | "PROJECT" | "DEPARTMENT" | "COMPANY";

export function hseScopeKind(context: UserContext): HseScopeKind {
  const scope = getModuleScope(context, "hse");
  if (scope === "COMPANY" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  if (scope === "PROJECT") return "PROJECT";
  if (scope === "ASSIGNED") return "ASSIGNED";
  return "SELF";
}

export function hasCompanyHseScope(context: UserContext): boolean {
  const kind = hseScopeKind(context);
  return kind === "COMPANY" || kind === "DEPARTMENT";
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A template is company reference data, not a record about a job (PRD #22 §42).
 *
 * Anybody who may see templates sees all of them: a checklist is what the
 * company inspects against, and hiding half of them would let two sites inspect
 * the same scaffold to different standards.
 */
export function buildTemplateScopeWhere(
  context: UserContext,
): Prisma.HseInspectionTemplateWhereInput {
  return { companyId: context.companyId };
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export function buildInspectionScopeWhere(
  context: UserContext,
): Prisma.HseInspectionWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedInspectorMemberId: context.membershipId },
      { executedByMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export function buildHazardScopeWhere(context: UserContext): Prisma.HseHazardWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedToMemberId: context.membershipId },
      // Whoever raised it follows it to its close (PRD #22 §248).
      { reportedByMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export function buildIncidentScopeWhere(context: UserContext): Prisma.HseIncidentWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { reportedByMemberId: context.membershipId },
      { investigatorMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

export function buildRiskAssessmentScopeWhere(
  context: UserContext,
): Prisma.HseRiskAssessmentWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { ownerMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export function buildActionScopeWhere(context: UserContext): Prisma.HseActionWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedToMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

export function buildToolboxScopeWhere(context: UserContext): Prisma.ToolboxTalkWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { conductedByMemberId: context.membershipId },
      { participants: { some: { companyMemberId: context.membershipId } } },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

/** A permit always names a project, so project scope is the whole story (§146). */
export function buildPermitScopeWhere(context: UserContext): Prisma.HseWorkPermitWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { requestedByMemberId: context.membershipId },
      { responsibleMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* PPE checks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A PPE check may name the person it was about (PRD #22 §159, §161).
 *
 * The subject sees their own check. It is about them, and a record of somebody
 * being pulled up for no helmet that they cannot read is not a safety record,
 * it is a file kept on them.
 */
export function buildPpeScopeWhere(context: UserContext): Prisma.PpeCheckWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { checkedByMemberId: context.membershipId },
      { subjectMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Environmental observations                                                  */
/* -------------------------------------------------------------------------- */

export function buildObservationScopeWhere(
  context: UserContext,
): Prisma.EnvironmentalObservationWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { reportedByMemberId: context.membershipId },
      { assignedToMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export function buildStopWorkScopeWhere(context: UserContext): Prisma.StopWorkRecordWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyHseScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { issuedByMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Cross-module                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Projects a safety record may name (PRD #22 §246).
 *
 * A company-scope safety reader reaches every live project, because a safety
 * officer inspects whichever site needs inspecting and is not a member of any of
 * them. Everybody else falls back to the projects they actually reach.
 */
export function buildHseProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  const live: Prisma.ProjectWhereInput = { archivedAt: null, status: { not: "ARCHIVED" } };

  if (hasCompanyHseScope(context)) {
    return { AND: [{ companyId: context.companyId }, live] };
  }

  return { AND: [buildProjectScopeWhere(context), live] };
}

/** Colleagues a safety record may name as inspector, assignee or investigator. */
export function buildHseMemberWhere(context: UserContext): Prisma.CompanyMemberWhereInput {
  return { companyId: context.companyId, status: "ACTIVE", archivedAt: null };
}

/** Whether a reader may see the medical-adjacent injury flags (PRD #22 §22). */
export function canSeeInjuryFlags(context: UserContext): boolean {
  return can(context, "hse.incident.view");
}

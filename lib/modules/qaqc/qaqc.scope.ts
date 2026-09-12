import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Who can see which quality records (PRD #21 §226–§232).
 *
 * Three doors, in order of breadth:
 *
 *   COMPANY   the quality function, which must see every inspection in the
 *             company or it cannot run quality at all,
 *   PROJECT   site people, who see the quality on the jobs they are on,
 *   ASSIGNED  whoever was actually given the inspection or the action —
 *             an inspector must reach their own work even when the record sits
 *             on a project they are not a member of (PRD #21 §229).
 *
 * A record with no project — a supplier NCR, a company-wide template — is not
 * project-scoped at all, so it needs company access. Falling back to "visible
 * to everybody" for those would leak supplier quality history to site staff
 * (PRD #21 §223).
 */

export type QaqcScopeKind = "SELF" | "ASSIGNED" | "PROJECT" | "DEPARTMENT" | "COMPANY";

export function qaqcScopeKind(context: UserContext): QaqcScopeKind {
  const scope = getModuleScope(context, "qaqc");
  if (scope === "COMPANY" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  if (scope === "PROJECT") return "PROJECT";
  if (scope === "ASSIGNED") return "ASSIGNED";
  return "SELF";
}

export function hasCompanyQaqcScope(context: UserContext): boolean {
  const kind = qaqcScopeKind(context);
  return kind === "COMPANY" || kind === "DEPARTMENT";
}

/* -------------------------------------------------------------------------- */
/* Inspection requests                                                         */
/* -------------------------------------------------------------------------- */

export function buildRequestScopeWhere(
  context: UserContext,
): Prisma.InspectionRequestWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyQaqcScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedInspectorMemberId: context.membershipId },
      { requestedByMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A template is company reference data, not a record about a job.
 *
 * Anybody who may see templates sees all of them: a checklist is what the
 * company inspects against, and hiding half of them would let two sites inspect
 * the same work to different standards (PRD #21 §49).
 */
export function buildTemplateScopeWhere(
  context: UserContext,
): Prisma.InspectionTemplateWhereInput {
  return { companyId: context.companyId };
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export function buildInspectionScopeWhere(
  context: UserContext,
): Prisma.QualityInspectionWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyQaqcScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      // The inspector reaches their own work wherever it sits (§229).
      { assignedInspectorMemberId: context.membershipId },
      { executedByMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

/** A defect always has a project, so project scope is the whole story (§222). */
export function buildDefectScopeWhere(context: UserContext): Prisma.QualityDefectWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyQaqcScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedToMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * An NCR may have no project — a supplier or material non-conformance is
 * company-general (PRD #21 §223).
 *
 * A project-scoped reader gets the project ones and the ones they are named on,
 * and nothing else. A supplier NCR is not "everybody's" merely because it
 * belongs to no site.
 */
export function buildNcrScopeWhere(context: UserContext): Prisma.NonConformanceReportWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyQaqcScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedToMemberId: context.membershipId },
      { ownerMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

export function buildCorrectiveActionScopeWhere(
  context: UserContext,
): Prisma.CorrectiveActionWhereInput {
  const base = { companyId: context.companyId };
  if (hasCompanyQaqcScope(context)) return base;

  return {
    ...base,
    OR: [
      { project: buildProjectScopeWhere(context) },
      { assignedToMemberId: context.membershipId },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Material decisions and releases                                             */
/* -------------------------------------------------------------------------- */

export function buildMaterialDecisionScopeWhere(
  context: UserContext,
): Prisma.MaterialInspectionDecisionWhereInput {
  return { inspection: { is: buildInspectionScopeWhere(context) } };
}

export function buildMaterialReleaseScopeWhere(
  context: UserContext,
): Prisma.QualityMaterialReleaseWhereInput {
  return { inspection: { is: buildInspectionScopeWhere(context) } };
}

/* -------------------------------------------------------------------------- */
/* Cross-module                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Projects a quality record may name (PRD #21 §216).
 *
 * A company-scope quality reader reaches every live project, because an
 * inspector raises inspections on whichever site asked for one and is not a
 * member of any of them. Everybody else falls back to the projects they
 * actually reach.
 */
export function buildQaqcProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  const live: Prisma.ProjectWhereInput = { archivedAt: null, status: { not: "ARCHIVED" } };

  if (hasCompanyQaqcScope(context)) {
    return { AND: [{ companyId: context.companyId }, live] };
  }

  return { AND: [buildProjectScopeWhere(context), live] };
}

/** Colleagues a quality record may name as inspector, owner or assignee. */
export function buildQaqcMemberWhere(context: UserContext): Prisma.CompanyMemberWhereInput {
  return { companyId: context.companyId, status: "ACTIVE", archivedAt: null };
}

/**
 * Whether a reader may see the Procurement delivery behind a material
 * inspection (PRD #21 §231).
 *
 * Quality access alone is not enough: the delivery has to be inside their
 * Procurement scope too, or a quality inspector becomes a way to read the
 * buying history.
 */
export function canSeeProcurementSource(context: UserContext): boolean {
  return can(context, "procurement.receipt.view");
}

/** Whether a reader may see quality figures at all (PRD #21 §22). */
export function canSeeMaterialQuantities(context: UserContext): boolean {
  return can(context, "qaqc.material.view");
}

import { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { entitledModulesFor } from "@/lib/core/entitlements/entitlement.resolver";
import { prisma } from "@/lib/database/prisma";
import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";

/**
 * Giving an unassigned project its company (Standalone Project & Deferred
 * Company Assignment PRD §14-§18, §47-§51).
 *
 * Assignment changes who the project belongs to and nothing else: the same row
 * keeps its id, code, history and everything attached to it (§18). It is a
 * privileged domain action, never a field of a generic edit (§34, §36), and
 * only UNASSIGNED → COMPANY exists: moving a project between companies, or
 * back to unassigned, is a different workflow (§37, §38).
 */

/** Group states a project can be assigned into; a deleted, archived or suspended tenant is closed. */
const OPEN_GROUP_STATUSES = ["IMPLEMENTING", "READY_FOR_VALIDATION", "ACTIVE"] as const;

export type AssignmentFinding = { code: string; message: string };

export type ProjectAssignmentPreview = {
  project: { id: string; name: string; code: string };
  company: { id: string; name: string };
  /** The group the company belongs to, if any: inherited, never chosen (§8, §14). */
  group: { id: string; name: string } | null;
  /** What stays attached to the project, so the consequence is visible before confirming (§49). */
  data: { units: number; documents: number; threeDExperiences: number; tasks: number };
  blockers: AssignmentFinding[];
  warnings: AssignmentFinding[];
};

function assertAssign(context: PlatformContext) {
  if (!canPlatform(context, "platform.project.assign_company")) throw new AccessError("FORBIDDEN");
}

async function loadAssignable(projectId: string) {
  const project = assertFound(await prisma.project.findFirst({
    where: { id: projectId, OR: [{ companyId: null }, { company: { parentGroup: { isTestFixture: false } } }] },
    select: {
      id: true, code: true, name: true, companyId: true, archivedAt: true,
      _count: { select: { units: true, documents: true, tasks: true } },
      project3DConfig: { select: { deletedAt: true } },
    },
  }));
  // Already owned: this is the second of two simultaneous assignments, or a stale page (§51).
  if (project.companyId !== null) throw new AccessError("CONFLICT", "This project already belongs to a company. Refresh to see its current owner.", { code: "PROJECT_ALREADY_ASSIGNED" });
  return project;
}

async function loadCompany(companyId: string) {
  return assertFound(await prisma.company.findFirst({
    where: { id: companyId, parentGroup: { isTestFixture: false } },
    select: { id: true, name: true, status: true, parentGroupId: true, parentGroup: { select: { id: true, name: true, kind: true, status: true } } },
  }));
}

/** Everything that stops or qualifies the assignment, without changing anything (§48, §49). */
export async function previewProjectAssignment(context: PlatformContext, input: { projectId: string; companyId: string }): Promise<ProjectAssignmentPreview> {
  assertAssign(context);
  const project = await loadAssignable(input.projectId);
  const company = await loadCompany(input.companyId);

  const blockers: AssignmentFinding[] = [];
  const warnings: AssignmentFinding[] = [];
  if (project.archivedAt) blockers.push({ code: "PROJECT_ARCHIVED", message: "Restore the archived project before assigning it." });
  if (company.status !== "ACTIVE") blockers.push({ code: "COMPANY_INACTIVE", message: "Choose an active company." });
  if (!(OPEN_GROUP_STATUSES as readonly string[]).includes(company.parentGroup.status)) blockers.push({ code: "GROUP_CLOSED", message: "The company's parent group is not open for new projects." });
  if (await prisma.project.count({ where: { companyId: company.id, code: project.code } })) {
    blockers.push({ code: "PROJECT_CODE_TAKEN", message: `${company.name} already has a project with the code ${project.code}. Change this project's code first.` });
  }
  const entitlement = await prisma.companyEntitlement.findUnique({ where: { companyId: company.id }, select: { maxProjects: true } });
  if (entitlement?.maxProjects !== null && entitlement?.maxProjects !== undefined) {
    const used = await prisma.project.count({ where: { companyId: company.id, archivedAt: null } });
    if (used >= entitlement.maxProjects) blockers.push({ code: "PROJECT_LIMIT_REACHED", message: `${company.name} is at its project limit (${used} / ${entitlement.maxProjects}). Ask NESTO to raise it.` });
  }
  if (!(await entitledModulesFor([company.id])).get(company.id)?.has("projects")) {
    warnings.push({ code: "PROJECTS_MODULE_OFF", message: `${company.name} does not have the Projects module enabled, so its people cannot open this project until it is.` });
  }

  return {
    project: { id: project.id, name: project.name, code: project.code },
    company: { id: company.id, name: company.name },
    group: company.parentGroup.kind === "GROUP" ? { id: company.parentGroup.id, name: company.parentGroup.name } : null,
    data: { units: project._count.units, documents: project._count.documents, threeDExperiences: project.project3DConfig && !project.project3DConfig.deletedAt ? 1 : 0, tasks: project._count.tasks },
    blockers,
    warnings,
  };
}

/**
 * Assigns the project in one transaction: the ownership change and its audit
 * event commit together or not at all (§17, §50). The write is a compare-and-set
 * on `companyId IS NULL`, so of two administrators assigning at once exactly one
 * wins and the other is told to refresh (§51).
 */
export async function assignProjectToCompany(context: PlatformContext, input: { projectId: string; companyId: string; reason?: string }) {
  assertAssign(context);
  const preview = await previewProjectAssignment(context, input);
  if (preview.blockers.length > 0) {
    throw new AccessError("CONFLICT", preview.blockers[0]!.message, { code: preview.blockers[0]!.code, blockers: preview.blockers });
  }
  const company = await loadCompany(input.companyId);

  try {
    return await prisma.$transaction(async (tx) => {
      await assertWithinLimit(tx, company.id, "projects");
      const claimed = await tx.project.updateMany({
        where: { id: input.projectId, companyId: null, archivedAt: null },
        data: { companyId: company.id, assignedAt: new Date(), assignedBy: context.userId },
      });
      if (claimed.count !== 1) {
        throw new AccessError("CONFLICT", "This project was assigned or changed while you were looking at it. Refresh to see its current owner.", { code: "PROJECT_ALREADY_ASSIGNED" });
      }
      await recordPlatformAction(context, company.parentGroupId, {
        actionKey: AuditAction.PLATFORM_PROJECT_COMPANY_ASSIGNED,
        entity: { type: "Project", id: preview.project.id, label: preview.project.name },
        projectId: preview.project.id,
        before: { companyId: null },
        after: { companyId: company.id, parentGroupId: company.parentGroup.kind === "GROUP" ? company.parentGroupId : null, code: preview.project.code },
        reason: input.reason,
      }, { tx, companyId: company.id });
      return { id: preview.project.id, companyId: company.id };
    });
  } catch (error) {
    // Same code taken in the company between the preview and the write: the unique key answers.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccessError("CONFLICT", `${company.name} already has a project with this code.`, { code: "PROJECT_CODE_TAKEN" });
    }
    throw error;
  }
}

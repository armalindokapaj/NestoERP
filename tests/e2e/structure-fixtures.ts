import { STRUCTURE_SEED } from "../../prisma/seed/structure";
import { db } from "./db";

/**
 * Project structure fixtures for E2E (E-05B §145).
 *
 * The desktop spec builds a structure on Central Office Tower, which the seed
 * leaves empty; afterwards it goes, with the activity it recorded. Audit
 * events stay: they are append-only evidence, and nothing reads them back by
 * project in a later spec.
 */

export { STRUCTURE_SEED };

export async function removeStructure(projectIds: string[]): Promise<void> {
  const [units, floors, buildings] = await Promise.all([
    db.projectUnit.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
    db.projectFloor.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
    db.projectBuilding.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } }),
  ]);
  const ids = [...units, ...floors, ...buildings].map((row) => row.id);
  const unitIds = units.map((row) => row.id);
  // What a unit's publishing left behind points at the unit, so it goes first (E-05D).
  if (unitIds.length) {
    await db.unitPublicationApproval.deleteMany({ where: { recordId: { in: unitIds } } });
    await db.unitMedia.deleteMany({ where: { unitId: { in: unitIds } } });
    await db.unitDocumentLink.deleteMany({ where: { unitId: { in: unitIds } } });
    await db.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
    await db.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
    const files = await db.document.findMany({ where: { entityType: "project_unit", entityId: { in: unitIds } }, select: { id: true } });
    const fileIds = files.map((row) => row.id);
    await db.documentUploadSession.deleteMany({ where: { documentId: { in: fileIds } } });
    await db.document.deleteMany({ where: { id: { in: fileIds } } });
  }
  await db.activity.deleteMany({ where: { entityType: { in: ["ProjectUnit", "ProjectFloor", "ProjectBuilding"] }, entityId: { in: ids } } });
  await db.projectUnit.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.projectFloor.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.projectBuilding.deleteMany({ where: { projectId: { in: projectIds } } });
}

/**
 * A bare second Aurelia project for a unit spec to build on (E-06 §45).
 *
 * Every demo company runs one project, and Riverside's own units would crowd a
 * spec's searches and counts, so each unit spec works on a project of its own:
 * run by Aurelia's project manager, with Aurelia's architect on it.
 */
export async function createSpareProject(id: string, code: string, name: string): Promise<void> {
  await removeSpareProject(id);
  const type = await db.projectType.findFirstOrThrow({ where: { companyId: "company_demo_a", name: "Residential" }, select: { id: true } });
  await db.project.create({
    data: { id, companyId: "company_demo_a", code, name, status: "ACTIVE", projectManagerMemberId: "member_pm", projectTypeId: type.id, city: "Durrës", createdBy: "seed" },
  });
  await db.projectMember.createMany({
    data: [
      { companyId: "company_demo_a", projectId: id, companyMemberId: "member_pm", projectRole: "Project Manager", status: "ACTIVE" },
      { companyId: "company_demo_a", projectId: id, companyMemberId: "member_architect", projectRole: "Architect", status: "ACTIVE" },
    ],
  });
}

/** Removes a spare project once its spec has cleared what it built on it. */
export async function removeSpareProject(id: string): Promise<void> {
  await removeStructure([id]);
  await db.projectMember.deleteMany({ where: { projectId: id } });
  await db.recentItem.deleteMany({ where: { entityId: id } });
  await db.activity.deleteMany({ where: { entityId: id } });
  await db.project.deleteMany({ where: { id } });
}

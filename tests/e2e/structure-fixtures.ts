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

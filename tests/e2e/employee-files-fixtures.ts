import { db, removeRecordTrail, removeTestDocuments } from "./db";

/**
 * Setup and teardown for the employee-file journeys (E-02).
 *
 * Everything a spec files or adds is named with its prefix: the document
 * links, the qualifications and the canonical files under them. They point at
 * each other with restricting keys, so they go in order — the chains between
 * links, the links and qualifications, then the files.
 */

/** Aurelia's engineer: their employment there and their person across the group. */
export async function engineerFile(): Promise<{ employeeId: string; personId: string }> {
  const employment = await db.employeeProfile.findFirstOrThrow({
    where: { companyId: "company_demo_a", companyMember: { user: { username: "engineer-a" } } },
    select: { id: true, personProfileId: true },
  });
  return { employeeId: employment.id, personId: employment.personProfileId };
}

export async function removeEmployeeFiles(prefix: string): Promise<void> {
  const links = await db.employeeDocumentLink.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
  const qualifications = await db.personQualification.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
  const linkIds = links.map((row) => row.id);
  const qualificationIds = qualifications.map((row) => row.id);

  await removeRecordTrail("employee_document", linkIds);
  await removeRecordTrail("person_qualification", qualificationIds);
  await db.auditEvent.deleteMany({ where: { entityId: { in: [...linkIds, ...qualificationIds] } } });
  await db.employeeDocumentLink.updateMany({ where: { id: { in: linkIds } }, data: { supersededById: null, amendsId: null } });
  await db.employeeDocumentLink.deleteMany({ where: { id: { in: linkIds } } });
  await db.personQualification.updateMany({ where: { id: { in: qualificationIds } }, data: { supersededById: null } });
  await db.personQualification.deleteMany({ where: { id: { in: qualificationIds } } });
  await removeTestDocuments(prefix);
}

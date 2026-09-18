import { prisma } from "../../helpers";

/**
 * One filed employee document and one qualification in a company, for the
 * sweeps (E-02 §171-§186, §241).
 *
 * The demo seeds neither outside ARMAAR, and a route whose segments cannot be
 * filled from real rows is reported uncovered rather than attacked. These give
 * the employee-document and qualification routes a real target in each company
 * a sweep attacks; the returned function takes them away again.
 */
export async function seedEmployeeFiles(companyId: string): Promise<() => Promise<void>> {
  const suffix = companyId.replace(/[^a-z0-9]/gi, "").slice(-12);
  const ids = { document: `sweep_edoc_${suffix}`, link: `sweep_edl_${suffix}`, qualification: `sweep_pq_${suffix}`, person: `sweep_person_${suffix}`, employment: `sweep_employment_${suffix}` };
  const remove = async () => {
    await prisma.personQualification.deleteMany({ where: { id: ids.qualification } });
    await prisma.employeeDocumentLink.deleteMany({ where: { id: ids.link } });
    await prisma.document.deleteMany({ where: { id: ids.document } });
    await prisma.employeeProfile.deleteMany({ where: { id: ids.employment } });
    await prisma.personProfile.deleteMany({ where: { id: ids.person } });
  };
  await remove();

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { parentGroupId: true } });
  // A company with nobody employed (the fixture tenant) gets somebody who never signs in.
  const employment =
    (await prisma.employeeProfile.findFirst({ where: { companyId }, orderBy: { createdAt: "asc" }, select: { id: true, personProfileId: true } })) ??
    (await (async () => {
      await prisma.personProfile.create({ data: { id: ids.person, parentGroupId: company.parentGroupId!, firstName: "Sweep", lastName: "Worker", lifecycleStatus: "EMPLOYEE" } });
      return prisma.employeeProfile.create({ data: { id: ids.employment, companyId, personProfileId: ids.person, employmentStatus: "ACTIVE" }, select: { id: true, personProfileId: true } });
    })());
  await prisma.document.create({
    data: { id: ids.document, companyId, name: "Sweep contract.pdf", module: "hr", entityType: "employee", entityId: employment.id, status: "ACTIVE", storageStatus: "AVAILABLE", createdBy: "sweep" },
  });
  await prisma.employeeDocumentLink.create({
    data: { id: ids.link, companyId, employeeProfileId: employment.id, documentId: ids.document, category: "EMPLOYMENT_CONTRACT", title: "Sweep contract", visibility: "EMPLOYEE_AND_HR" },
  });
  await prisma.personQualification.create({
    data: { id: ids.qualification, parentGroupId: company.parentGroupId!, personProfileId: employment.personProfileId, companyId, type: "PROFESSIONAL_LICENSE", title: "Sweep licence", visibility: "GROUP_SUMMARY", verificationStatus: "VERIFIED" },
  });
  return remove;
}

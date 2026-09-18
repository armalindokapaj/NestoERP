import { can } from "@/lib/access/can";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";

/**
 * What an employment change may name, for the change forms (E-03 §96-§101,
 * §163, §165). Only what this reader may offer: this company's open
 * departments and active members; the documents filed on this employee that the
 * reader can open; and — for a company transfer — the group's other companies
 * where the reader holds HR authority, with their own departments and members.
 * The server checks every choice again.
 */

export type Option = { id: string; name: string; detail?: string | null };

export type EmploymentChangeOptionsDTO = {
  departments: Option[];
  managers: Option[];
  documents: Option[];
  companies: Array<Option & { departments: Option[]; managers: Option[] }>;
};

async function companyChoices(companyId: string, excludeMemberId: string | null): Promise<{ departments: Option[]; managers: Option[] }> {
  const [departments, managers] = await Promise.all([
    prisma.department.findMany({
      where: { companyId, status: "ACTIVE", OR: [{ groupDepartmentId: null }, { groupDepartment: { status: "ACTIVE" } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId, status: "ACTIVE", ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}) },
      select: { id: true, jobTitle: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { firstName: "asc" } },
    }),
  ]);
  return {
    departments,
    managers: managers.map((member) => ({ id: member.id, name: `${member.user.firstName} ${member.user.lastName}`, detail: member.jobTitle })),
  };
}

export async function employmentChangeOptions(context: UserContext, memberId: string): Promise<EmploymentChangeOptionsDTO> {
  const here = await companyChoices(context.companyId, memberId);

  // Supporting documents: the ones filed on this employee's record, that this reader can open (§165, §166).
  const filed = can(context, "document.view")
    ? await prisma.document.findMany({
        where: { companyId: context.companyId, entityType: "employee", entityId: memberId, status: "ACTIVE" },
        select: { id: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  const documents: Option[] = [];
  for (const row of filed) {
    const document = await findReadableDocument(context, row.id);
    if (document) documents.push({ id: document.id, name: document.name });
  }

  const companies: EmploymentChangeOptionsDTO["companies"] = [];
  if (can(context, "hr.employment.transfer_entity")) {
    const others = await prisma.company.findMany({
      where: { parentGroupId: context.parentGroupId, status: "ACTIVE", id: { not: context.companyId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    for (const company of others) {
      const there = await contextInCompany(context, company.id);
      if (!there || !there.enabledModules.includes("hr") || !can(there, "hr.employee.create_profile")) continue;
      companies.push({ ...company, ...(await companyChoices(company.id, null)) });
    }
  }
  return { ...here, documents, companies };
}

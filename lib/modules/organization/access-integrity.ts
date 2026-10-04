import type { ParentGroupStatus, PrismaClient } from "@prisma/client";

import type { OrganizationFinding } from "./organization-integrity";

/**
 * The access model's own consistency (Admin PRD #14 §15, §21, §25, §28).
 *
 * Group seats carry a company access policy; the policy is materialised as
 * `groupDerived` company memberships, and the Company CEO is a pointer on the
 * company. Each is written by a service that keeps it in step, so a defect
 * shows up as the two sides disagreeing. This reads both sides and names the
 * disagreement: a derived membership no policy covers, a covered company with
 * no membership, a selected company of another group, two Group CEOs, a CEO
 * pointer that points at the wrong membership, and logins that differ only by
 * letter case. Read-only.
 */
const USABLE_GROUP: ParentGroupStatus[] = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];

export async function findAccessFindings(prisma: PrismaClient): Promise<OrganizationFinding[]> {
  const findings: OrganizationFinding[] = [];
  const add = (level: OrganizationFinding["level"], code: string, group: string, message: string) => findings.push({ level, code, group, message });

  const seats = await prisma.parentGroupMember.findMany({
    where: { status: "ACTIVE", roleId: { not: null }, user: { status: "ACTIVE" }, parentGroup: { kind: "GROUP", status: { in: USABLE_GROUP } } },
    select: {
      id: true, userId: true, parentGroupId: true, companyAccessMode: true, role: { select: { key: true } },
      user: { select: { username: true } }, parentGroup: { select: { slug: true } }, companies: { select: { companyId: true } },
    },
  });
  const companies = await prisma.company.findMany({ select: { id: true, name: true, status: true, parentGroupId: true, parentGroup: { select: { slug: true } }, ceoMemberId: true } });
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const members = await prisma.companyMember.findMany({
    where: { status: "ACTIVE", archivedAt: null },
    select: { id: true, userId: true, companyId: true, groupDerived: true, role: { select: { key: true } } },
  });

  const covered = new Map<string, Set<string>>();
  for (const seat of seats) {
    const reach = new Set<string>();
    const inGroup = companies.filter((company) => company.parentGroupId === seat.parentGroupId && company.status === "ACTIVE");
    if (seat.companyAccessMode === "ALL") for (const company of inGroup) reach.add(company.id);
    if (seat.companyAccessMode === "SELECTED") for (const row of seat.companies) if (inGroup.some((company) => company.id === row.companyId)) reach.add(row.companyId);
    covered.set(`${seat.userId}:${seat.parentGroupId}`, reach);
    for (const row of seat.companies) {
      const company = companyById.get(row.companyId);
      if (company && company.parentGroupId !== seat.parentGroupId) add("error", "SELECTED_FOREIGN_COMPANY", seat.parentGroup.slug, `${seat.user.username}'s selected companies include ${company.name}, which belongs to another group.`);
    }
  }

  // A derived membership must be covered by a live seat of the company's own group.
  for (const member of members.filter((row) => row.groupDerived)) {
    const company = companyById.get(member.companyId);
    if (!company) continue;
    if (!covered.get(`${member.userId}:${company.parentGroupId}`)?.has(company.id)) {
      add("error", "DERIVED_WITHOUT_COVERAGE", company.parentGroup.slug, `A group-derived membership in ${company.name} has no group seat whose policy covers it.`);
    }
  }
  // A covered company must be reachable: some active membership of the person.
  const reachable = new Set(members.map((member) => `${member.userId}:${member.companyId}`));
  for (const seat of seats) {
    for (const companyId of covered.get(`${seat.userId}:${seat.parentGroupId}`) ?? []) {
      if (!reachable.has(`${seat.userId}:${companyId}`)) add("error", "COVERED_WITHOUT_MEMBERSHIP", seat.parentGroup.slug, `${seat.user.username} is covered for ${companyById.get(companyId)?.name ?? companyId} but holds no active membership there.`);
    }
  }

  // One Group CEO per group.
  const owners = new Map<string, string[]>();
  for (const seat of seats.filter((row) => row.role?.key === "OWNER")) owners.set(seat.parentGroupId, [...(owners.get(seat.parentGroupId) ?? []), seat.user.username]);
  for (const [groupId, names] of owners) {
    if (names.length > 1) add("error", "MULTIPLE_GROUP_CEOS", seats.find((seat) => seat.parentGroupId === groupId)!.parentGroup.slug, `${names.length} active Group CEOs: ${names.join(", ")}.`);
  }

  // The Company CEO pointer names a direct, active CEO membership of that company.
  const memberById = new Map(members.map((member) => [member.id, member]));
  for (const company of companies.filter((row) => row.ceoMemberId)) {
    const member = memberById.get(company.ceoMemberId!);
    if (!member || member.companyId !== company.id || member.role.key !== "CEO" || member.groupDerived) {
      add("error", "CEO_POINTER_INVALID", company.parentGroup.slug, `${company.name}'s CEO pointer does not name an active direct CEO membership of that company.`);
    }
  }
  const ceosByCompany = new Map<string, number>();
  for (const member of members.filter((row) => row.role.key === "CEO" && !row.groupDerived)) ceosByCompany.set(member.companyId, (ceosByCompany.get(member.companyId) ?? 0) + 1);
  for (const [companyId, count] of ceosByCompany) {
    const company = companyById.get(companyId);
    if (company && count > 1) add("warning", "COMPANY_MULTIPLE_CEO_ROLES", company.parentGroup.slug, `${company.name} has ${count} active members with the CEO role; the pointer names one.`);
  }

  // Logins that differ only by letter case are one person entered twice (PRD #14 §10). Reported, never merged.
  const emails = await prisma.user.findMany({ where: { email: { not: null } }, select: { email: true, username: true } });
  const byEmail = new Map<string, string[]>();
  for (const user of emails) byEmail.set(user.email!.toLowerCase(), [...(byEmail.get(user.email!.toLowerCase()) ?? []), user.username]);
  for (const [email, names] of byEmail) if (names.length > 1) add("warning", "DUPLICATE_IDENTITY", "platform", `${names.join(", ")} share the email ${email} apart from letter case; review by hand.`);

  return findings;
}

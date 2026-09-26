/**
 * Is the ARMAAR demo what D-01 says it is? (§93-§99, §107, §108, §110, §111)
 * And D-02's operational rules, and D-03's named people.
 *
 * Run at the end of every `seed:armaar` and by `pnpm verify:demo`. Each finding
 * is a sentence; none means consistent. The public facts are compared with
 * `public-facts.ts` itself, so a public value silently replaced — by a template,
 * a later seed or a hand — is caught (§66, §108).
 */
import type { PrismaClient } from "@prisma/client";

import { groupDepartmentId } from "../../../config/group-departments";
import { companyId, departmentName } from "./organization";
import { SIGN_IN_ACCOUNT, signInWorkspace } from "../../../lib/auth/credentials";
import { companiesOf } from "./access";
import { ARMAAR_PEOPLE } from "./people";
import { PROJECTS, projectId } from "./projects";
import { DEPARTMENT_HEADS, PROJECT_MANAGERS } from "./provided-facts";
import { COMPANY_FACTS, GROUP_FACTS, GROUP_OWNER, PROJECT_FACTS, type CompanyCode } from "./public-facts";
import { normalName } from "./records";

/** What D-01 fixes about a project's synthetic state (§19, §21): status and progress. */
const PROMISED: Record<string, { status: string; progress: number }> = {
  "Tirana Lake": { status: "ACTIVE", progress: 62 },
  "Square 21": { status: "FINISHED", progress: 100 },
};

/** The prefix of a company's own contract numbers (`BCI-SA-2025-001`, `ALN-SV-2025-0001`). */
const CONTRACT_PREFIX: Partial<Record<CompanyCode, string>> = {
  BUILDING_CONSTRUCTION_INVEST: "BCI",
  ARLIS_NDERTIM: "ALN",
  IDEAL_CONSTRUCTION: "IDEAL",
  UNICO_CONSTRUCTION: "UNICO",
  SARANDA_MARINA_INVEST: "SMI",
  ARSOL_ENERGY: "ARSOL",
};

export async function verifyDemoTenant(prisma: PrismaClient, groupId: string): Promise<string[]> {
  const findings: string[] = [];
  const say = (finding: string) => findings.push(finding);

  const group = await prisma.parentGroup.findUnique({ where: { id: groupId } });
  if (!group) return [`The demo group ${groupId} does not exist.`];
  if (!group.isDemo) say("The group is not marked as a demo tenant, so nothing says its operational data is synthetic.");
  for (const field of ["name", "legalName", "registrationNumber", "country", "city"] as const) {
    if (group[field] !== GROUP_FACTS[field]) say(`The group's ${field} is "${group[field]}", not the public "${GROUP_FACTS[field]}".`);
  }

  /* Companies (§5, §6, §93) --------------------------------------------------- */
  const companies = await prisma.company.findMany({ where: { parentGroupId: groupId }, select: { id: true, name: true, status: true, registrationNumber: true, owners: { select: { sharePercent: true } } } });
  const expected = new Map(COMPANY_FACTS.map((fact) => [companyId(fact.code), fact]));
  for (const company of companies) {
    const fact = expected.get(company.id);
    if (!fact) {
      say(`${company.name} is in the group but not among its identified companies.`);
      continue;
    }
    if (company.name !== fact.name) say(`${fact.name} is named "${company.name}".`);
    if (company.status !== fact.status) say(`${fact.name} is ${company.status}, not ${fact.status}.`);
    if (company.registrationNumber !== fact.registrationNumber) say(`${fact.name}'s NIPT is "${company.registrationNumber}", not the source's "${fact.registrationNumber}".`);
    const share = company.owners.reduce((sum, owner) => sum + Number(owner.sharePercent), 0);
    if (share > 100) say(`${fact.name} is owned ${share}%.`);
  }
  for (const [id, fact] of expected) if (!companies.some((company) => company.id === id)) say(`${fact.name} is missing.`);
  const names = companies.map((company) => company.name.toLowerCase());
  if (new Set(names).size !== names.length) say("Two companies of the group share a name.");

  /* People (§11, §95): one person, one login each ---------------------------- */
  const users = await prisma.user.findMany({ where: { personProfile: { parentGroupId: groupId } }, select: { id: true, username: true, personProfileId: true } });
  if (users.length !== ARMAAR_PEOPLE.length) say(`${users.length} people have a login in the group; the demo has ${ARMAAR_PEOPLE.length}.`);
  const persons = await prisma.personProfile.findMany({ where: { parentGroupId: groupId }, select: { id: true, workEmail: true, user: { select: { id: true } }, _count: { select: { employments: true } } } });
  const emails = persons.map((person) => person.workEmail?.toLowerCase()).filter(Boolean);
  if (new Set(emails).size !== emails.length) say("Two people of the group share a work email: a person is duplicated.");
  const withLogin = persons.filter((person) => person.user);
  if (withLogin.length !== users.length) say(`${withLogin.length} people for ${users.length} logins: somebody is a person twice or not at all.`);
  // Most of a site workforce never signs in (E-04 §4): a person without a login is there because they are employed.
  const loose = persons.filter((person) => !person.user && person._count.employments === 0).length;
  if (loose) say(`${loose} people have neither a login nor an employment.`);

  const unemployed = await prisma.companyMember.count({
    where: { company: { parentGroupId: groupId }, status: "ACTIVE", user: { personProfile: { employments: { none: {} } } } },
  });
  if (unemployed) say(`${unemployed} logins belong to people with no employment.`);

  /* Projects (§15-§21, §96) --------------------------------------------------- */
  const projects = await prisma.project.findMany({
    where: { company: { parentGroupId: groupId } },
    select: { id: true, name: true, city: true, builtArea: true, companyId: true, status: true, projectType: { select: { name: true } }, milestones: { select: { status: true } } },
  });
  for (const fact of PROJECT_FACTS) {
    const project = projects.find((candidate) => candidate.name === fact.name);
    if (!project) {
      say(`${fact.name} is missing.`);
      continue;
    }
    if (fact.city && project.city !== fact.city) say(`${fact.name} is in "${project.city}", not the public ${fact.city}.`);
    if (fact.builtArea !== undefined && Number(project.builtArea) !== fact.builtArea) say(`${fact.name}'s built area is ${project.builtArea} m², not the public ${fact.builtArea} m².`);
    if (fact.company && project.companyId !== companyId(fact.company)) say(`${fact.name} is not under ${fact.company}.`);
    if (fact.type && project.projectType?.name !== fact.type) say(`${fact.name} is typed "${project.projectType?.name}", not the public ${fact.type}.`);
    const promised = PROMISED[fact.name];
    if (promised) {
      const counted = project.milestones.filter((milestone) => milestone.status !== "CANCELLED");
      const progress = counted.length ? Math.round((counted.filter((milestone) => milestone.status === "COMPLETED").length / counted.length) * 100) : 0;
      if (project.status !== promised.status) say(`${fact.name} is ${project.status}, not ${promised.status}.`);
      if (progress !== promised.progress) say(`${fact.name}'s progress is ${progress}%, not ${promised.progress}%.`);
    }
  }
  if (projects.length !== PROJECT_FACTS.length) say(`The group has ${projects.length} projects; its public portfolio is ${PROJECT_FACTS.length}.`);
  // Which company runs each project is the demo's assignment (the plan's), public only for Tirana Lake.
  for (const plan of PROJECTS) {
    const project = projects.find((candidate) => candidate.id === projectId(plan.code));
    if (project && project.companyId !== companyId(plan.company)) say(`${project.name} is not under ${plan.company}, the company the demo gives it.`);
  }

  /* Suspended companies take no new work (§5) -------------------------------- */
  const suspendedWork = await prisma.project.count({ where: { company: { parentGroupId: groupId, status: "SUSPENDED" } } });
  if (suspendedWork) say(`${suspendedWork} projects belong to suspended companies.`);

  /* Provenance (§107) --------------------------------------------------------- */
  const recorded = new Set((await prisma.demoRecord.findMany({ where: { parentGroupId: groupId }, select: { entityId: true } })).map((row) => row.entityId));
  for (const company of companies) if (!recorded.has(company.id)) say(`${company.name} has no provenance record.`);
  for (const project of projects) if (!recorded.has(project.id)) say(`${project.name} has no provenance record.`);
  for (const user of users) if (!recorded.has(user.id)) say(`${user.username} has no provenance record.`);
  const unrecorded = persons.filter((person) => !person.user && !recorded.has(person.id)).length;
  if (unrecorded) say(`${unrecorded} people without a login have no provenance record.`);
  if (!recorded.has(groupId)) say("The group has no provenance record.");

  findings.push(...(await verifyNamedPeople(prisma, groupId)));
  findings.push(...(await verifyOperations(prisma, groupId)));
  return findings;
}

/**
 * The people D-03 names (§35-§40): each one person of the group, the person
 * behind their login, nothing private made up for them, and in the place D-03
 * gives them — one Owner, one head per function, one manager per project.
 */
async function verifyNamedPeople(prisma: PrismaClient, groupId: string): Promise<string[]> {
  const findings: string[] = [];
  const say = (finding: string) => findings.push(finding);
  const name = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;
  const same = (a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }) => normalName(a.firstName, a.lastName) === normalName(b.firstName, b.lastName);

  const everyone = await prisma.personProfile.findMany({
    where: { parentGroupId: groupId },
    select: { firstName: true, lastName: true, workPhone: true, personalEmail: true, personalPhone: true, dateOfBirth: true, address: true, city: true, country: true, user: { select: { username: true, phone: true } } },
  });
  for (const person of ARMAAR_PEOPLE.filter((candidate) => candidate.named)) {
    const matches = everyone.filter((candidate) => same(candidate, person));
    if (matches.length !== 1) {
      say(`${name(person)} is ${matches.length} people of the group, not one.`);
      continue;
    }
    const [record] = matches;
    if (record!.user?.username !== person.username) say(`${name(person)} is not the person behind ${person.username}.`);
    const invented: string[] = (["workPhone", "personalEmail", "personalPhone", "dateOfBirth", "address", "city", "country"] as const).filter((field) => record![field] !== null);
    if (record!.user?.phone) invented.push("phone");
    if (invented.length) say(`${name(person)} has private details the demo made up: ${invented.join(", ")} (D-03 §14).`);
  }

  const owners = await prisma.departmentAssignment.findMany({
    where: { parentGroupId: groupId, status: "ACTIVE", positionLevel: "GROUP_HEAD", functionalRoleKey: "OWNER" },
    select: { user: { select: { firstName: true, lastName: true } } },
  });
  if (owners.length !== 1) say(`The group has ${owners.length} Owners, not one.`);
  else if (!same(owners[0]!.user, GROUP_OWNER)) say(`The group's Owner is ${name(owners[0]!.user)}, not the public ${name(GROUP_OWNER)}.`);

  for (const head of DEPARTMENT_HEADS) {
    const held = await prisma.departmentAssignment.findFirst({
      where: { groupDepartmentId: groupDepartmentId(groupId, head.department), status: "ACTIVE", positionLevel: "GROUP_HEAD" },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!held) say(`${departmentName(head.department)} has no head; D-03 names ${name(head)}.`);
    else if (!same(held.user, head)) say(`${departmentName(head.department)}'s head is ${name(held.user)}; D-03 names ${name(head)}.`);
  }

  for (const manager of PROJECT_MANAGERS) {
    const project = await prisma.project.findUnique({
      where: { id: projectId(manager.project) },
      select: {
        name: true,
        projectManager: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        members: { where: { isPrimary: true, status: "ACTIVE" }, select: { companyMemberId: true } },
      },
    });
    if (!project) continue;
    if (!project.projectManager || !same(project.projectManager.user, manager)) {
      say(`${project.name}'s manager is ${project.projectManager ? name(project.projectManager.user) : "nobody"}; D-03 names ${name(manager)}.`);
    } else if (project.members.length !== 1 || project.members[0]!.companyMemberId !== project.projectManager.id) {
      say(`${project.name} has ${project.members.length} primary members; its manager should be the one.`);
    }
  }

  // AUD-06 §5: each named person is exactly the identity the seed encodes —
  // employed where it says, a login with their role in each company it lists
  // and no other, and a sign-in that starts where a real one would.
  for (const fact of [...DEPARTMENT_HEADS, ...PROJECT_MANAGERS]) {
    const person = ARMAAR_PEOPLE.find((candidate) => same(candidate, fact));
    if (!person) {
      say(`${name(fact)} is not among the seeded people.`);
      continue;
    }
    const account = await prisma.user.findUnique({
      where: { username: person.username },
      include: {
        ...SIGN_IN_ACCOUNT,
        personProfile: { select: { employments: { where: { employmentStatus: "ACTIVE" }, select: { companyId: true } } } },
      },
    });
    if (!account || account.status !== "ACTIVE") {
      say(`${name(fact)} (${person.username}) has no active login.`);
      continue;
    }
    const employers = (account.personProfile?.employments ?? []).map((employment) => employment.companyId);
    if (employers.length !== 1 || employers[0] !== companyId(person.company)) {
      say(`${name(fact)} is employed by ${employers.length ? employers.join(", ") : "nobody"}; the seed employs them at ${person.company}.`);
    }
    const expected = companiesOf(person).filter((code) => COMPANY_FACTS.find((company) => company.code === code)?.status === "ACTIVE").map(companyId);
    const logins = await prisma.companyMember.findMany({
      where: { userId: account.id, status: "ACTIVE", company: { status: "ACTIVE" } },
      select: { companyId: true, role: { select: { key: true } } },
    });
    const loginCompanies = new Set(logins.map((login) => login.companyId));
    const missing = expected.filter((id) => !loginCompanies.has(id));
    const extra = [...loginCompanies].filter((id) => !expected.includes(id));
    if (missing.length || extra.length) say(`${name(fact)}'s logins differ from the seed: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"}.`);
    const wrongRole = logins.filter((login) => login.role.key !== person.role);
    if (wrongRole.length) say(`${name(fact)} is not ${person.role} in ${wrongRole.map((login) => `${login.companyId} (${login.role.key})`).join(", ")}.`);
    const start = signInWorkspace(account);
    if (!start || start.platform || start.membership.companyId !== expected[0]) {
      say(`${name(fact)} would start in ${start && !start.platform ? start.membership.companyId : "nowhere"}; the seed starts them in ${expected[0]}.`);
    }
  }
  return findings;
}

/** The product's own number series shape: highest-in-series allocation reads them as numbers (D-02). */
const SERIES = /^[A-Z]+(-[A-Z]+)?-\d{4}-\d{4}$/;

/**
 * What D-02 holds true of the operational data (§55, §56, §83): the rules the
 * product keeps when it writes these records itself.
 */
async function verifyOperations(prisma: PrismaClient, groupId: string): Promise<string[]> {
  const findings: string[] = [];
  const say = (finding: string) => findings.push(finding);
  const inGroup = { company: { parentGroupId: groupId } };

  // An approved order has opened its Finance commitment, and points at it.
  const orders = await prisma.purchaseOrder.findMany({ where: { ...inGroup, status: { in: ["APPROVED", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } }, select: { id: true, poNumber: true, financeCommitmentId: true } });
  const committed = new Map((await prisma.commitment.findMany({ where: { ...inGroup, sourceModule: "procurement", sourceEntityType: "purchase_order" }, select: { id: true, sourceEntityId: true } })).map((row) => [row.sourceEntityId, row.id]));
  for (const order of orders) if (!order.financeCommitmentId || committed.get(order.id) !== order.financeCommitmentId) say(`Approved order ${order.poNumber} has no commitment of its own.`);

  // A project's records are its company's: units, sales, clients, contracts and money never cross into another (company-scoped).
  const own = new Map(PROJECTS.map((plan) => [projectId(plan.code), companyId(plan.company)]));
  const crossing = async (what: string, rows: Array<{ companyId: string; projectId: string | null }>) => {
    const wrong = rows.filter((row) => row.projectId && own.has(row.projectId) && own.get(row.projectId) !== row.companyId).length;
    if (wrong) say(`${wrong} ${what} belong to another company than their project's.`);
  };
  const groupCompanies = { companyId: { in: (await prisma.company.findMany({ where: { parentGroupId: groupId }, select: { id: true } })).map((row) => row.id) } };
  const scoped = { where: groupCompanies, select: { companyId: true, projectId: true } };
  await crossing("units", await prisma.projectUnit.findMany(scoped));
  await crossing("buildings", await prisma.projectBuilding.findMany(scoped));
  await crossing("commercial profiles", await prisma.unitCommercialProfile.findMany(scoped));
  await crossing("reservations", await prisma.unitReservation.findMany(scoped));
  await crossing("contracts", await prisma.contract.findMany(scoped));
  await crossing("payments", await prisma.payment.findMany(scoped));
  await crossing("invoices", await prisma.invoice.findMany(scoped));
  await crossing("tasks", await prisma.task.findMany(scoped));
  await crossing("meetings", await prisma.meeting.findMany(scoped));
  await crossing("budgets", await prisma.projectBudget.findMany(scoped));
  await crossing("expenses", await prisma.expense.findMany(scoped));
  await crossing("purchase requests", await prisma.purchaseRequest.findMany(scoped));
  await crossing("work logs", await prisma.workLog.findMany(scoped));
  await crossing("crews", await prisma.workforceCrew.findMany(scoped));
  const reservations = await prisma.unitReservation.findMany({ where: groupCompanies, select: { companyId: true, clientId: true } });
  const clientCompany = new Map((await prisma.client.findMany({ where: { id: { in: reservations.map((row) => row.clientId) } }, select: { id: true, companyId: true } })).map((row) => [row.id, row.companyId]));
  const foreign = reservations.filter((row) => clientCompany.get(row.clientId) !== row.companyId).length;
  if (foreign) say(`${foreign} reservations are for a client of another company.`);
  const team = await prisma.projectMember.findMany({ where: { project: inGroup }, select: { companyId: true, project: { select: { companyId: true } }, member: { select: { companyId: true } } } });
  const outsiders = team.filter((row) => row.companyId !== row.project.companyId || row.member.companyId !== row.project.companyId).length;
  if (outsiders) say(`${outsiders} project team members are not members of the project's company.`);

  // A contract numbered with a company's prefix is that company's.
  const prefixOf = new Map(Object.entries(CONTRACT_PREFIX).map(([code, prefix]) => [prefix, companyId(code as CompanyCode)]));
  for (const contract of await prisma.contract.findMany({ where: inGroup, select: { contractNumber: true, companyId: true } })) {
    const owner = prefixOf.get(contract.contractNumber.split("-")[0]!);
    if (owner && owner !== contract.companyId) say(`Contract ${contract.contractNumber} carries another company's prefix.`);
  }

  // Numbers the product continues from are in its own series shape.
  const numbered = [
    ...(await prisma.purchaseRequest.findMany({ where: inGroup, select: { requestNumber: true } })).map((row) => row.requestNumber),
    ...(await prisma.purchaseOrder.findMany({ where: inGroup, select: { poNumber: true } })).map((row) => row.poNumber),
    ...(await prisma.goodsReceipt.findMany({ where: inGroup, select: { receiptNumber: true } })).map((row) => row.receiptNumber),
    ...(await prisma.nonConformanceReport.findMany({ where: inGroup, select: { ncrNumber: true } })).map((row) => row.ncrNumber),
    ...(await prisma.qualityInspection.findMany({ where: inGroup, select: { inspectionNumber: true } })).map((row) => row.inspectionNumber),
    ...(await prisma.hseHazard.findMany({ where: inGroup, select: { hazardNumber: true } })).map((row) => row.hazardNumber),
    ...(await prisma.stockIssue.findMany({ where: inGroup, select: { issueNumber: true } })).map((row) => row.issueNumber),
  ];
  const odd = numbered.filter((number) => !SERIES.test(number));
  if (odd.length) say(`${odd.length} numbers are not in the product's series shape, e.g. ${odd.slice(0, 3).join(", ")}: the next number the product allocates would repeat one.`);

  // Stock on hand is the ledger's sum, location by location, and never negative (PRD #20 §79-§83).
  const ledger = new Map((await prisma.stockMovement.groupBy({ by: ["inventoryItemId", "locationId"], where: inGroup, _sum: { signedQuantity: true } })).map((row) => [`${row.inventoryItemId}:${row.locationId}`, Number(row._sum.signedQuantity ?? 0)]));
  for (const balance of await prisma.inventoryBalance.findMany({ where: inGroup, select: { inventoryItemId: true, locationId: true, onHandQuantity: true } })) {
    const onHand = Number(balance.onHandQuantity);
    if (onHand !== (ledger.get(`${balance.inventoryItemId}:${balance.locationId}`) ?? 0)) say(`Stock of ${balance.inventoryItemId} at ${balance.locationId} disagrees with its movements.`);
    if (onHand < 0) say(`Stock of ${balance.inventoryItemId} at ${balance.locationId} is negative.`);
  }

  // No invoice is paid more than it asks.
  for (const invoice of await prisma.invoice.findMany({ where: inGroup, select: { invoiceNumber: true, totalAmount: true, allocations: { where: { reversedAt: null }, select: { amount: true } } } })) {
    const paid = invoice.allocations.reduce((sum, row) => sum + Number(row.amount), 0);
    if (paid > Number(invoice.totalAmount) + 0.005) say(`Invoice ${invoice.invoiceNumber} is allocated more than its total.`);
  }

  // A task opened from a record names one that exists (§75: links resolve).
  const linked = await prisma.task.findMany({ where: { ...inGroup, entityId: { not: null } }, select: { title: true, entityType: true, entityId: true } });
  const exists: Record<string, (ids: string[]) => Promise<Array<{ id: string }>>> = {
    rfi: (ids) => prisma.rfi.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    technical_submittal: (ids) => prisma.technicalSubmittal.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    engineering_document: (ids) => prisma.engineeringDocument.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    transmittal: (ids) => prisma.documentTransmittal.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    purchase_request: (ids) => prisma.purchaseRequest.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    purchase_order: (ids) => prisma.purchaseOrder.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    goods_receipt: (ids) => prisma.goodsReceipt.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    contractor: (ids) => prisma.contractorProfile.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    contractor_compliance: (ids) => prisma.contractorComplianceItem.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  };
  for (const [type, lookup] of Object.entries(exists)) {
    const ids = linked.filter((task) => task.entityType === type).map((task) => task.entityId!);
    if (!ids.length) continue;
    const found = new Set((await lookup(ids)).map((row) => row.id));
    for (const task of linked.filter((row) => row.entityType === type && !found.has(row.entityId!))) say(`Task "${task.title}" names a ${type} that does not exist.`);
  }

  return findings;
}

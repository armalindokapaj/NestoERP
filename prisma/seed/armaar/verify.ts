/**
 * Is the ARMAAR demo what D-01 says it is? (§93-§99, §107, §108, §110, §111)
 *
 * Run at the end of every `seed:armaar` and by `pnpm verify:demo`. Each finding
 * is a sentence; none means consistent. The public facts are compared with
 * `public-facts.ts` itself, so a public value silently replaced — by a template,
 * a later seed or a hand — is caught (§66, §108).
 */
import type { PrismaClient } from "@prisma/client";

import { companyId } from "./organization";
import { ARMAAR_PEOPLE } from "./people";
import { COMPANY_FACTS, GROUP_FACTS, PROJECT_FACTS } from "./public-facts";

/** What D-01 fixes about a project's synthetic state (§19, §21): status and progress. */
const PROMISED: Record<string, { status: string; progress: number }> = {
  "Tirana Lake": { status: "ACTIVE", progress: 62 },
  "Square 21": { status: "FINISHED", progress: 100 },
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
  const persons = await prisma.personProfile.findMany({ where: { parentGroupId: groupId }, select: { id: true, workEmail: true } });
  const emails = persons.map((person) => person.workEmail?.toLowerCase()).filter(Boolean);
  if (new Set(emails).size !== emails.length) say("Two people of the group share a work email: a person is duplicated.");
  if (persons.length !== users.length) say(`${persons.length} people for ${users.length} logins: somebody is a person twice or not at all.`);

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

  /* Suspended companies take no new work (§5) -------------------------------- */
  const suspendedWork = await prisma.project.count({ where: { company: { parentGroupId: groupId, status: "SUSPENDED" } } });
  if (suspendedWork) say(`${suspendedWork} projects belong to suspended companies.`);

  /* Provenance (§107) --------------------------------------------------------- */
  const recorded = new Set((await prisma.demoRecord.findMany({ where: { parentGroupId: groupId }, select: { entityId: true } })).map((row) => row.entityId));
  for (const company of companies) if (!recorded.has(company.id)) say(`${company.name} has no provenance record.`);
  for (const project of projects) if (!recorded.has(project.id)) say(`${project.name} has no provenance record.`);
  for (const user of users) if (!recorded.has(user.id)) say(`${user.username} has no provenance record.`);
  if (!recorded.has(groupId)) say("The group has no provenance record.");

  return findings;
}

/**
 * The people D-03 names, and what NESTO holds of them (D-03 §6-§13, §21-§25, §30, §41).
 *
 * ARMAAR's Owner, six heads of its functions and Eyes of Tirana's manager are
 * real people. `people.ts` gives them the places D-01's invented personas held —
 * the same logins, positions and memberships, NESTO's own relationships (§8, §12):
 * the Owner is the group's OWNER, a head a GROUP_HEAD position, a project manager
 * the project's manager. This step runs around the rest of the seed:
 *
 *   surveyNamedPeople   before anything is written: what each named person's record
 *                       and place hold now. A named person who is already a person
 *                       of the group under another record stops the seed (§4, §23):
 *                       it never makes somebody twice
 *   recordNamedPeople   after: provenance under D-03's keys (§21), and the report
 *                       §30 asks for — created, reused, replaced, conflict, skipped
 *
 * The group's and its companies' legal administrators (§7, §13) have no generic
 * place in NESTO. They are reported as skipped, never emulated (§41).
 */
import type { PrismaClient } from "@prisma/client";

import { memberId, positionId } from "./access";
import { COMPANY_FACTS, D03_SOURCE, GROUP_FACTS, LEGAL_ADMINISTRATORS } from "./public-facts";
import { DEPARTMENT_HEADS, PROJECT_MANAGERS } from "./provided-facts";
import { departmentName } from "./organization";
import { ARMAAR_PEOPLE, GROUP_PEOPLE, personId, personOf } from "./people";
import { PROJECTS, projectId } from "./projects";
import { ARMAAR_GROUP_ID, demoKey, nameKey, normalName, recordDemo } from "./records";

export type NamedEvent = { kind: "created" | "reused" | "replaced" | "conflict" | "skipped"; subject: string };

export type NamedSurvey = {
  /** Username → the name on its person record before this run, or null if there was none. */
  people: Map<string, string | null>;
  /** Positions of the Owner and the named heads that were active before this run. */
  positions: Set<string>;
  /** Project → the membership that managed it before this run. */
  managers: Map<string, string | null>;
};

const NAMED = ARMAAR_PEOPLE.filter((person) => person.named);
const fullName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;
const OWNER = GROUP_PEOPLE.find((person) => person.role === "OWNER")!;
const headOf = (department: string) => GROUP_PEOPLE.find((person) => person.department === department)!;
const planOf = (project: string) => PROJECTS.find((plan) => plan.code === project)!;

export async function surveyNamedPeople(prisma: PrismaClient): Promise<NamedSurvey> {
  const everyone = await prisma.personProfile.findMany({ where: { parentGroupId: ARMAAR_GROUP_ID }, select: { id: true, firstName: true, lastName: true } });
  const people = new Map<string, string | null>();
  for (const person of NAMED) {
    // The seed's own record first; then the name, exactly — never the surname alone (§23).
    const own = everyone.find((candidate) => candidate.id === personId(person.username));
    const twin = everyone.find((candidate) => candidate.id !== personId(person.username) && normalName(candidate.firstName, candidate.lastName) === normalName(person.firstName, person.lastName));
    if (twin) {
      throw new Error(
        `ARMAAR seed (D-03 §4, §23): ${fullName(person)} is already a person of the group (${twin.id}), not the demo's ${person.username}. Refusing to make them twice: resolve it in the database, then seed again.`,
      );
    }
    people.set(person.username, own ? fullName(own) : null);
  }

  const places = [positionId(OWNER.username, OWNER.department, null), ...DEPARTMENT_HEADS.map((head) => positionId(headOf(head.department).username, head.department, null))];
  const positions = new Set((await prisma.departmentAssignment.findMany({ where: { id: { in: places }, status: "ACTIVE" }, select: { id: true } })).map((row) => row.id));

  const managers = new Map<string, string | null>();
  for (const { project } of PROJECT_MANAGERS) {
    const row = await prisma.project.findUnique({ where: { id: projectId(project) }, select: { projectManagerMemberId: true } });
    managers.set(project, row?.projectManagerMemberId ?? null);
  }
  return { people, positions, managers };
}

export async function recordNamedPeople(prisma: PrismaClient, survey: NamedSurvey, conflicts: string[]): Promise<NamedEvent[]> {
  const events: NamedEvent[] = [];

  /* People (§14, §21, §35) ----------------------------------------------------- */
  for (const person of NAMED) {
    const name = fullName(person);
    const before = survey.people.get(person.username);
    if (before === null) events.push({ kind: "created", subject: `${name} (${person.username})` });
    else if (before === name) events.push({ kind: "reused", subject: `${name} (${person.username})` });
    else events.push({ kind: "replaced", subject: `${person.username}'s ${before} by ${name}` });
    await recordDemo(prisma, {
      key: demoKey("PERSON", nameKey(person.firstName, person.lastName)),
      entityType: "PersonProfile",
      entityId: personId(person.username),
      source: person.named!,
      fields: { name: person.named!, employment: "SYNTHETIC", contact: "SYNTHETIC" },
      cites: [D03_SOURCE],
      note: "Named by D-03. The employment, the work contact and everything recorded under their login are synthetic; nothing private is recorded.",
    });
  }

  /* The Owner and the heads (§6, §8, §36, §38) ----------------------------------- */
  const places = [
    { person: OWNER, key: demoKey("GROUP_OWNER", nameKey(OWNER.firstName, OWNER.lastName)), title: "Group Owner" },
    ...DEPARTMENT_HEADS.map((head) => {
      const person = headOf(head.department);
      return { person, key: demoKey("DEPT_HEAD", head.department.toUpperCase(), nameKey(head.firstName, head.lastName)), title: `head of ${departmentName(head.department)}` };
    }),
  ];
  for (const place of places) {
    const id = positionId(place.person.username, place.person.department, null);
    const held = await prisma.departmentAssignment.findUnique({ where: { id }, select: { status: true } });
    // Held by somebody else: the conflict is in the list the positions step made.
    if (held?.status !== "ACTIVE") continue;
    events.push({ kind: survey.positions.has(id) ? "reused" : "created", subject: `${place.title} ${fullName(place.person)}` });
    await recordDemo(prisma, {
      key: place.key,
      entityType: "DepartmentAssignment",
      entityId: id,
      source: place.person.named!,
      cites: [D03_SOURCE],
      note: `D-03: ${fullName(place.person)}, ${place.title}. The position's start date is synthetic.`,
    });
  }

  /* Project managers (§11, §39) ------------------------------------------------ */
  for (const { project, firstName, lastName } of PROJECT_MANAGERS) {
    const plan = planOf(project);
    const member = memberId(plan.manager, plan.company);
    const row = await prisma.project.findUniqueOrThrow({ where: { id: projectId(project) }, select: { name: true, projectManagerMemberId: true } });
    if (row.projectManagerMemberId !== member) continue;
    const before = survey.managers.get(project);
    const subject = `${row.name}'s manager ${firstName} ${lastName}`;
    if (!before) events.push({ kind: "created", subject });
    else if (before === member) events.push({ kind: "reused", subject });
    else {
      const replaced = plan.replaces?.map(personOf).find((person) => person && memberId(person.username, plan.company) === before);
      events.push({ kind: "replaced", subject: `${subject}${replaced ? `, in place of ${fullName(replaced)}` : ""}` });
    }
    const assignment = await prisma.projectMember.findUniqueOrThrow({ where: { projectId_companyMemberId: { projectId: projectId(project), companyMemberId: member } }, select: { id: true } });
    await recordDemo(prisma, {
      key: demoKey("PROJECT_MANAGER", project, nameKey(firstName, lastName)),
      entityType: "ProjectMember",
      entityId: assignment.id,
      source: "USER_PROVIDED",
      note: `D-03: ${firstName} ${lastName} manages ${row.name}. The dates and the work on it are synthetic.`,
    });
  }

  /* What NESTO cannot hold yet (§13, §41) ---------------------------------------- */
  const entity = (of: (typeof LEGAL_ADMINISTRATORS)[number]["of"]) => (of === "GROUP" ? GROUP_FACTS.legalName : COMPANY_FACTS.find((fact) => fact.code === of)!.name);
  const administrators = new Map<string, string[]>();
  for (const admin of LEGAL_ADMINISTRATORS) administrators.set(fullName(admin), [...(administrators.get(fullName(admin)) ?? []), entity(admin.of)]);
  for (const [name, entities] of administrators) events.push({ kind: "skipped", subject: `${name}, administrator of ${entities.join(", ")}` });

  for (const conflict of conflicts) events.push({ kind: "conflict", subject: conflict });
  return events;
}

/** The seed's log lines for D-03 (§30): one per kind, nothing when there is none. */
export function describeNamedPeople(events: NamedEvent[]): string[] {
  const of = (kind: NamedEvent["kind"]) => events.filter((event) => event.kind === kind).map((event) => event.subject);
  const lines: string[] = [];
  if (of("created").length) lines.push(`✓ ARMAAR named (D-03), created: ${of("created").join("; ")}`);
  if (of("reused").length) lines.push(`✓ ARMAAR named (D-03), reused: ${of("reused").join("; ")}`);
  if (of("replaced").length) lines.push(`✓ ARMAAR named (D-03), replacing D-01's personas: ${of("replaced").join("; ")}`);
  if (of("skipped").length) {
    lines.push(`– ARMAAR skipped (D-03 §41, NESTO has no legal-administrator relationship): ${of("skipped").join("; ")}`);
  }
  for (const conflict of of("conflict")) lines.push(`! ARMAAR conflict (D-03 §24, §25), left as it is: ${conflict}`);
  return lines;
}

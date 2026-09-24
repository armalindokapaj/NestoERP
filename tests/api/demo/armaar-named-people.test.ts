import { afterAll, describe, expect, it } from "vitest";

import { GROUP_DEPARTMENTS, groupDepartmentId } from "@/config/group-departments";
import { ROLE_KEYS } from "@/config/roles";
import { hashPassword } from "@/lib/auth/password";
import { buildModuleAccess } from "@/lib/context/build-context";
import { projectListQuerySchema } from "@/lib/modules/projects/project.schema";
import { getProject, listProjects } from "@/lib/modules/projects/project.service";
import { memberId, positionId } from "../../../prisma/seed/armaar/access";
import { companyId } from "../../../prisma/seed/armaar/organization";
import { ARMAAR_PEOPLE, GROUP_PEOPLE, personId, userId } from "../../../prisma/seed/armaar/people";
import { projectId } from "../../../prisma/seed/armaar/projects";
import { DEPARTMENT_HEADS, PROJECT_MANAGERS } from "../../../prisma/seed/armaar/provided-facts";
import { COMPANY_FACTS, GROUP_OWNER, LEGAL_ADMINISTRATORS } from "../../../prisma/seed/armaar/public-facts";
import { normalName } from "../../../prisma/seed/armaar/records";
import { armaarPassword, seedArmaar } from "../../../prisma/seed/armaar/seed";
import { cleanupSessions, loginAsMembership, prisma } from "../../helpers";

/**
 * The people D-03 names, as NESTO holds them: the Owner, six heads of the
 * group's functions and Eyes of Tirana's manager, each one person, in NESTO's
 * own relationships and nothing more (§35-§40); what it cannot hold — the
 * legal administrators — not emulated (§41); a place somebody else holds left
 * to them and reported (§24, §25); twice the same (§22, §40).
 */

const ARMAAR = "armaar_group";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const IDEAL = "IDEAL_CONSTRUCTION" as const;
const EYES = projectId("EYES_OF_TIRANA");
const NAMED = ARMAAR_PEOPLE.filter((person) => person.named);
const full = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;
const headOf = (department: string) => GROUP_PEOPLE.find((person) => person.department === department)!;

async function reseed() {
  // ARMAAR's own rows only: the steps over every group's rows run beside other suites' writes.
  return seedArmaar(prisma, await hashPassword(armaarPassword()), { shared: false });
}

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("the people D-03 names", () => {
  it("are each one person of the group, with nothing private made up for them (§4, §14, §15, §35)", async () => {
    const everyone = await prisma.personProfile.findMany({
      where: { parentGroupId: ARMAAR },
      select: { id: true, firstName: true, lastName: true, workPhone: true, personalEmail: true, personalPhone: true, dateOfBirth: true, address: true, city: true, country: true, user: { select: { username: true, phone: true } } },
    });
    const named = (first: string, last: string) => everyone.filter((person) => normalName(person.firstName, person.lastName) === normalName(first, last));
    expect(NAMED.map(full).sort()).toEqual(
      [full(GROUP_OWNER), ...DEPARTMENT_HEADS.map(full), ...PROJECT_MANAGERS.map(full)].sort(),
    );
    for (const person of NAMED) {
      const [record, ...twins] = named(person.firstName, person.lastName);
      expect(twins, full(person)).toEqual([]);
      expect(record, full(person)).toMatchObject({ id: personId(person.username), user: { username: person.username, phone: null } });
      expect(record, full(person)).toMatchObject({ workPhone: null, personalEmail: null, personalPhone: null, dateOfBirth: null, address: null, city: null, country: null });
      expect(await prisma.compensation.count({ where: { employeeProfile: { personProfileId: record!.id } } }), full(person)).toBe(0);
    }
    // The three D-03 has in more than one relationship are still one person each (§15).
    for (const [first, last] of [["Xhejsi", "Lilo"], ["Adela", "Dervishaj"], ["Migena", "Bajro"]] as const) {
      expect(named(first, last), `${first} ${last}`).toHaveLength(1);
    }
  });

  it("hold no login for being a legal administrator: NESTO has no such relationship, so none is made (§5, §17, §37, §41)", async () => {
    const onlyAdministrators = LEGAL_ADMINISTRATORS.filter((admin) => !NAMED.some((person) => full(person) === full(admin)));
    expect(new Set(onlyAdministrators.map(full))).toEqual(new Set(["Klaisi Çela", "Kopi Gusho", "Xhensila Pupa", "Gentiana Lilo"]));
    for (const admin of onlyAdministrators) {
      expect(await prisma.personProfile.count({ where: { parentGroupId: ARMAAR, firstName: admin.firstName, lastName: admin.lastName } }), full(admin)).toBe(0);
      expect(await prisma.user.count({ where: { firstName: admin.firstName, lastName: admin.lastName } }), full(admin)).toBe(0);
    }
  });

  it("have the Owner as one person in the group's Owner place, with nothing on the platform (§6, §18, §36)", async () => {
    const owners = await prisma.departmentAssignment.findMany({
      where: { parentGroupId: ARMAAR, status: "ACTIVE", positionLevel: "GROUP_HEAD", functionalRoleKey: "OWNER" },
      select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } },
    });
    expect(owners).toHaveLength(1);
    expect(full(owners[0]!.user)).toBe(full(GROUP_OWNER));
    const owner = owners[0]!.user.id;
    expect(await prisma.platformAccess.count({ where: { userId: owner } })).toBe(0);
    // The Owner's logins carry the Owner's role and no other.
    const roles = await prisma.companyMember.findMany({ where: { userId: owner }, select: { role: { select: { key: true } } } });
    expect(new Set(roles.map((row) => row.role.key))).toEqual(new Set(["OWNER"]));
    // The group's administrator in law is somebody else, and not held here (§18).
    expect(full(owners[0]!.user)).not.toBe(full(LEGAL_ADMINISTRATORS.find((admin) => admin.of === "GROUP")!));
  });

  it("have each head in NESTO's own head position for their function, with one of NESTO's roles (§8, §10, §38)", async () => {
    for (const head of DEPARTMENT_HEADS) {
      const held = await prisma.departmentAssignment.findMany({
        where: { groupDepartmentId: groupDepartmentId(ARMAAR, head.department), status: "ACTIVE", positionLevel: "GROUP_HEAD" },
        select: { id: true, functionalRoleKey: true, companyId: true, user: { select: { firstName: true, lastName: true } } },
      });
      expect(held, head.department).toHaveLength(1);
      expect(full(held[0]!.user), head.department).toBe(full(head));
      expect(held[0]).toMatchObject({ id: positionId(headOf(head.department).username, head.department, null), companyId: null });
      expect(ROLE_KEYS, head.department).toContain(held[0]!.functionalRoleKey);
      expect(GROUP_DEPARTMENTS.find((department) => department.key === head.department)!.roles).toContain(held[0]!.functionalRoleKey);
    }
  });

  it("gain nothing in another function's modules by heading their own (§16, §31)", async () => {
    // What heading a function adds, as the product defines it (E-06 §7, E-13): running the department, for
    // every head; for Architecture also publishing units, E-05D's architecture manager's call. Nothing else.
    const HEAD_ONLY = new Set(["organization"]);
    const FUNCTION_EXTRAS: Record<string, RegExp> = { architecture: /^project\.unit\.(publish|unpublish|archive|revision_request)$/ };
    for (const head of DEPARTMENT_HEADS) {
      const person = headOf(head.department);
      const context = await loginAsMembership(memberId(person.username, BCI));
      expect(context.position, full(head)).toBe("GROUP_HEAD");
      // The same role without the position.
      const member = buildModuleAccess(context.role, context.enabledModules, "MEMBER");
      const own = new Set<string>(GROUP_DEPARTMENTS.find((department) => department.key === head.department)!.modules);
      const others = new Set<string>(GROUP_DEPARTMENTS.flatMap((department) => department.modules).filter((module) => !own.has(module) && !HEAD_ONLY.has(module)));
      for (const key of others) {
        const moduleKey = key as keyof typeof member;
        const gained = context.moduleAccess[moduleKey].permissions.filter(
          (permission) => !member[moduleKey].permissions.includes(permission) && !FUNCTION_EXTRAS[head.department]?.test(permission),
        );
        expect(gained, `${full(head)} in ${key}`).toEqual([]);
        expect(context.moduleAccess[moduleKey].accessLevel, `${full(head)} in ${key}`).toBe(member[moduleKey].accessLevel);
      }
    }
    // Group Finance Head ≠ Legal Head ≠ HR Head (§16).
    const perms = async (department: string) => (await loginAsMembership(memberId(headOf(department).username, BCI))).permissions;
    expect(await perms("finance")).not.toContain("legal.manage");
    expect(await perms("finance")).not.toContain("hr.manage");
    expect(await perms("legal")).not.toContain("finance.manage");
    expect(await perms("hr")).not.toContain("finance.manage");
    expect(await perms("hr")).not.toContain("legal.manage");
  });

  it("have Eyes of Tirana's manager through the project's own team, the one primary member (§11, §12, §19, §39)", async () => {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: EYES },
      select: {
        companyId: true,
        projectManager: { select: { id: true, role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } } } },
        members: { where: { status: "ACTIVE" }, select: { companyMemberId: true, isPrimary: true, projectRole: true } },
      },
    });
    expect(project.companyId).toBe(companyId(IDEAL));
    expect(full(project.projectManager!.user)).toBe(full(PROJECT_MANAGERS[0]!));
    expect(project.projectManager).toMatchObject({ id: memberId("unico.pm", IDEAL), role: { key: "PROJECT_MANAGER" } });
    expect(project.members.filter((member) => member.isPrimary)).toEqual([{ companyMemberId: memberId("unico.pm", IDEAL), isPrimary: true, projectRole: "Project Manager" }]);
    // D-01's manager stays on the team, in the role she has.
    expect(project.members).toContainEqual({ companyMemberId: memberId("unico.coordinator", IDEAL), isPrimary: false, projectRole: "Technical Coordinator" });
  });

  it("let Eyes of Tirana's manager into Eyes of Tirana and no other project (§31)", async () => {
    const unrelated = "test_d03_unrelated_project";
    await prisma.project.create({ data: { id: unrelated, companyId: companyId(IDEAL), code: "D03-X", name: "D-03 unrelated project", createdBy: userId("ideal.director") } });
    try {
      const manager = await loginAsMembership(memberId("unico.pm", IDEAL));
      const listed = await listProjects(manager, projectListQuerySchema.parse({}));
      expect(listed.data.map((row) => row.id)).toEqual([EYES]);
      await expect(getProject(manager, unrelated)).rejects.toThrow();
      await expect(getProject(manager, projectId("TIRANA_LAKE"))).rejects.toThrow();
      // The company's director reads it: the manager's not reaching it is the project scope, not an empty company.
      const director = await loginAsMembership(memberId("ideal.director", IDEAL));
      await expect(getProject(director, unrelated)).resolves.toMatchObject({ id: unrelated });
    } finally {
      await prisma.project.delete({ where: { id: unrelated } });
    }
  });

  it("carry D-03's keys and sources in the provenance records (§3, §21)", async () => {
    const record = (key: string) => prisma.demoRecord.findUniqueOrThrow({ where: { key } });
    expect(await record("ARMAAR:PERSON:ARMAND_LILO")).toMatchObject({ entityType: "PersonProfile", entityId: personId("armaar.owner"), sourceType: "PUBLIC", sourceVerifiedAt: expect.any(Date), sourceLabel: expect.stringMatching(/D-03/) });
    expect(await record("ARMAAR:GROUP_OWNER:ARMAND_LILO")).toMatchObject({ entityType: "DepartmentAssignment", entityId: positionId("armaar.owner", "executive", null), sourceType: "PUBLIC" });
    for (const head of DEPARTMENT_HEADS) {
      const key = `${head.firstName}_${head.lastName}`.toUpperCase();
      // Supplied, not verified: no verification date (§3).
      expect(await record(`ARMAAR:PERSON:${key}`)).toMatchObject({ sourceType: "USER_PROVIDED", sourceVerifiedAt: null, sourceLabel: expect.stringMatching(/supplied by NESTO's owner/) });
      expect(await record(`ARMAAR:DEPT_HEAD:${head.department.toUpperCase()}:${key}`)).toMatchObject({ entityType: "DepartmentAssignment", sourceType: "USER_PROVIDED" });
    }
    const manager = await record("ARMAAR:PROJECT_MANAGER:EYES_OF_TIRANA:TEDI_GOGU");
    expect(manager).toMatchObject({ entityType: "ProjectMember", sourceType: "USER_PROVIDED" });
    expect(await prisma.projectMember.findUniqueOrThrow({ where: { id: manager.entityId }, select: { companyMemberId: true } })).toEqual({ companyMemberId: memberId("unico.pm", IDEAL) });
    // A named person's login: the name theirs, the rest synthetic.
    expect((await record("ARMAAR:PERSON:armaar.finance")).fieldSources).toMatchObject({ name: "USER_PROVIDED", login: "SYNTHETIC", activity: "SYNTHETIC" });
    expect((await record("ARMAAR:PERSON:bci.director")).sourceType).toBe("SYNTHETIC");
    // Every company's NIPT is D-03's public one.
    for (const fact of COMPANY_FACTS) {
      expect(fact.registrationNumber, fact.name).toMatch(/^[A-Z]\d{8}[A-Z]$/);
      const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId(fact.code) }, select: { registrationNumber: true } });
      expect(company.registrationNumber, fact.name).toBe(fact.registrationNumber);
      const provenance = await prisma.demoRecord.findUniqueOrThrow({ where: { key: `ARMAAR:COMPANY:${fact.code}` } });
      expect(provenance.fieldSources, fact.name).toMatchObject({ registrationNumber: "PUBLIC" });
      expect(provenance.sourceLabel, fact.name).toMatch(/D-03/);
    }
  });

  it("are the same people in the same places when seeded again (§22, §40)", async () => {
    const snapshot = async () => ({
      people: await prisma.personProfile.findMany({ where: { parentGroupId: ARMAAR }, select: { id: true, firstName: true, lastName: true }, orderBy: { id: "asc" } }),
      heads: await prisma.departmentAssignment.findMany({ where: { parentGroupId: ARMAAR, status: "ACTIVE", positionLevel: "GROUP_HEAD" }, select: { id: true, userId: true }, orderBy: { id: "asc" } }),
      primary: await prisma.projectMember.findMany({ where: { projectId: EYES, isPrimary: true }, select: { id: true, companyMemberId: true } }),
      records: await prisma.demoRecord.findMany({ where: { parentGroupId: ARMAAR }, select: { key: true, entityId: true }, orderBy: { key: "asc" } }),
    });
    const before = await snapshot();
    const counts = await reseed();
    expect(await snapshot()).toEqual(before);
    expect(counts.named.filter((event) => event.kind === "created" || event.kind === "replaced" || event.kind === "conflict")).toEqual([]);
    expect(counts.named.filter((event) => event.kind === "skipped")).toHaveLength(7);
  }, 120_000);

  it("leave a head the product appointed since, and say so (§24)", async () => {
    const ours = positionId("armaar.finance", "finance", null);
    const theirs = "test_d03_finance_head";
    await prisma.departmentAssignment.update({ where: { id: ours }, data: { status: "INACTIVE" } });
    await prisma.departmentAssignment.create({
      data: { id: theirs, parentGroupId: ARMAAR, userId: userId("bci.finance"), groupDepartmentId: groupDepartmentId(ARMAAR, "finance"), functionalRoleKey: "FINANCE", positionLevel: "GROUP_HEAD", accessLevel: "MANAGE", status: "ACTIVE" },
    });
    try {
      await expect(reseed()).rejects.toThrow(/conflict, left as it is: the head of Finance is Enkeleda Pasha \(bci\.finance\), appointed in the product/);
      expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: theirs }, select: { status: true } })).toEqual({ status: "ACTIVE" });
      expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: ours }, select: { status: true } })).toEqual({ status: "INACTIVE" });
    } finally {
      await prisma.departmentAssignment.delete({ where: { id: theirs } });
      await prisma.departmentAssignment.update({ where: { id: ours }, data: { status: "ACTIVE" } });
    }
  }, 120_000);

  it("leave a project manager the product appointed since, and never make two (§25)", async () => {
    await prisma.project.update({ where: { id: EYES }, data: { projectManagerMemberId: memberId("ideal.director", IDEAL) } });
    try {
      await expect(reseed()).rejects.toThrow(/conflict, left as it is: Eyes of Tirana's manager is Florian Kaja \(ideal\.director\)/);
      const project = await prisma.project.findUniqueOrThrow({ where: { id: EYES }, select: { projectManagerMemberId: true, members: { where: { isPrimary: true }, select: { companyMemberId: true } } } });
      expect(project.projectManagerMemberId).toBe(memberId("ideal.director", IDEAL));
      expect(project.members.map((member) => member.companyMemberId)).not.toContain(memberId("unico.pm", IDEAL));
    } finally {
      await prisma.project.update({ where: { id: EYES }, data: { projectManagerMemberId: memberId("unico.pm", IDEAL) } });
      await reseed();
    }
  }, 180_000);

  it("stop before making a named person twice (§4, §23)", async () => {
    const twin = "test_d03_twin";
    await prisma.personProfile.create({ data: { id: twin, parentGroupId: ARMAAR, firstName: "Edvin", lastName: "GACE" } });
    try {
      await expect(reseed()).rejects.toThrow(/Edvin Gace is already a person of the group \(test_d03_twin\), not the demo's armaar\.finance/);
      expect(await prisma.personProfile.count({ where: { parentGroupId: ARMAAR, firstName: { equals: "Edvin", mode: "insensitive" }, lastName: { equals: "Gace", mode: "insensitive" } } })).toBe(2);
    } finally {
      await prisma.personProfile.delete({ where: { id: twin } });
    }
  }, 120_000);
});

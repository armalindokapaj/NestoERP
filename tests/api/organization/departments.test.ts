import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import {
  addDepartmentMember,
  appointCompanyManager,
  appointGroupHead,
  endDepartmentAssignment,
  moveDepartmentMember,
} from "@/lib/modules/organization/departments/department.assignment.service";
import {
  activateInCompanies,
  createGroupDepartment,
  deactivateInCompany,
  setGroupDepartmentStatus,
  updateGroupDepartment,
} from "@/lib/modules/organization/departments/department.config.service";
import {
  getCompanyDepartments,
  getDepartmentActivity,
  getDepartmentDetail,
  getDepartmentTeam,
  listBranchMembers,
  listDepartmentCandidates,
  listGroupDepartments,
  personDepartmentPlaces,
} from "@/lib/modules/organization/departments/department.query";
import { createDepartmentSchema, teamQuerySchema, updateDepartmentSchema } from "@/lib/modules/organization/departments/department.schema";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { updateMemberSchema } from "@/lib/modules/team/team.schema";
import * as team from "@/lib/modules/team/team.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Group and company department management (E-13 §8-§47, §66, §79-§90,
 * §107-§122, §136, §137; ADR 0003).
 *
 * Departments are defined once for the group and activated per company, as
 * the same branch every time; one head per department and one manager per
 * branch, replaced only on purpose and kept as history; members are existing
 * people, placed in as many companies as they cover, and nothing else is
 * created for them. Who may do what is the Owner's, Group IT's, a head's or a
 * manager's, each within their own reach — never across groups.
 */

const GROUP = "group_demo_nesto";
const gd = (key: string) => `${GROUP}:${key}`;
const startedAt = new Date();

let owner: UserContext;
let groupIt: UserContext;
let financeHead: UserContext;
let formaFinanceManager: UserContext;
let financeA: UserContext;
let tenantOwner: UserContext;

const personOf = async (username: string) => (await prisma.user.findUniqueOrThrow({ where: { username }, select: { personProfileId: true } })).personProfileId!;
const userOf = async (username: string) => (await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } })).id;
const branchOf = async (companyId: string, key: string) => (await prisma.department.findFirstOrThrow({ where: { companyId, key }, select: { id: true } })).id;
const activeHeads = (groupDepartmentId: string) => prisma.departmentAssignment.count({ where: { groupDepartmentId, positionLevel: "GROUP_HEAD", status: "ACTIVE" } });

let branchSnapshot: Array<{ id: string; status: string; managerMemberId: string | null; name: string }> = [];
let homeSnapshot: Array<{ id: string; departmentId: string | null }> = [];

beforeAll(async () => {
  [owner, groupIt, financeHead, formaFinanceManager, financeA, tenantOwner] = await Promise.all([
    loginAs("OWNER"),
    loginAs("GROUP_IT"),
    loginAs("FINANCE"),
    loginAsEmail("finance-manager-d@nesto.test"),
    loginAsEmail(DEMO_EMAIL.financeA),
    loginAsEmail(DEMO_EMAIL.tenantOwner),
  ]);
  branchSnapshot = await prisma.department.findMany({ where: { company: { parentGroupId: GROUP } }, select: { id: true, status: true, managerMemberId: true, name: true } });
  homeSnapshot = await prisma.companyMember.findMany({ where: { company: { parentGroupId: GROUP } }, select: { id: true, departmentId: true } });
});

afterAll(async () => {
  // Everything this file made goes; everything it ended or moved comes back.
  await prisma.notificationEventOutbox.deleteMany({ where: { createdAt: { gte: startedAt }, eventType: { startsWith: "DEPARTMENT_" } } });
  await prisma.auditEvent.deleteMany({ where: { occurredAt: { gte: startedAt }, moduleKey: "organization" } });
  await prisma.auditEvent.deleteMany({ where: { occurredAt: { gte: startedAt }, actionKey: { startsWith: "TEAM_MEMBER_" } } });
  await prisma.activity.deleteMany({ where: { createdAt: { gte: startedAt }, module: "team" } });
  await prisma.departmentAssignment.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.departmentAssignment.updateMany({ where: { createdAt: { lt: startedAt }, endsAt: { gte: startedAt } }, data: { status: "ACTIVE", endsAt: null, endedByUserId: null } });
  for (const row of homeSnapshot) await prisma.companyMember.update({ where: { id: row.id }, data: { departmentId: row.departmentId } });
  for (const row of branchSnapshot) await prisma.department.update({ where: { id: row.id }, data: { status: row.status as "ACTIVE", managerMemberId: row.managerMemberId, name: row.name } });
  const created = await prisma.groupDepartment.findMany({ where: { parentGroupId: GROUP, createdAt: { gte: startedAt } }, select: { id: true } });
  await prisma.department.deleteMany({ where: { groupDepartmentId: { in: created.map((row) => row.id) } } });
  await prisma.groupDepartment.deleteMany({ where: { id: { in: created.map((row) => row.id) } } });
  await prisma.groupDepartment.updateMany({ where: { parentGroupId: GROUP }, data: { status: "ACTIVE" } });
  await cleanupSessions();
});

/* -------------------------------------------------------------------------- */

describe("group departments (§8-§10, §40, §80, §113)", () => {
  it("are created once for the group, with a code unique in it, and audited", async () => {
    const { id } = await createGroupDepartment(memberActor(owner), createDepartmentSchema.parse({ name: "Administration", code: "adm", description: "Offices and fleet." }));
    const row = await prisma.groupDepartment.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ parentGroupId: GROUP, code: "ADM", name: "Administration", status: "ACTIVE", key: "custom-adm", createdByUserId: owner.userId });
    expect(await prisma.auditEvent.count({ where: { entityType: "GroupDepartment", entityId: id, actionKey: "ORGANIZATION_GROUP_DEPARTMENT_CREATED", parentGroupId: GROUP } })).toBe(1);

    await expect(createGroupDepartment(memberActor(owner), createDepartmentSchema.parse({ name: "Admin Two", code: "ADM" }))).rejects.toMatchObject({ code: "CONFLICT", message: "Department code already exists." });
    await expect(createGroupDepartment(memberActor(groupIt), createDepartmentSchema.parse({ name: "administration", code: "ADM2" }))).rejects.toMatchObject({ code: "CONFLICT" });
    // The chart's own codes are taken too.
    await expect(createGroupDepartment(memberActor(owner), createDepartmentSchema.parse({ name: "Money", code: "fin" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("are configured by the Owner and Group IT, never by a head, a CEO or a member (§52-§54, §109)", async () => {
    const input = createDepartmentSchema.parse({ name: "Facilities", code: "FAC" });
    await expect(createGroupDepartment(memberActor(financeHead), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createGroupDepartment(memberActor(await loginAs("CEO")), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createGroupDepartment(memberActor(financeA), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Group IT configures (§53).
    const { id } = await createGroupDepartment(memberActor(groupIt), input);
    expect(await prisma.groupDepartment.count({ where: { id, parentGroupId: GROUP } })).toBe(1);
  });

  it("rename every branch with them, and keep the code editable (§34)", async () => {
    const adm = (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: GROUP, code: "ADM" } })).id;
    await activateInCompanies(memberActor(owner), adm, [COMPANY.a]);
    await updateGroupDepartment(memberActor(owner), adm, updateDepartmentSchema.parse({ name: "Administration & Fleet", code: "ADMF" }));
    expect(await prisma.groupDepartment.findUniqueOrThrow({ where: { id: adm } })).toMatchObject({ name: "Administration & Fleet", code: "ADMF", key: "custom-adm" });
    expect((await prisma.department.findFirstOrThrow({ where: { groupDepartmentId: adm, companyId: COMPANY.a } })).name).toBe("Administration & Fleet");
    // A head of Finance edits no department, Legal least of all (§109).
    await expect(updateGroupDepartment(memberActor(financeHead), gd("legal"), updateDepartmentSchema.parse({ description: "x" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list with their code, head, active companies and people (§32, §132)", async () => {
    const list = await listGroupDepartments(memberActor(owner));
    const finance = list.find((row) => row.key === "finance")!;
    expect(finance).toMatchObject({ code: "FIN", status: "ACTIVE", bindsRoles: true, activeCompanyCount: 5 });
    expect(finance.groupHead?.name).toBe("Fiona Blake");
    expect(finance.memberCount).toBeGreaterThanOrEqual(5);
    expect(list.find((row) => row.code === "ADMF")?.bindsRoles).toBe(false);
  });
});

describe("company branches (§14-§19, §78, §81, §107, §114, §115, §137)", () => {
  it("activate once, again without a duplicate, and deactivate and reactivate as the same branch", async () => {
    const fac = (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: GROUP, code: "FAC" } })).id;
    const [first] = await activateInCompanies(memberActor(groupIt), fac, [COMPANY.b]);
    expect(first).toMatchObject({ companyId: COMPANY.b, changed: true });
    const [again] = await activateInCompanies(memberActor(groupIt), fac, [COMPANY.b]);
    expect(again).toMatchObject({ companyDepartmentId: first!.companyDepartmentId, changed: false });
    expect(await prisma.department.count({ where: { groupDepartmentId: fac, companyId: COMPANY.b } })).toBe(1);

    await deactivateInCompany(memberActor(groupIt), fac, COMPANY.b);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: first!.companyDepartmentId } })).status).toBe("INACTIVE");
    const [back] = await activateInCompanies(memberActor(groupIt), fac, [COMPANY.b], { requireExisting: true });
    expect(back).toMatchObject({ companyDepartmentId: first!.companyDepartmentId, changed: true });

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: fac, companyId: COMPANY.b }, select: { actionKey: true }, orderBy: { occurredAt: "asc" } })).map((row) => row.actionKey);
    expect(actions).toEqual(["ORGANIZATION_COMPANY_DEPARTMENT_ACTIVATED", "ORGANIZATION_COMPANY_DEPARTMENT_DEACTIVATED", "ORGANIZATION_COMPANY_DEPARTMENT_REACTIVATED"]);
  });

  it("are never activated across groups, whoever asks (§81, §107)", async () => {
    const fac = (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: GROUP, code: "FAC" } })).id;
    await expect(activateInCompanies(memberActor(owner), fac, [COMPANY.tenant])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(activateInCompanies(memberActor(tenantOwner), fac, [COMPANY.tenant])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.department.count({ where: { groupDepartmentId: fac, companyId: COMPANY.tenant } })).toBe(0);
  });

  it("are not a head's or a manager's to activate (§54, §55)", async () => {
    await expect(activateInCompanies(memberActor(financeHead), gd("finance"), [COMPANY.a])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deactivateInCompany(memberActor(formaFinanceManager), gd("finance"), COMPANY.d)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("show a company every department of the group, active or not activated there (§39, §98)", async () => {
    const view = await getCompanyDepartments(memberActor(owner), COMPANY.c);
    expect(view.rows.find((row) => row.department.code === "FIN")?.branch?.manager?.name).toBe("Fiona Blake");
    const fac = view.rows.find((row) => row.department.code === "FAC")!;
    expect(fac.branch).toBeNull();
    expect(fac.canActivate).toBe(true);
    await expect(getCompanyDepartments(memberActor(tenantOwner), COMPANY.c)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("an inactive department or branch takes nobody new (§89, §90, §122)", () => {
  it("refuses activation, a head and a member while the department is inactive, and keeps its branches", async () => {
    const fac = (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: GROUP, code: "FAC" } })).id;
    await setGroupDepartmentStatus(memberActor(groupIt), fac, "INACTIVE");
    await expect(activateInCompanies(memberActor(owner), fac, [COMPANY.c])).rejects.toMatchObject({ code: "CONFLICT", details: { code: "DEPARTMENT_INACTIVE" } });
    await expect(appointGroupHead(memberActor(owner), fac, { personId: await personOf("ceo-b"), replace: false })).rejects.toMatchObject({ details: { code: "DEPARTMENT_INACTIVE" } });
    const branch = await branchOf(COMPANY.b, "custom-fac");
    await expect(addDepartmentMember(memberActor(owner), branch, { personId: await personOf("pm-b") })).rejects.toMatchObject({ details: { code: "DEPARTMENT_INACTIVE" } });
    expect((await prisma.department.findUniqueOrThrow({ where: { id: branch } })).status).toBe("ACTIVE");
    await setGroupDepartmentStatus(memberActor(groupIt), fac, "ACTIVE");
  });

  it("refuses a member in an inactive branch, and a manager of one widens nothing until it reopens", async () => {
    const legalE = await branchOf(COMPANY.e, "legal");
    expect((await loginAsEmail("legal-manager-e@nesto.test")).position).toBe("COMPANY_MANAGER");
    await deactivateInCompany(memberActor(owner), gd("legal"), COMPANY.e);
    await expect(addDepartmentMember(memberActor(owner), legalE, { personId: await personOf("pm-e") })).rejects.toMatchObject({ details: { code: "BRANCH_INACTIVE" } });
    expect((await loginAsEmail("legal-manager-e@nesto.test")).position).toBe("MEMBER");
    await activateInCompanies(memberActor(owner), gd("legal"), [COMPANY.e]);
    expect((await loginAsEmail("legal-manager-e@nesto.test")).position).toBe("COMPANY_MANAGER");
  });
});

describe("group heads (§11-§13, §66, §116, §136)", () => {
  it("are one per department: a second is refused unless it replaces the first, which ends as history", async () => {
    const projects = gd("projects");
    const pmB = await personOf("pm-b");
    const pmC = await personOf("pm-c");
    const first = await appointGroupHead(memberActor(owner), projects, { personId: pmB, replace: false });
    expect((await loginAsEmail(DEMO_EMAIL.pmB)).position).toBe("GROUP_HEAD");

    await expect(appointGroupHead(memberActor(owner), projects, { personId: pmC, replace: false })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "HEAD_EXISTS" } });
    const second = await appointGroupHead(memberActor(owner), projects, { personId: pmC, replace: true });
    expect(await activeHeads(projects)).toBe(1);
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: first.assignmentId } })).toMatchObject({ status: "INACTIVE", endedByUserId: owner.userId });
    expect((await loginAsEmail(DEMO_EMAIL.pmB)).position).toBe("MEMBER");

    const changed = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: projects, actionKey: "ORGANIZATION_GROUP_DEPARTMENT_HEAD_CHANGED" } });
    expect(changed.beforeJson).toMatchObject({ assignmentId: first.assignmentId, personId: pmB, personName: expect.any(String) });
    expect(changed.afterJson).toMatchObject({ assignmentId: second.assignmentId, personId: pmC });
    // Both are told (§93).
    const told = await prisma.notificationEventOutbox.findMany({ where: { entityId: projects, createdAt: { gte: startedAt } }, select: { eventType: true } });
    expect(told.map((row) => row.eventType)).toEqual(expect.arrayContaining(["DEPARTMENT_HEAD_ASSIGNED", "DEPARTMENT_ASSIGNMENT_CHANGED"]));

    await endDepartmentAssignment(memberActor(owner), second.assignmentId);
    expect(await activeHeads(projects)).toBe(0);
  });

  it("cannot be two at once, however the requests race (§136)", async () => {
    const projects = gd("projects");
    const outcomes = await Promise.allSettled([
      appointGroupHead(memberActor(owner), projects, { personId: await personOf("pm-d"), replace: true }),
      appointGroupHead(memberActor(owner), projects, { personId: await personOf("pm-e"), replace: true }),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(await activeHeads(projects)).toBe(1);
    const winner = await prisma.departmentAssignment.findFirstOrThrow({ where: { groupDepartmentId: projects, positionLevel: "GROUP_HEAD", status: "ACTIVE" } });
    await endDepartmentAssignment(memberActor(owner), winner.id);
  });

  it("must work as the function, and are the Owner's to appoint — not a head's or Group IT's (§13, §53)", async () => {
    await expect(appointGroupHead(memberActor(owner), gd("finance"), { personId: await personOf("qaqc-b"), replace: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "ROLE_MISMATCH" } });
    await expect(appointGroupHead(memberActor(financeHead), gd("finance"), { personId: await personOf("finance-c"), replace: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appointGroupHead(memberActor(groupIt), gd("finance"), { personId: await personOf("finance-c"), replace: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await activeHeads(gd("finance"))).toBe(1);
  });
});

describe("company managers (§20, §22, §66, §110, §117)", () => {
  it("are appointed by the function's head in any company, named on the branch, replaced only on purpose", async () => {
    const financeB = await branchOf(COMPANY.b, "finance");
    const { assignmentId } = await appointCompanyManager(memberActor(financeHead), financeB, { personId: await personOf("finance-b"), replace: false });
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).toMatchObject({ positionLevel: "COMPANY_MANAGER", companyId: COMPANY.b, companyDepartmentId: financeB, functionalRoleKey: "FINANCE" });
    expect((await prisma.department.findUniqueOrThrow({ where: { id: financeB } })).managerMemberId).toBe("member_finance_b");
    // Audited in the company it happened in (E-06 §161).
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { entityId: gd("finance"), actionKey: "ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_ASSIGNED" }, orderBy: { occurredAt: "desc" } })).companyId).toBe(COMPANY.b);

    await expect(appointCompanyManager(memberActor(financeHead), financeB, { personId: await personOf("group-finance"), replace: false })).rejects.toMatchObject({ details: { code: "MANAGER_EXISTS" } });
    await appointCompanyManager(memberActor(financeHead), financeB, { personId: await personOf("group-finance"), replace: true });
    expect(await prisma.departmentAssignment.count({ where: { companyDepartmentId: financeB, positionLevel: "COMPANY_MANAGER", status: "ACTIVE" } })).toBe(1);
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).toMatchObject({ status: "INACTIVE" });
    expect((await prisma.department.findUniqueOrThrow({ where: { id: financeB } })).managerMemberId).not.toBe("member_finance_b");
  });

  it("stay within their own company: Forma's Finance manager reaches nothing of Meridian's (§110)", async () => {
    const financeB = await branchOf(COMPANY.b, "finance");
    await expect(appointCompanyManager(memberActor(formaFinanceManager), financeB, { personId: await personOf("finance-b"), replace: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addDepartmentMember(memberActor(formaFinanceManager), financeB, { personId: await personOf("pm-b") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listBranchMembers(memberActor(formaFinanceManager), financeB)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("are not a local manager's to make, even in their own branch (E-06 §37)", async () => {
    await expect(appointCompanyManager(memberActor(formaFinanceManager), await branchOf(COMPANY.d, "finance"), { personId: await personOf("group-finance"), replace: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("are not a head's to make in another function, nor Group IT's (§53, §109)", async () => {
    await expect(appointCompanyManager(memberActor(financeHead), await branchOf(COMPANY.b, "qaqc"), { personId: await personOf("qaqc-b"), replace: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appointCompanyManager(memberActor(groupIt), await branchOf(COMPANY.b, "finance"), { personId: await personOf("finance-b"), replace: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("members (§23-§31, §45, §47, §79, §83, §85, §119, §120)", () => {
  it("are existing people: one place, and no login, employment, membership or project is made for them", async () => {
    const formaFinance = await branchOf(COMPANY.d, "finance");
    const pmD = await personOf("pm-d");
    const before = { users: await prisma.user.count(), employees: await prisma.employeeProfile.count(), members: await prisma.companyMember.count(), projects: await prisma.projectMember.count(), grants: await prisma.accessGrant.count() };

    const { assignmentId } = await addDepartmentMember(memberActor(formaFinanceManager), formaFinance, { personId: pmD });
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).toMatchObject({ positionLevel: "MEMBER", companyId: COMPANY.d, companyDepartmentId: formaFinance, userId: await userOf("pm-d") });
    expect({ users: await prisma.user.count(), employees: await prisma.employeeProfile.count(), members: await prisma.companyMember.count(), projects: await prisma.projectMember.count(), grants: await prisma.accessGrant.count() }).toEqual(before);
    // Being in Finance widens nothing (§59): pm-d still works as a project manager, with no Finance access.
    const pmDContext = await loginAsEmail("pm-d@nesto.test");
    expect(pmDContext.position).toBe("MEMBER");
    // Their home stays where it was: this is a second place.
    expect((await prisma.companyMember.findFirstOrThrow({ where: { userId: await userOf("pm-d"), companyId: COMPANY.d } })).departmentId).toBe(await branchOf(COMPANY.d, "projects"));

    await expect(addDepartmentMember(memberActor(formaFinanceManager), formaFinance, { personId: pmD })).rejects.toMatchObject({ details: { code: "ALREADY_MEMBER" } });

    await endDepartmentAssignment(memberActor(formaFinanceManager), assignmentId);
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).toMatchObject({ status: "INACTIVE", endedByUserId: formaFinanceManager.userId });
    expect(await prisma.companyMember.count({ where: { userId: await userOf("pm-d"), companyId: COMPANY.d, status: "ACTIVE" } })).toBe(1);
  });

  it("cover several companies as one person when they work for the whole group, and only then (§27, §28, §120)", async () => {
    const hrHead = await personOf("group-hr");
    const a = await addDepartmentMember(memberActor(owner), await branchOf(COMPANY.a, "finance"), { personId: hrHead });
    const c = await addDepartmentMember(memberActor(owner), await branchOf(COMPANY.c, "finance"), { personId: hrHead });
    const team = await getDepartmentTeam(memberActor(owner), gd("finance"), teamQuerySchema.parse({}));
    const row = team.data.find((member) => member.person.personId === hrHead)!;
    expect(row.coverage.map((place) => place.company.id).sort()).toEqual([COMPANY.a, COMPANY.c]);
    expect(await prisma.user.count({ where: { personProfileId: hrHead } })).toBe(1);

    // A company-level person covers nothing outside their company (§28, §82).
    await expect(addDepartmentMember(memberActor(owner), await branchOf(COMPANY.c, "finance"), { personId: await personOf("finance-a") })).rejects.toMatchObject({ details: { code: "NOT_ELIGIBLE" } });

    const moved = await moveDepartmentMember(memberActor(owner), c.assignmentId, { companyDepartmentId: await branchOf(COMPANY.e, "finance") });
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: c.assignmentId } })).toMatchObject({ status: "INACTIVE" });
    expect(await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: moved.assignmentId } })).toMatchObject({ companyId: COMPANY.e, status: "ACTIVE" });
    await endDepartmentAssignment(memberActor(owner), a.assignmentId);
    await endDepartmentAssignment(memberActor(owner), moved.assignmentId);
  });

  it("taken off their home branch, are placed in the next one they belong to, or nowhere; back on, placed again", async () => {
    const financeBranch = await branchOf(COMPANY.a, "finance");
    const place = await prisma.departmentAssignment.findFirstOrThrow({ where: { userId: financeA.userId, companyDepartmentId: financeBranch, positionLevel: "MEMBER", status: "ACTIVE" } });
    await endDepartmentAssignment(memberActor(owner), place.id);
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: financeA.membershipId } })).departmentId).toBeNull();
    await addDepartmentMember(memberActor(owner), financeBranch, { personId: await personOf("finance-a") });
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: financeA.membershipId } })).departmentId).toBe(financeBranch);
  });

  it("move with their membership when Team moves them (ADR 0003)", async () => {
    const procurement = await branchOf(COMPANY.a, "procurement");
    const finance = await branchOf(COMPANY.a, "finance");
    const role = await prisma.companyMember.findUniqueOrThrow({ where: { id: financeA.membershipId }, select: { roleId: true } });
    await team.updateMember(owner, financeA.membershipId, updateMemberSchema.parse({ roleId: role.roleId, departmentId: procurement }), { placement: placeMembership });
    expect(await prisma.departmentAssignment.count({ where: { userId: financeA.userId, companyDepartmentId: procurement, positionLevel: "MEMBER", status: "ACTIVE" } })).toBe(1);
    expect(await prisma.departmentAssignment.count({ where: { userId: financeA.userId, companyDepartmentId: finance, positionLevel: "MEMBER", status: "ACTIVE" } })).toBe(0);
    await team.updateMember(owner, financeA.membershipId, updateMemberSchema.parse({ roleId: role.roleId, departmentId: finance }), { placement: placeMembership });
  });

  it("are not taken off the team they manage: the appointment ends first", async () => {
    const legalE = await branchOf(COMPANY.e, "legal");
    const place = await prisma.departmentAssignment.findFirstOrThrow({ where: { companyDepartmentId: legalE, positionLevel: "MEMBER", status: "ACTIVE", user: { username: "legal-manager-e" } } });
    await expect(endDepartmentAssignment(memberActor(owner), place.id)).rejects.toMatchObject({ details: { code: "MANAGES_BRANCH" } });
  });

  it("need a login until E-04 (§31)", async () => {
    const adrian = await prisma.personProfile.findFirstOrThrow({ where: { parentGroupId: GROUP, firstName: "Adrian", lastName: "Kola" }, select: { id: true } });
    await expect(addDepartmentMember(memberActor(owner), await branchOf(COMPANY.c, "finance"), { personId: adrian.id })).rejects.toMatchObject({ details: { code: "NO_ACCOUNT" } });
  });
});

describe("who reads the team (§36, §73, §113, §125, §147)", () => {
  it("is the department's own people and those who keep the group's people", async () => {
    await expect(getDepartmentTeam(memberActor(financeA), gd("finance"), teamQuerySchema.parse({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDepartmentTeam(memberActor(await loginAs("HSE")), gd("finance"), teamQuerySchema.parse({}))).rejects.toMatchObject({ code: "FORBIDDEN" });

    const forHead = await getDepartmentTeam(memberActor(financeHead), gd("finance"), teamQuerySchema.parse({}));
    expect(forHead.filters.companies).toHaveLength(5);
    expect(forHead.data.find((row) => row.position === "GROUP_HEAD")?.person.name).toBe("Fiona Blake");

    // A local manager sees their branch and their own company, not the other three.
    const forForma = await getDepartmentTeam(memberActor(formaFinanceManager), gd("finance"), teamQuerySchema.parse({}));
    expect(new Set(forForma.data.flatMap((row) => row.coverage.map((place) => place.company.id)))).toEqual(new Set([COMPANY.d]));
    await expect(getDepartmentTeam(memberActor(formaFinanceManager), gd("finance"), teamQuerySchema.parse({ company: COMPANY.b }))).rejects.toMatchObject({ code: "NOT_FOUND" });

    const filtered = await getDepartmentTeam(memberActor(owner), gd("finance"), teamQuerySchema.parse({ company: COMPANY.c, position: "COMPANY_MANAGER" }));
    expect(filtered.data.map((row) => row.person.name)).toEqual(["Fiona Blake"]);
  });

  it("shows what happened to it, newest first (§38)", async () => {
    const activity = await getDepartmentActivity(memberActor(owner), gd("finance"));
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.some((row) => /appointed manager in Meridian Developments/.test(row.text))).toBe(true);
    await expect(getDepartmentActivity(memberActor(financeA), gd("finance"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("offers candidates of the reader's own group only, with why a person does not fit (§43, §44, §84)", async () => {
    const heads = await listDepartmentCandidates(memberActor(owner), gd("legal"), { position: "GROUP_HEAD", company: undefined, search: undefined });
    expect(heads.every((candidate) => candidate.companies.every((company) => company.id.startsWith("company_demo_")))).toBe(true);
    expect(heads.find((candidate) => candidate.name === "Fiona Blake")).toMatchObject({ eligible: false });
    const members = await listDepartmentCandidates(memberActor(owner), gd("finance"), { position: "MEMBER", company: COMPANY.c, search: undefined });
    expect(members.find((candidate) => candidate.personId === "person_finance_c")).toMatchObject({ eligible: false, reason: "Already a member" });
    expect(members.find((candidate) => candidate.personId === "person_finance_a")).toMatchObject({ eligible: false, reason: "Not eligible for this company" });
    expect(members.find((candidate) => candidate.personId === "person_pm_c")).toMatchObject({ eligible: true });
  });
});

describe("direct ids from elsewhere (§112, §147)", () => {
  it("answer another group's reader as not found, for every door", async () => {
    const financeB = await branchOf(COMPANY.b, "finance");
    const place = await prisma.departmentAssignment.findFirstOrThrow({ where: { companyDepartmentId: financeB, status: "ACTIVE" } });
    await expect(getDepartmentDetail(memberActor(tenantOwner), gd("finance"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listBranchMembers(memberActor(tenantOwner), financeB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addDepartmentMember(memberActor(tenantOwner), financeB, { personId: await personOf("pm-b") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(endDepartmentAssignment(memberActor(tenantOwner), place.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(appointGroupHead(memberActor(tenantOwner), gd("finance"), { personId: await personOf("pm-b"), replace: true })).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
    // Nor does a person of another group become one of ours.
    const tenantPerson = await prisma.personProfile.findFirstOrThrow({ where: { parentGroupId: { not: GROUP } }, select: { id: true } });
    await expect(addDepartmentMember(memberActor(owner), financeB, { personId: tenantPerson.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("one person, several places (§21, §87, §118)", () => {
  it("holds the head of Group Finance and Terra's manager on one person and one login", async () => {
    const places = await personDepartmentPlaces(GROUP, financeHead.userId);
    expect(places).toEqual(
      expect.arrayContaining([
        { department: expect.objectContaining({ code: "FIN" }), company: null, position: "GROUP_HEAD" },
        { department: expect.objectContaining({ code: "FIN" }), company: { id: COMPANY.c, name: "Terra Infrastructure" }, position: "COMPANY_MANAGER" },
      ]),
    );
    expect(await prisma.user.count({ where: { personProfileId: await personOf("group-finance") } })).toBe(1);
  });
});

describe("positions in a department the group added widen nothing (ADR 0003)", () => {
  it("records the manager of Administration, without making them a manager of anything else", async () => {
    const adm = (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: GROUP, code: "ADMF" } })).id;
    const branch = await branchOf(COMPANY.a, "custom-adm");
    await appointCompanyManager(memberActor(owner), branch, { personId: await personOf("pm-a"), replace: false });
    const pm = await loginAs("PROJECT_MANAGER");
    expect(pm.position).toBe("MEMBER");
    const detail = await getDepartmentDetail(memberActor(owner), adm);
    expect(detail.companies.find((row) => row.company.id === COMPANY.a)?.branch?.manager?.name).toBe("Alex Morgan");
  });
});

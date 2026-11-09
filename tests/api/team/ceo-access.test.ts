import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { assignCompanyCeo } from "@/lib/modules/platform/company-leadership.service";
import { platformActor } from "@/lib/modules/platform/group-actor";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createCompanySchema, createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { setCeoAccess } from "@/lib/modules/team/ceo-access.service";
import { getMember, listMembers, suspendMember, updateMember } from "@/lib/modules/team/team.service";
import { teamListQuerySchema, updateMemberSchema } from "@/lib/modules/team/team.schema";
import { cleanupSessions, loginAs, loginAsMembership, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * CEO access (2026-11), against the real database: in a tenant of one company
 * the CEO gives a member the CEO's rights on top of their own role; every
 * holder is an equal; the named CEO is never removed this way; it is given
 * only while the tenant has one company and kept, still removable, after.
 */

const STANDALONE = "TCA Solo Co";
const GROUP = "tca-group";
const GROUP_COMPANIES = ["tca-first", "tca-second"];
const EMAILS = ["tca-ceo@nesto.test", "tca-fin@nesto.test", "tca-pm@nesto.test", "tca-view@nesto.test", "tca-g-ceo@nesto.test", "tca-g-fin@nesto.test"];

let admin: PlatformContext;
let solo: string;
let ceo: UserContext;
let ceoMember: string;
let finMember: string;
let pmMember: string;
let viewMember: string;

async function removeCompany(companyId: string) {
  await prisma.projectMember.deleteMany({ where: { companyId } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId }, { entityId: companyId }] } });
  await prisma.activity.deleteMany({ where: { companyId } });
  await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
  await prisma.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
  await prisma.company.update({ where: { id: companyId }, data: { ceoMemberId: null } });
  await prisma.companyMember.deleteMany({ where: { companyId } });
  await prisma.companyNumberingScheme.deleteMany({ where: { companyId } });
  await prisma.companyStorageQuota.deleteMany({ where: { companyId } });
  await prisma.financeSettings.deleteMany({ where: { companyId } });
  await prisma.companyIntegrationSettings.deleteMany({ where: { companyId } });
  await prisma.companySettings.deleteMany({ where: { companyId } });
  await prisma.companyModule.deleteMany({ where: { companyId } });
  await prisma.departmentAssignment.deleteMany({ where: { companyId } });
  await prisma.department.deleteMany({ where: { companyId } });
  await prisma.projectType.deleteMany({ where: { companyId } });
  await prisma.projectUnitType.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
}

async function removeAll() {
  const companies = await prisma.company.findMany({ where: { OR: [{ slug: { in: GROUP_COMPANIES } }, { name: STANDALONE }] }, select: { id: true, parentGroupId: true } });
  for (const company of companies) await removeCompany(company.id);
  const roots = await prisma.parentGroup.findMany({ where: { OR: [{ slug: GROUP }, { id: { in: companies.map((row) => row.parentGroupId) } }] }, select: { id: true } });
  const userIds = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((row) => row.id);
  for (const { id: parentGroupId } of roots) {
    await prisma.departmentAssignment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId } });
    await prisma.auditEvent.deleteMany({ where: { parentGroupId } });
  }
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const { id: parentGroupId } of roots) {
    await prisma.personProfile.deleteMany({ where: { parentGroupId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: parentGroupId } });
  }
}

async function makeMember(companyId: string, email: string, first: string, roleKey: string): Promise<string> {
  const { parentGroupId } = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { parentGroupId: true } });
  const person = await prisma.personProfile.create({ data: { parentGroupId, firstName: first, lastName: "Test", workEmail: email, lifecycleStatus: "EMPLOYEE", createdByUserId: admin.userId }, select: { id: true } });
  const { createProvisionedUser } = await import("@/lib/auth/identity");
  const user = await prisma.$transaction((tx) => createProvisionedUser(tx, { personProfileId: person.id, firstName: first, lastName: "Test", email, phone: null, username: null, temporaryPassword: "nesto1234", expiresAt: null }));
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
  return (await prisma.companyMember.create({ data: { companyId, userId: user.id, roleId: role.id, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } })).id;
}

async function namedCeo(companyId: string, email: string): Promise<string> {
  await assignCompanyCeo(platformActor(admin), { companyId, mode: "new", firstName: "Chief", lastName: "Test", email });
  return (await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { ceoMemberId: true } })).ceoMemberId!;
}

async function refused(promise: Promise<unknown>, code: string, detail?: string): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}${detail ? ` / ${detail}` : ""}, but it succeeded`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe(code);
  if (detail) expect((error as AccessError).details).toMatchObject({ code: detail });
  return error as AccessError;
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
  ({ companyId: solo } = await createCompany(admin, createCompanySchema.parse({ name: STANDALONE })));
  ceoMember = await namedCeo(solo, EMAILS[0]);
  finMember = await makeMember(solo, EMAILS[1], "Fiona", "FINANCE");
  pmMember = await makeMember(solo, EMAILS[2], "Petrit", "PROJECT_MANAGER");
  viewMember = await makeMember(solo, EMAILS[3], "Vera", "VIEWER");
  ceo = await loginAsMembership(ceoMember);
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("CEO access in a tenant of one company", () => {
  it("lets the CEO give a member the CEO's rights on top of their own role, with its evidence", async () => {
    expect(ceo.parentGroup.standalone).toBe(true);
    const before = await getMember(ceo, finMember);
    expect(before.capabilities).toMatchObject({ canGiveCeoAccess: true, canRemoveCeoAccess: false });
    expect(before.membership).toMatchObject({ ceoAccess: false, isCompanyCeo: false });

    await setCeoAccess(ceo, finMember, true);

    const fin = await loginAsMembership(finMember);
    expect(fin).toMatchObject({ role: "FINANCE", ceoAccess: true });
    // Everything the CEO holds in this company — the same modules switched on.
    expect(fin.permissions).toEqual(expect.arrayContaining(ceo.permissions));
    expect(fin.permissions).toContain("team.ceo_access.manage");
    expect(fin.permissions).toContain("team.member.role.assign");
    // Their own role's rights stay.
    expect(fin.permissions).toEqual(expect.arrayContaining(["finance.view"]));

    const row = await prisma.companyMember.findUniqueOrThrow({ where: { id: finMember }, select: { ceoAccess: true, ceoAccessGrantedByMemberId: true, ceoAccessGrantedAt: true, accessVersion: true, role: { select: { key: true } } } });
    expect(row).toMatchObject({ ceoAccess: true, ceoAccessGrantedByMemberId: ceoMember, role: { key: "FINANCE" } });
    expect(row.ceoAccessGrantedAt).toBeInstanceOf(Date);
    expect(await prisma.auditEvent.count({ where: { entityId: finMember, actionKey: "TEAM_MEMBER_CEO_ACCESS_GRANTED" } })).toBe(1);
    expect(await prisma.activity.count({ where: { entityId: finMember, action: "MEMBER_CEO_ACCESS_GRANTED" } })).toBe(1);

    const listed = await listMembers(ceo, teamListQuerySchema.parse({}));
    expect(listed.data.find((member) => member.id === finMember)?.ceoAccess).toBe(true);
    await refused(setCeoAccess(ceo, finMember, true), "CONFLICT", "CEO_ACCESS_ALREADY");
  });

  it("makes every holder an equal: they give it, take it away, and may give up their own", async () => {
    const fin = await loginAsMembership(finMember);
    await setCeoAccess(fin, viewMember, true);
    const viewer = await loginAsMembership(viewMember);
    // A read-only role given the CEO's rights can act on them.
    expect(viewer.permissions).toContain("team.member.role.assign");

    await setCeoAccess(viewer, pmMember, true);
    await setCeoAccess(fin, pmMember, false);
    const pm = await loginAsMembership(pmMember);
    expect(pm.ceoAccess).toBe(false);
    expect(pm.permissions).not.toContain("team.ceo_access.manage");
    await refused(setCeoAccess(pm, finMember, false), "FORBIDDEN");

    await setCeoAccess(viewer, viewMember, false);
    expect((await loginAsMembership(viewMember)).permissions).not.toContain("team.member.role.assign");
  });

  it("never touches the named CEO, through CEO access or the Team editors", async () => {
    const fin = await loginAsMembership(finMember);
    await refused(setCeoAccess(fin, ceoMember, false), "CONFLICT", "CEO_ACCESS_NOT_NEEDED");
    await refused(setCeoAccess(fin, ceoMember, true), "CONFLICT", "CEO_ACCESS_NOT_NEEDED");

    const view = await getMember(fin, ceoMember);
    expect(view.membership.isCompanyCeo).toBe(true);
    expect(view.capabilities).toMatchObject({ canAssignRole: false, canSuspend: false, canDeactivate: false, canGiveCeoAccess: false, canRemoveCeoAccess: false });

    await refused(suspendMember(fin, ceoMember), "CONFLICT", "IS_COMPANY_CEO");
    const finance = await prisma.role.findUniqueOrThrow({ where: { key: "FINANCE" }, select: { id: true } });
    await refused(updateMember(fin, ceoMember, updateMemberSchema.parse({ roleId: finance.id }), { placement: placeMembership }), "CONFLICT", "IS_COMPANY_CEO");
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: ceoMember }, select: { status: true, role: { select: { key: true } } } }))).toMatchObject({ status: "ACTIVE", role: { key: "CEO" } });
  });

  it("is not for someone without it, and not for an inactive member", async () => {
    const pm = await loginAsMembership(pmMember);
    await refused(setCeoAccess(pm, viewMember, true), "FORBIDDEN");
    await prisma.companyMember.update({ where: { id: viewMember }, data: { status: "SUSPENDED" } });
    await refused(setCeoAccess(ceo, viewMember, true), "CONFLICT", "CEO_ACCESS_INACTIVE");
    await prisma.companyMember.update({ where: { id: viewMember }, data: { status: "ACTIVE" } });
  });
});

describe("a tenant with more than one company", () => {
  it("is never given there; a holder from before keeps it, and it can still be removed", async () => {
    const groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "TCA Group", slug: GROUP }))).id;
    const first = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "TCA First", slug: GROUP_COMPANIES[0] }))).companyId;
    const chief = await loginAsMembership(await namedCeo(first, EMAILS[4]));
    const member = await makeMember(first, EMAILS[5], "Genta", "FINANCE");
    expect(chief.parentGroup.standalone).toBe(true);
    await setCeoAccess(chief, member, true);

    await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "TCA Second", slug: GROUP_COMPANIES[1] }));
    const holder = await loginAsMembership(member);
    expect(holder.parentGroup.standalone).toBe(false);
    expect(holder.ceoAccess).toBe(true);
    expect(holder.permissions).toContain("team.ceo_access.manage");

    const chiefNow = await loginAsMembership(chief.membershipId);
    const view = await getMember(chiefNow, member);
    expect(view.capabilities).toMatchObject({ canGiveCeoAccess: false, canRemoveCeoAccess: true });
    await setCeoAccess(chiefNow, member, false);
    await refused(setCeoAccess(chiefNow, member, true), "CONFLICT", "CEO_ACCESS_SINGLE_COMPANY_ONLY");
  });

  it("is refused in the demo group of five companies", async () => {
    const demoCeo = await loginAs("CEO");
    const finance = await prisma.companyMember.findFirstOrThrow({ where: { companyId: demoCeo.companyId, status: "ACTIVE", groupDerived: false, role: { key: "FINANCE" } }, select: { id: true } });
    await refused(setCeoAccess(demoCeo, finance.id, true), "CONFLICT", "CEO_ACCESS_SINGLE_COMPANY_ONLY");
  });
});

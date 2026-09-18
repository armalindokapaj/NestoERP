import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { diagnoseAccess } from "@/lib/modules/organization/access-diagnostics.service";
import { grantAccess, listAccessGrants, revokeAccessGrant, type GrantAccessInput } from "@/lib/modules/organization/access-grant.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * Delegated access (E-06 §18, §73, §78) and the access check.
 *
 * The Owner delegates any function's module; a group head only their own
 * function's, to their own function's people. Nobody hands on more than their
 * own role and position give them where the grant reaches — and what was
 * delegated to them does not count. A grant raises the module from the
 * holder's next request, is audited in the company it concerns, and ends by
 * being revoked. The access check explains all of it and changes nothing.
 */

const startedAt = new Date();
let owner: UserContext;
let groupIt: UserContext;
let architectureHead: UserContext;
let financeHead: UserContext;
const user: Record<string, string> = {};

const base = (overrides: Partial<GrantAccessInput>): GrantAccessInput => ({
  userId: user.pmA,
  moduleKey: "finance",
  scope: "COMPANY",
  scopeCompanyId: COMPANY.a,
  accessLevel: "VIEW",
  reason: "Cost review for the Riverside handover",
  ...overrides,
});

beforeAll(async () => {
  owner = await loginAs("OWNER");
  groupIt = await loginAs("GROUP_IT");
  architectureHead = await loginAsEmail(DEMO_EMAIL.architectureHead);
  financeHead = await loginAs("FINANCE");
  for (const [key, username] of Object.entries({ pmA: "pm-a", architectA: "architect-a", financeA: "finance-a", viewerA: "viewer-a", multi: "multi-architect", tenantOwner: "tenant-owner", salesA: "sales-a" })) {
    user[key] = (await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } })).id;
  }
});

afterEach(async () => {
  const created = await prisma.accessGrant.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: created.map((row) => row.id) } } });
  await prisma.accessGrant.deleteMany({ where: { id: { in: created.map((row) => row.id) } } });
});

afterAll(async () => {
  await cleanupSessions();
});

describe("the Owner delegates (§18)", () => {
  it("raises a module from the holder's next request, audits it in that company, and revoking takes it back", async () => {
    expect((await loginAs("PROJECT_MANAGER")).moduleAccess.finance).toMatchObject({ accessLevel: "VIEW", scope: "PROJECT" });

    const { grantId } = await grantAccess(owner, base({}));
    expect((await loginAs("PROJECT_MANAGER")).moduleAccess.finance).toMatchObject({ accessLevel: "VIEW", scope: "COMPANY" });
    const granted = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: grantId, actionKey: "ORGANIZATION_ACCESS_GRANTED" } });
    expect(granted.companyId).toBe(COMPANY.a);

    await revokeAccessGrant(owner, grantId);
    expect((await loginAs("PROJECT_MANAGER")).moduleAccess.finance).toMatchObject({ accessLevel: "VIEW", scope: "PROJECT" });
    expect(await prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } })).toMatchObject({ revokedByUserId: owner.userId });
    expect(await prisma.auditEvent.count({ where: { entityId: grantId, actionKey: "ORGANIZATION_ACCESS_GRANT_REVOKED" } })).toBe(1);
    await expect(revokeAccessGrant(owner, grantId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reaches every company of the group with a group grant, as GROUP scope (company-wide in each)", async () => {
    await grantAccess(owner, base({ userId: user.multi, moduleKey: "contracts", scope: "GROUP", scopeCompanyId: null }));
    const memberships = await prisma.companyMember.findMany({ where: { userId: user.multi }, select: { id: true, companyId: true } });
    expect(memberships.map((row) => row.companyId).sort()).toEqual([COMPANY.a, COMPANY.d]);
    for (const membership of memberships) {
      expect((await loginAsMembership(membership.id)).moduleAccess.contracts, membership.companyId).toMatchObject({ accessLevel: "VIEW", scope: "GROUP" });
    }
  });

  it("refuses what cannot be delegated, and to whom", async () => {
    // Administration is never handed on.
    await expect(grantAccess(owner, base({ moduleKey: "team" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "NOT_GRANTABLE" } });
    // Not to yourself.
    await expect(grantAccess(owner, base({ userId: owner.userId }))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "SELF_GRANT" } });
    // A company grant for somebody who does not work there.
    await expect(grantAccess(owner, base({ scopeCompanyId: COMPANY.b }))).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { code: "NOT_A_MEMBER" } });
    // A read-only role above View.
    await expect(grantAccess(owner, base({ userId: user.viewerA, accessLevel: "CONTRIBUTE" }))).rejects.toMatchObject({ details: { code: "READ_ONLY_HOLDER" } });
    // Another group's person is nobody here; another group's company is not a choice.
    await expect(grantAccess(owner, base({ userId: user.tenantOwner }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(grantAccess(owner, base({ scopeCompanyId: COMPANY.tenant }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // An end that has already passed.
    await expect(grantAccess(owner, base({ expiresAt: new Date(Date.now() - 86_400_000) }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps one live grant per person, module and place", async () => {
    await grantAccess(owner, base({}));
    await expect(grantAccess(owner, base({ accessLevel: "CONTRIBUTE" }))).rejects.toMatchObject({ code: "CONFLICT", details: { code: "GRANT_EXISTS" } });
  });

  it("does nothing once expired", async () => {
    const { grantId } = await grantAccess(owner, base({ expiresAt: new Date(Date.now() + 86_400_000) }));
    await prisma.accessGrant.update({ where: { id: grantId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await loginAs("PROJECT_MANAGER")).moduleAccess.finance.scope).toBe("PROJECT");
  });
});

describe("a group head delegates their own function only (§78)", () => {
  it("delegates Engineering to an architect, company-wide, up to what the head holds", async () => {
    await grantAccess(architectureHead, base({ userId: user.architectA, moduleKey: "engineering", accessLevel: "APPROVE" }));
    expect((await loginAs("ARCHITECT")).moduleAccess.engineering).toMatchObject({ accessLevel: "APPROVE", scope: "COMPANY" });
  });

  it("never above the head's own ceiling, and never from what was delegated to the head", async () => {
    await expect(grantAccess(architectureHead, base({ userId: user.architectA, moduleKey: "engineering", accessLevel: "MANAGE" }))).rejects.toMatchObject({ code: "FORBIDDEN", details: { code: "ABOVE_CEILING" } });
    await grantAccess(owner, base({ userId: architectureHead.userId, moduleKey: "engineering", accessLevel: "MANAGE" }));
    expect((await loginAsEmail(DEMO_EMAIL.architectureHead)).moduleAccess.engineering.accessLevel).toBe("MANAGE");
    await expect(grantAccess(architectureHead, base({ userId: user.architectA, moduleKey: "engineering", accessLevel: "MANAGE" }))).rejects.toMatchObject({ details: { code: "ABOVE_CEILING" } });
  });

  it("cannot hand on what it holds only on its own projects", async () => {
    // Group Engineering's head works as an Engineer: Engineering on their projects, not company-wide.
    const engineeringHead = await loginAsEmail(DEMO_EMAIL.engineeringHead);
    const engineerA = (await prisma.user.findUniqueOrThrow({ where: { username: "engineer-a" }, select: { id: true } })).id;
    await expect(grantAccess(engineeringHead, base({ userId: engineerA, moduleKey: "engineering" }))).rejects.toMatchObject({ details: { code: "ABOVE_CEILING" } });
  });

  it("refuses another function's module, and another function's people", async () => {
    await expect(grantAccess(financeHead, base({ userId: user.financeA, moduleKey: "sales" }))).rejects.toMatchObject({ code: "FORBIDDEN", details: { code: "OUTSIDE_FUNCTION" } });
    await expect(grantAccess(financeHead, base({ userId: user.pmA, moduleKey: "finance" }))).rejects.toMatchObject({ code: "FORBIDDEN", details: { code: "OUTSIDE_FUNCTION" } });
  });

  it("is nobody else's to do", async () => {
    await expect(grantAccess(groupIt, base({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(grantAccess(await loginAs("CEO"), base({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("who reads and revokes grants", () => {
  it("lists every grant to those who keep access, and only the function's to a head", async () => {
    const finance = await grantAccess(owner, base({}));
    const engineering = await grantAccess(architectureHead, base({ userId: user.architectA, moduleKey: "engineering" }));

    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
    expect(ids(await listAccessGrants(owner, { status: "live" }))).toEqual(expect.arrayContaining([finance.grantId, engineering.grantId]));
    expect(ids(await listAccessGrants(groupIt, { status: "live" }))).toEqual(expect.arrayContaining([finance.grantId, engineering.grantId]));
    const headView = ids(await listAccessGrants(architectureHead, { status: "live" }));
    expect(headView).toContain(engineering.grantId);
    expect(headView).not.toContain(finance.grantId);
    await expect(listAccessGrants(await loginAs("PROJECT_MANAGER"), { status: "live" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the head of the function or the grantor revoke, and not Group IT", async () => {
    const byOwner = await grantAccess(owner, base({ userId: user.architectA, moduleKey: "engineering" }));
    await expect(revokeAccessGrant(groupIt, byOwner.grantId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeAccessGrant(financeHead, byOwner.grantId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await revokeAccessGrant(architectureHead, byOwner.grantId);
    expect((await listAccessGrants(owner, { status: "all" })).find((row) => row.id === byOwner.grantId)).toMatchObject({ status: "REVOKED", revokedBy: { userId: architectureHead.userId } });
  });

  it("is not found from another group", async () => {
    const { grantId } = await grantAccess(owner, base({}));
    await expect(revokeAccessGrant(await loginAsEmail(DEMO_EMAIL.tenantOwner), grantId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the access check (§73)", () => {
  it("names the source of each module, the position behind it and a permission's answer", async () => {
    await grantAccess(owner, base({}));
    const diagnosis = await diagnoseAccess(groupIt, { userId: user.pmA, targetCompanyId: COMPANY.a, permission: "finance.invoice.view" });
    expect(diagnosis.blockers).toEqual([]);
    expect(diagnosis.membership?.role.key).toBe("PROJECT_MANAGER");
    expect(diagnosis.modules.find((row) => row.key === "finance")).toMatchObject({ source: "GRANT", role: { scope: "PROJECT" }, effective: { accessLevel: "VIEW", scope: "COMPANY" } });
    expect(diagnosis.modules.find((row) => row.key === "projects")).toMatchObject({ source: "ROLE" });
    expect(diagnosis.grants.map((grant) => grant.moduleKey)).toEqual(["finance"]);
    expect(diagnosis.permission).toMatchObject({ key: "finance.invoice.view", known: true, moduleKey: "finance" });

    const head = await diagnoseAccess(owner, { userId: architectureHead.userId, targetCompanyId: COMPANY.a });
    expect(head.position.level).toBe("GROUP_HEAD");
    expect(head.position.heldThrough.map((row) => row.where)).toContain("Group");
    expect(head.modules.find((row) => row.key === "organization")).toMatchObject({ source: "POSITION" });
  });

  it("says what blocks somebody, and what NESTO does not know", async () => {
    const elsewhere = await diagnoseAccess(groupIt, { userId: user.pmA, targetCompanyId: COMPANY.b, permission: "project.view" });
    expect(elsewhere.blockers.map((blocker) => blocker.code)).toEqual(["NO_MEMBERSHIP"]);
    expect(elsewhere.modules.every((row) => row.source === "BLOCKED")).toBe(true);
    expect(elsewhere.permission).toMatchObject({ held: false, reason: "BLOCKED" });

    const unknown = await diagnoseAccess(groupIt, { userId: user.pmA, targetCompanyId: COMPANY.a, permission: "finance.everything" });
    expect(unknown.permission).toMatchObject({ known: false, reason: "UNKNOWN_PERMISSION" });
  });

  it("is for those who keep access, and says nothing about another group", async () => {
    await expect(diagnoseAccess(await loginAs("PROJECT_MANAGER"), { userId: user.pmA, targetCompanyId: COMPANY.a })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(diagnoseAccess(financeHead, { userId: user.pmA, targetCompanyId: COMPANY.a })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(diagnoseAccess(groupIt, { userId: user.tenantOwner, targetCompanyId: COMPANY.a })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(diagnoseAccess(groupIt, { userId: user.pmA, targetCompanyId: COMPANY.tenant })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

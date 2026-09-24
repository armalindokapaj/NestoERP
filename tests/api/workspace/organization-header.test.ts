import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DEMO_PASSWORD } from "@/config/demo-accounts";
import { AccessError } from "@/lib/access/guards";
import { authenticateCredentials } from "@/lib/auth/credentials";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";
import { groupBrandingSchema } from "@/lib/modules/platform/platform-control.schema";
import { setGroupBranding } from "@/lib/modules/platform/platform-control.service";
import { resolveShellCore } from "@/lib/workspace/shell-core";
import { hasWorkspaceChoice, listWorkspaces, switchWorkspace } from "@/lib/workspace/workspace.service";
import { cleanupSessions, COMPANY, loginAs, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * What the sidebar's organization header is drawn from, and the one access
 * rule it brought (Sidebar Organization Workspace Header PRD, "OW").
 *
 * - A standalone company — a tenant whose parent group holds one company — has
 *   no Group level: its Owner works in the company, is never offered the Group
 *   and cannot switch into it (§8, §45, §86, §87).
 * - The header's identity and mark come from the verified context, with no
 *   read of their own (§12, §57), and the mark follows the tenant's branding
 *   as the platform sets it (§44, §96).
 */

const SOLO_GROUP = "group_fixture_solo";
const SOLO_COMPANY = "company_fixture_solo";
const DEMO_GROUP = "group_demo_nesto";
const sessions: string[] = [];
const restore: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  await cleanupSessions();
  if (sessions.length > 0) {
    await prisma.authEvent.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.session.deleteMany({ where: { id: { in: sessions } } });
    sessions.length = 0;
  }
});
afterAll(() => prisma.$disconnect());

async function signIn(username: string): Promise<UserContext> {
  const user = await authenticateCredentials({ username, password: DEMO_PASSWORD }, new Headers());
  if (!user) throw new Error(`${username} could not sign in`);
  sessions.push(user.sessionId);
  const result = await resolveContextForSession(user.sessionId, { expectedUserId: user.id });
  if (!result.ok) throw new Error(result.reason);
  return result.context;
}

async function refused(promise: Promise<unknown>): Promise<AccessError> {
  const caught = await promise.then(() => null, (thrown: unknown) => thrown);
  expect(caught).toBeInstanceOf(AccessError);
  return caught as AccessError;
}

describe("a standalone company has no Group level (§8, §45, §86, §87)", () => {
  it("starts its Owner in the company, though an Owner elsewhere starts in the group", async () => {
    const solo = await signIn("solo-owner");
    expect(solo.parentGroup).toMatchObject({ id: SOLO_GROUP, standalone: true });
    expect(solo.workspace).toEqual({ parentGroupId: SOLO_GROUP, scopeType: "COMPANY", companyId: SOLO_COMPANY });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: solo.sessionId } })).workspaceScope).toBe("COMPANY");
  });

  it("offers nothing to switch to, and refuses the Group whatever the browser asks", async () => {
    const solo = await signIn("solo-owner");
    const list = await listWorkspaces(solo);
    expect(list.parentGroup.groupViewAllowed).toBe(false);
    expect(list.companies.map((company) => company.id)).toEqual([SOLO_COMPANY]);
    expect(list.defaultWorkspace).toEqual({ scopeType: "COMPANY", companyId: SOLO_COMPANY });
    expect(await hasWorkspaceChoice(solo)).toBe(false);

    expect((await refused(switchWorkspace(solo, { scopeType: "GROUP" }))).status).toBe(403);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: solo.sessionId } })).workspaceScope).toBe("COMPANY");
  });

  it("moves a session that still asks for the group back to the company", async () => {
    const solo = await signIn("solo-owner");
    await prisma.session.update({ where: { id: solo.sessionId }, data: { workspaceScope: "GROUP" } });
    const next = await resolveContextForSession(solo.sessionId, { expectedUserId: solo.userId });
    if (!next.ok) throw new Error(next.reason);
    expect(next.context.workspace.scopeType).toBe("COMPANY");
    expect((await prisma.session.findUniqueOrThrow({ where: { id: solo.sessionId } })).workspaceScope).toBe("COMPANY");
  });

  it("names the company alone in the shell: no group, no second line to invent", async () => {
    const core = await resolveShellCore(await signIn("solo-owner"));
    expect(core.organization).toEqual({ standalone: true, logoUrl: null });
    expect(core.activeWorkspace).toMatchObject({ scopeType: "COMPANY", label: "Solo Studio", groupLabel: "Solo Studio Holding" });
    expect(core.workspaceChoice).toBe(false);
  });
});

describe("a group of companies keeps its Group level (§7, §23)", () => {
  it("is not standalone, and its Owner may enter the group", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    expect(owner.parentGroup.standalone).toBe(false);
    expect(owner.workspace.scopeType).toBe("GROUP");
    expect((await listWorkspaces(owner)).parentGroup.groupViewAllowed).toBe(true);
    const core = await resolveShellCore(owner);
    expect(core.organization.standalone).toBe(false);
    expect(core.activeWorkspace.groupLabel).toBe("NESTO Demo Group");
  });

  it("lists only the companies the person works in (§24, §76)", async () => {
    const architect = await signIn("multi-architect");
    const list = await listWorkspaces(architect);
    const memberships = await prisma.companyMember.findMany({ where: { userId: architect.userId, status: "ACTIVE", company: { parentGroupId: DEMO_GROUP, status: "ACTIVE" } }, select: { companyId: true } });
    expect(list.companies.map((company) => company.id).sort()).toEqual(memberships.map((membership) => membership.companyId).sort());
    expect(list.companies.length).toBeLessThan(await prisma.company.count({ where: { parentGroupId: DEMO_GROUP } }));
  });
});

describe("the mark follows the tenant's branding (§12, §44, §96)", () => {
  it("shows the group's logo once the platform sets it, in both workspaces, and audits it without the image", async () => {
    const admin = await loginAsPlatformAdmin();
    const before = await prisma.parentGroup.findUniqueOrThrow({ where: { id: DEMO_GROUP }, select: { logoUrl: true } });
    const since = new Date();
    restore.push(async () => {
      await prisma.parentGroup.update({ where: { id: DEMO_GROUP }, data: { logoUrl: before.logoUrl } });
      await prisma.auditEvent.deleteMany({ where: { parentGroupId: DEMO_GROUP, actionKey: "PLATFORM_GROUP_BRANDING_CHANGED", occurredAt: { gte: since } } });
    });

    await setGroupBranding(admin, DEMO_GROUP, { logoUrl: "/branding/nesto-demo.svg", reason: "Tenant branding for the demo group" });

    const inGroup = await loginAs("OWNER", { workspace: "GROUP" });
    expect((await resolveShellCore(inGroup)).organization.logoUrl).toBe("/branding/nesto-demo.svg");
    const inCompany = await loginAs("PROJECT_MANAGER");
    expect((await resolveShellCore(inCompany)).organization.logoUrl).toBe("/branding/nesto-demo.svg");

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { parentGroupId: DEMO_GROUP, actionKey: "PLATFORM_GROUP_BRANDING_CHANGED", occurredAt: { gte: since } } });
    expect(JSON.stringify(audit)).toContain("/branding/nesto-demo.svg");
  });

  it("falls back to the company's logo in its own workspace only", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: COMPANY.a }, select: { logoUrl: true } });
    await prisma.company.update({ where: { id: COMPANY.a }, data: { logoUrl: "/branding/aurelia.svg" } });
    restore.push(() => prisma.company.update({ where: { id: COMPANY.a }, data: { logoUrl: before.logoUrl } }));

    const inCompany = await loginAs("PROJECT_MANAGER");
    expect(inCompany.companyId).toBe(COMPANY.a);
    expect((await resolveShellCore(inCompany)).organization.logoUrl).toBe("/branding/aurelia.svg");

    const inGroup = await loginAs("OWNER", { workspace: "GROUP" });
    expect(inGroup.workspace.scopeType).toBe("GROUP");
    expect((await resolveShellCore(inGroup)).organization.logoUrl).toBeNull();
  });

  it("accepts only what the shell can draw", () => {
    expect(groupBrandingSchema.safeParse({ logoUrl: "/branding/logo.svg", reason: "Set the logo" }).success).toBe(true);
    expect(groupBrandingSchema.safeParse({ logoUrl: "", reason: "Clear the logo" }).success).toBe(true);
    expect(groupBrandingSchema.safeParse({ logoUrl: "https://cdn.example.com/logo.png", reason: "External" }).success).toBe(false);
    expect(groupBrandingSchema.safeParse({ logoUrl: "/api/me", reason: "An API route" }).success).toBe(false);
  });
});

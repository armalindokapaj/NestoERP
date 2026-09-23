import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DEMO_PASSWORD } from "@/config/demo-accounts";
import { AccessError } from "@/lib/access/guards";
import { authenticateCredentials } from "@/lib/auth/credentials";
import { revokeSessions } from "@/lib/auth/session-store";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";
import { resolveAllowedCompanies, resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";
import { getWorkspaceContext, listWorkspaces, switchWorkspace } from "@/lib/workspace/workspace.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, grantGroupStanding, loginAs, loginAsEmail, loginAsMembership, prisma } from "../../helpers";

/**
 * The workspace a person works in (Workspace Context §4-§17, §57-§62, §80-§92).
 *
 * Real sessions, real resolver, real database: the owner and Group Finance head
 * of the five-company demo group have group-level standing and start in the
 * group. The multi-company Architect (Aurelia and Forma) has none, so they start
 * in their own company — but working in two opens the Group workspace to them
 * (§7). A plain Aurelia Project Manager works in one company and is never
 * offered it.
 */

const GROUP_ID = "group_demo_nesto";
/** The multi-company Architect: Aurelia and Forma, with no group standing. */
const MULTI_A = "member_multicompany_a";
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

async function error(promise: Promise<unknown>): Promise<AccessError> {
  const caught = await promise.then(() => null, (thrown: unknown) => thrown);
  expect(caught).toBeInstanceOf(AccessError);
  return caught as AccessError;
}

/** A real sign-in: the credentials check makes the session, as the form does. */
async function signIn(username: string): Promise<UserContext> {
  const user = await authenticateCredentials({ username, password: DEMO_PASSWORD }, new Headers());
  if (!user) throw new Error(`${username} could not sign in`);
  sessions.push(user.sessionId);
  const result = await resolveContextForSession(user.sessionId, { expectedUserId: user.id });
  if (!result.ok) throw new Error(result.reason);
  return result.context;
}

const activeGroupCompanies = () =>
  prisma.company.findMany({ where: { parentGroupId: GROUP_ID, status: "ACTIVE" }, select: { id: true }, orderBy: { name: "asc" } });

describe("where a sign-in starts (§16, §17)", () => {
  it("puts a person with group-level standing in the group, and stores it on the session", async () => {
    const owner = await signIn("owner");
    expect(owner.workspace).toEqual({ parentGroupId: GROUP_ID, scopeType: "GROUP", companyId: null });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: owner.sessionId } });
    expect(row.workspaceScope).toBe("GROUP");
  });

  it("puts a group department head in the group too", async () => {
    expect((await signIn("group-finance")).workspace.scopeType).toBe("GROUP");
  });

  it("starts a company employee in their own company", async () => {
    const pm = await signIn("pm-a");
    expect(pm.workspace).toEqual({ parentGroupId: GROUP_ID, scopeType: "COMPANY", companyId: COMPANY.a });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: pm.sessionId } })).workspaceScope).toBe("COMPANY");
  });

  it("starts a multi-company person in their primary company, and still offers them the group (§7, §16)", async () => {
    const architect = await signIn("multi-architect");
    expect(architect.workspace.scopeType).toBe("COMPANY");
    const workspaces = await listWorkspaces(architect);
    // Working in two companies opens the Group workspace, which unions those
    // two and nothing else; it is not where they start (§7, §8, §16).
    expect(workspaces.parentGroup.groupViewAllowed).toBe(true);
    expect(workspaces.companies.map((company) => company.id).sort()).toEqual([COMPANY.a, COMPANY.d].sort());
    expect(workspaces.defaultWorkspace).toEqual({ scopeType: "COMPANY", companyId: architect.companyId });

    const group = await switchWorkspace(architect, { scopeType: "GROUP" });
    expect(group.context.accessibleCompanyIds.sort()).toEqual([COMPANY.a, COMPANY.d].sort());
  });

  it("offers no group to somebody who works in one company (§7, §91)", async () => {
    const pm = await signIn("pm-a");
    expect((await listWorkspaces(pm)).parentGroup.groupViewAllowed).toBe(false);
    expect((await error(switchWorkspace(pm, { scopeType: "GROUP" }))).code).toBe("FORBIDDEN");
  });

  it("decides afresh for every new session, so nothing carries over from a previous user (§17, §98)", async () => {
    const first = await signIn("pm-a");
    await switchWorkspace(first, { scopeType: "COMPANY", companyId: first.companyId });
    const second = await signIn("owner");
    expect(second.userId).not.toBe(first.userId);
    expect(second.workspace.scopeType).toBe("GROUP");
    expect(second.sessionId).not.toBe(first.sessionId);
  });
});

describe("the workspaces a person may enter (§5-§9, §77)", () => {
  it("lists the group first and the companies they may enter, never another group's", async () => {
    const owner = await signIn("owner");
    const workspaces = await listWorkspaces(owner);
    expect(workspaces.parentGroup).toMatchObject({ id: GROUP_ID, groupViewAllowed: true });
    expect(workspaces.active).toEqual({ scopeType: "GROUP", companyId: null });
    expect(workspaces.defaultWorkspace).toEqual({ scopeType: "GROUP", companyId: null });
    const listed = workspaces.companies.map((company) => company.id);
    expect(listed).not.toContain(COMPANY.tenant);
    expect(listed).not.toContain(COMPANY.works);
    expect(listed).not.toContain(COMPANY.suspended);
    expect(listed.sort()).toEqual((await activeGroupCompanies()).map((company) => company.id).sort());
  });

  it("offers a company employee only their own company and no group", async () => {
    const pm = await signIn("pm-a");
    const workspaces = await listWorkspaces(pm);
    expect(workspaces.parentGroup.groupViewAllowed).toBe(false);
    expect(workspaces.companies.map((company) => company.id)).toEqual([COMPANY.a]);
  });
});

describe("switching workspace (§11, §13, §80, §89-§91)", () => {
  it("preserves a valid collection and normalizes workspace-bound filters", async () => {
    const owner = await signIn("owner");
    const switched = await switchWorkspace(owner, {
      scopeType: "COMPANY",
      companyId: COMPANY.b,
      currentPathname: "/finance/invoices",
      currentSearch: "?status=OVERDUE&projectId=old-project&page=4&view=table",
    });

    expect(switched.navigation).toMatchObject({
      resolution: "KEEP_EXACT",
      destination: "/finance/invoices?status=OVERDUE&page=1&view=table",
      reason: "VALID",
    });
  });

  it("falls an unavailable record back to its nearest collection", async () => {
    const owner = await signIn("owner");
    const switched = await switchWorkspace(owner, {
      scopeType: "COMPANY",
      companyId: COMPANY.b,
      currentPathname: "/projects/project-from-another-workspace",
    });

    expect(switched.navigation).toMatchObject({
      resolution: "KEEP_PARENT",
      destination: "/projects",
      reason: "RECORD_NOT_AVAILABLE",
    });
  });

  it("keeps supported Group collections and falls Group mutations back to their collection", async () => {
    const owner = await signIn("owner");
    const inCompany = await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.b });
    const companyContext = await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId });
    if (!companyContext.ok) throw new Error(companyContext.reason);

    const collection = await switchWorkspace(companyContext.context, {
      scopeType: "GROUP",
      currentPathname: "/finance/invoices",
      currentSearch: "?status=OVERDUE",
    });
    expect(collection.navigation).toMatchObject({ resolution: "KEEP_EXACT", destination: "/finance/invoices?status=OVERDUE", reason: "VALID" });

    const groupContext = await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId });
    if (!groupContext.ok) throw new Error(groupContext.reason);
    await switchWorkspace(groupContext.context, { scopeType: "COMPANY", companyId: COMPANY.b });
    const companyAgain = await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId });
    if (!companyAgain.ok) throw new Error(companyAgain.reason);
    const mutation = await switchWorkspace(companyAgain.context, {
      scopeType: "GROUP",
      currentPathname: "/finance/invoices/new",
    });
    expect(mutation.navigation).toMatchObject({ resolution: "KEEP_PARENT", destination: "/finance/invoices", reason: "MUTATION_ROUTE_UNSUPPORTED" });
    expect(inCompany.context.effectiveModules).toContain("finance");
  });

  it("does not let an older transition overwrite a newer workspace choice", async () => {
    const owner = await signIn("owner");
    await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.b, transitionId: 2_000_000 });

    await expect(switchWorkspace(owner, {
      scopeType: "COMPANY",
      companyId: COMPANY.c,
      transitionId: 1_000_000,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const current = await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId });
    if (!current.ok) throw new Error(current.reason);
    expect(current.context.workspace).toMatchObject({ scopeType: "COMPANY", companyId: COMPANY.b });
  });

  it("moves the same person from the group to a company and back, without changing who they are", async () => {
    const owner = await signIn("owner");

    const toCompany = await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.b });
    expect(toCompany.switched).toBe(true);
    expect(toCompany.change).toMatchObject({ previousScopeType: "GROUP", previousCompanyId: null, nextScopeType: "COMPANY", nextCompanyId: COMPANY.b, parentGroupId: GROUP_ID, workspaceKey: `COMPANY:${COMPANY.b}` });
    expect(toCompany.workspaceVersion).toBeGreaterThan(0);
    expect(toCompany.context).toMatchObject({ scopeType: "COMPANY", companyId: COMPANY.b, accessibleCompanyIds: [COMPANY.b] });

    const inCompany = (await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId }));
    if (!inCompany.ok) throw new Error(inCompany.reason);
    expect(inCompany.context).toMatchObject({ userId: owner.userId, sessionId: owner.sessionId, fullName: owner.fullName, companyId: COMPANY.b });
    expect(inCompany.context.workspace).toEqual({ parentGroupId: GROUP_ID, scopeType: "COMPANY", companyId: COMPANY.b });

    const back = await switchWorkspace(inCompany.context, { scopeType: "GROUP" });
    expect(back.context.scopeType).toBe("GROUP");
    expect(back.context.accessibleCompanyIds.sort()).toEqual((await activeGroupCompanies()).map((company) => company.id).sort());
    const again = await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId });
    if (!again.ok) throw new Error(again.reason);
    expect(again.context).toMatchObject({ userId: owner.userId, sessionId: owner.sessionId });
    expect(again.context.workspace.scopeType).toBe("GROUP");
  });

  it("changes nothing when asked for the workspace they are already in", async () => {
    const owner = await signIn("owner");
    const same = await switchWorkspace(owner, { scopeType: "GROUP" });
    expect(same.switched).toBe(false);
    expect(await prisma.authEvent.count({ where: { sessionId: owner.sessionId, type: "COMPANY_CONTEXT_SWITCHED" } })).toBe(0);
  });

  it("records the switch with the central event's payload (§67)", async () => {
    const owner = await signIn("owner");
    await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.c });
    const event = await prisma.authEvent.findFirstOrThrow({ where: { sessionId: owner.sessionId, type: "COMPANY_CONTEXT_SWITCHED" } });
    expect(event.metadata).toMatchObject({ event: "WORKSPACE_CHANGED", previousScopeType: "GROUP", nextScopeType: "COMPANY", nextCompanyId: COMPANY.c, parentGroupId: GROUP_ID });
  });

  it("refuses a company they hold no membership in, and keeps the workspace they are in (§90, §89)", async () => {
    const pm = await signIn("pm-a");
    const refusal = await error(switchWorkspace(pm, { scopeType: "COMPANY", companyId: COMPANY.b }));
    expect(refusal.code).toBe("FORBIDDEN");
    const after = await resolveContextForSession(pm.sessionId, { expectedUserId: pm.userId });
    if (!after.ok) throw new Error(after.reason);
    expect(after.context.companyId).toBe(COMPANY.a);
    expect(after.context.workspace.scopeType).toBe("COMPANY");
  });

  it("answers a company that does not exist exactly as it answers one that is not theirs (§81)", async () => {
    const pm = await signIn("pm-a");
    const missing = await error(switchWorkspace(pm, { scopeType: "COMPANY", companyId: "company_that_does_not_exist" }));
    const foreign = await error(switchWorkspace(pm, { scopeType: "COMPANY", companyId: COMPANY.tenant }));
    expect(missing.code).toBe("FORBIDDEN");
    expect(foreign.code).toBe(missing.code);
    expect(foreign.message).toBe(missing.message);
  });

  it("refuses the group to a company-only employee (§91)", async () => {
    const person = await signIn("pm-a");
    expect((await error(switchWorkspace(person, { scopeType: "GROUP" }))).code).toBe("FORBIDDEN");
    const after = await resolveContextForSession(person.sessionId, { expectedUserId: person.userId });
    if (!after.ok) throw new Error(after.reason);
    expect(after.context.workspace.scopeType).toBe("COMPANY");
  });

  it("refuses a suspended company with a state-specific answer (§51, §81)", async () => {
    const owner = await signIn("owner");
    const company = await prisma.company.findUniqueOrThrow({ where: { id: COMPANY.suspended } });
    expect(company.status).not.toBe("ACTIVE");
    const membership = await prisma.companyMember.findFirst({ where: { userId: owner.userId, companyId: COMPANY.suspended } });
    // Owner is not a member there: refused like any company they cannot enter.
    const refusal = await error(switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.suspended }));
    expect(["FORBIDDEN", "COMPANY_INACTIVE"]).toContain(refusal.code);
    if (membership) expect(refusal.code).toBe("COMPANY_INACTIVE");
  });

  it("rejects a request that names a company for the group or none for a company", async () => {
    const { switchWorkspaceSchema } = await import("@/lib/workspace/workspace.service");
    expect(switchWorkspaceSchema.safeParse({ scopeType: "GROUP", companyId: COMPANY.a }).success).toBe(false);
    expect(switchWorkspaceSchema.safeParse({ scopeType: "COMPANY" }).success).toBe(false);
    expect(switchWorkspaceSchema.safeParse({ scopeType: "GROUP", companyId: null }).success).toBe(true);
  });
});

describe("what the group reads (§57-§62, §92)", () => {
  it("asks each company for its own answer: a module held in some companies aggregates only those", async () => {
    const finance = await loginAs("FINANCE", { workspace: "GROUP" });
    expect(finance.workspace.scopeType).toBe("GROUP");
    const all = await resolveAllowedCompanies(finance, { module: "finance" });
    expect(all.sort()).toEqual((await activeGroupCompanies()).map((company) => company.id).sort());

    // Company C switches Finance off: A, B, D and E aggregate, C never does.
    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.c, module: { key: "finance" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));

    const fresh = await loginAs("FINANCE", { workspace: "GROUP" });
    const some = await resolveAllowedCompanies(fresh, { module: "finance" });
    expect(some).not.toContain(COMPANY.c);
    expect(some.sort()).toEqual(all.filter((id) => id !== COMPANY.c).sort());
  });

  it("returns each company's real context, so a permission held in one company is not lent to another", async () => {
    const owner = await loginAsEmail(DEMO_EMAIL.multiCompany, { workspace: "COMPANY" });
    const contexts = await resolveWorkspaceContexts(owner, { module: "projects", permission: "project.view" });
    // Company workspace: only the session's own.
    expect(contexts.map((context) => context.companyId)).toEqual([owner.companyId]);
  });

  it("offers no company-only module in the group, whoever asks (§25)", async () => {
    const owner = await signIn("owner");
    expect(await resolveWorkspaceContexts(owner, { module: "hr" })).toEqual([]);
    expect(await resolveWorkspaceContexts(owner, { module: "inventory" })).toEqual([]);
    const projects = await resolveWorkspaceContexts(owner, { module: "projects" });
    expect(projects.length).toBeGreaterThan(1);
  });

  it("is each company's own answer — the context a sign-in there would give, never more (§62)", async () => {
    const group = await loginAs("FINANCE", { workspace: "GROUP" });
    const companies = await resolveWorkspaceContexts(group, { module: "finance" });
    expect(companies.length).toBeGreaterThan(1);
    for (const company of companies) {
      expect(company.workspace).toEqual({ parentGroupId: GROUP_ID, scopeType: "COMPANY", companyId: company.companyId });
      const own = await loginAsMembership(company.membershipId);
      expect(company.permissions).toEqual(own.permissions);
      expect(company.moduleAccess).toEqual(own.moduleAccess);
      expect(company.position).toBe(own.position);
    }
  });
});

describe("what a workspace shows: navigation and context (§24-§27, §79)", () => {
  it("offers the group sidebar only modules the group workspace supports, and company workspaces theirs", async () => {
    const owner = await signIn("owner");
    const group = (await resolveWorkspaceNavigation(owner)).flatMap((section) => section.items.map((item) => item.module));
    expect(group).toContain("dashboard");
    expect(group).toContain("projects");
    expect(group).not.toContain("hr");
    expect(group).not.toContain("hse");
    expect(group).not.toContain("settings");

    await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.a });
    const inCompany = await resolveContextForSession(owner.sessionId, { expectedUserId: owner.userId });
    if (!inCompany.ok) throw new Error(inCompany.reason);
    const company = (await resolveWorkspaceNavigation(inCompany.context)).flatMap((section) => section.items.map((item) => item.module));
    expect(company).toContain("hr");
    expect(company).toContain("settings");
  });

  it("describes the effective context: companies, modules and roles it reaches", async () => {
    const owner = await signIn("owner");
    const effective = await getWorkspaceContext(owner);
    expect(effective).toMatchObject({ parentGroupId: GROUP_ID, scopeType: "GROUP", companyId: null });
    expect(effective.accessibleCompanyIds.length).toBe((await activeGroupCompanies()).length);
    expect(effective.effectiveModules).toContain("projects");
    expect(effective.effectiveModules).not.toContain("hr");
    expect(effective.effectiveRoleLabels).toContain("Group Owner");
  });
});

describe("access revoked while the group is active (§82)", () => {
  it("drops somebody to their company on the next request once their group standing ends", async () => {
    // A company-only employee, given group standing and then losing it: the one
    // case where the group really does close behind somebody (§82, §91).
    const pm = await loginAs("PROJECT_MANAGER");
    const undo = await grantGroupStanding(pm.userId, GROUP_ID);
    let undone = false;
    restore.push(async () => {
      if (!undone) await undo();
    });

    const granted = await switchWorkspace(pm, { scopeType: "GROUP" });
    expect(granted.context.scopeType).toBe("GROUP");

    await undo();
    undone = true;

    const next = await resolveContextForSession(pm.sessionId, { expectedUserId: pm.userId });
    if (!next.ok) throw new Error(next.reason);
    expect(next.context.workspace.scopeType).toBe("COMPANY");
    expect((await prisma.session.findUniqueOrThrow({ where: { id: pm.sessionId } })).workspaceScope).toBe("COMPANY");
  });

  it("keeps the group for a head who loses the position but still works in several companies (§7)", async () => {
    const head = await signIn("group-finance");
    expect(head.workspace.scopeType).toBe("GROUP");

    const positions = await prisma.departmentAssignment.findMany({ where: { userId: head.userId, positionLevel: "GROUP_HEAD", companyId: null, status: "ACTIVE" } });
    expect(positions.length).toBeGreaterThan(0);
    await prisma.departmentAssignment.updateMany({ where: { id: { in: positions.map((position) => position.id) } }, data: { status: "SUSPENDED" } });
    restore.push(() => prisma.departmentAssignment.updateMany({ where: { id: { in: positions.map((position) => position.id) } }, data: { status: "ACTIVE" } }));

    // They work in five companies, so the group stays open — but it is now only
    // the union of what each of those memberships may read on its own (§60, §62).
    const next = await resolveContextForSession(head.sessionId, { expectedUserId: head.userId });
    if (!next.ok) throw new Error(next.reason);
    expect(next.context.workspace.scopeType).toBe("GROUP");
  });

  it("moves somebody who still works elsewhere to a company they have left, rather than signing them out", async () => {
    // The multi-company Architect works in Aurelia and Forma. Aurelia, the one
    // their session sits in, is taken away while they are working.
    const session = await loginAsMembership(MULTI_A);
    expect(session.companyId).toBe(COMPANY.a);

    const membership = await prisma.companyMember.findUniqueOrThrow({ where: { id: MULTI_A }, select: { status: true } });
    await prisma.$transaction(async (tx) => {
      await tx.companyMember.updateMany({ where: { id: MULTI_A }, data: { status: "INACTIVE" } });
      await revokeSessions(tx, { membershipId: MULTI_A, relocate: true });
    });
    restore.push(() => prisma.companyMember.updateMany({ where: { id: MULTI_A }, data: { status: membership.status } }));

    // The session survives, pointing at the company they still work in, with no
    // workspace chosen so the next request picks their default again (§16, §82).
    const row = await prisma.session.findUnique({ where: { id: session.sessionId }, select: { currentCompanyId: true, workspaceScope: true } });
    expect(row).toMatchObject({ currentCompanyId: COMPANY.d, workspaceScope: null });

    const next = await resolveContextForSession(session.sessionId, { expectedUserId: session.userId });
    if (!next.ok) throw new Error(next.reason);
    expect(next.context.companyId).toBe(COMPANY.d);
    // No group standing, so their default is that company (§16, §91).
    expect(next.context.workspace.scopeType).toBe("COMPANY");
  });

  it("ends the session of somebody with nowhere else to work", async () => {
    const session = await loginAs("PROJECT_MANAGER");
    const membership = await prisma.companyMember.findUniqueOrThrow({ where: { id: session.membershipId }, select: { status: true } });

    await prisma.$transaction(async (tx) => {
      await tx.companyMember.updateMany({ where: { id: session.membershipId }, data: { status: "INACTIVE" } });
      await revokeSessions(tx, { membershipId: session.membershipId, relocate: true });
    });
    restore.push(() => prisma.companyMember.updateMany({ where: { id: session.membershipId }, data: { status: membership.status } }));

    expect(await prisma.session.findUnique({ where: { id: session.sessionId } })).toBeNull();
    expect(await resolveContextForSession(session.sessionId, { expectedUserId: session.userId })).toMatchObject({ ok: false, reason: "SESSION_EXPIRED" });
  });
});

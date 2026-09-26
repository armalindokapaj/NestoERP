import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceKey } from "@/config/workspace";
import { AccessError } from "@/lib/access/guards";
import { createTaskAction } from "@/lib/actions/tasks";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { ContextResult, UserContext } from "@/lib/context/types";
import { TAB_WORKSPACE_HEADER } from "@/lib/unsaved/outcome";
import { switchWorkspace } from "@/lib/workspace/workspace.service";
import { cleanupSessions, COMPANY, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * A Company switch changes the workspace, never the person (AUD-06 §7, RP-06).
 *
 * Switching company is not signing in again: the same user, the same session
 * row and token, the same expiry — only the membership the session points at,
 * its company and the workspace generation move, and the move is recorded as
 * COMPANY_CONTEXT_SWITCHED, never as a sign-out and sign-in. (The demo user
 * switch is the opposite: another person, another session — see
 * tests/integration/auth/demo-user-switch.test.ts.)
 *
 * A switch the server refuses — a company the person holds no membership in, a
 * suspended company they do belong to, an older request arriving after a newer
 * one — changes nothing: the session row is identical afterwards, no event is
 * recorded, and no write lands in the company the browser asked for. A tab
 * that believed the switch went through says so with every write
 * (`x-nesto-workspace`, AUD-03 §7) and is refused; a write forging the target
 * company's ids is refused by the record's own company check. Each refusal is
 * paired with the same write succeeding from the workspace that did hold.
 *
 * Real sessions and the real resolver; only the cookie and header reads of a
 * live request are simulated.
 */

const browser = vi.hoisted(() => ({ sessionId: "", headers: new Headers() }));
vi.mock("@/lib/context/resolve-user-context", () => ({
  resolveUserContext: async (): Promise<ContextResult> =>
    browser.sessionId ? resolveContextForSession(browser.sessionId) : { ok: false, reason: "UNAUTHENTICATED" },
}));
vi.mock("next/headers", () => ({ headers: async () => browser.headers, cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const PREFIX = "aud06sw_";
const GROUP_ID = "group_demo_nesto";
const EKSO = "armaar_co_ekso";
const sessions: string[] = [];

beforeEach(() => {
  browser.sessionId = "";
  browser.headers = new Headers();
});

afterEach(async () => {
  const owned = await prisma.task.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = owned.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
    const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
    await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
    await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
  }
  if (sessions.length > 0) await prisma.authEvent.deleteMany({ where: { sessionId: { in: sessions.splice(0) } } });
  await cleanupSessions();
});

afterAll(() => prisma.$disconnect());

/** A browser signed in to one membership: its session is the one the actions resolve. */
async function signedIn(membershipId: string, workspace: "COMPANY" | "GROUP" = "COMPANY"): Promise<UserContext> {
  const context = await loginAsMembership(membershipId, { workspace });
  sessions.push(context.sessionId);
  browser.sessionId = context.sessionId;
  return context;
}

/** The whole session row: a refused switch must leave every column as it was. */
function sessionRow(sessionId: string) {
  return prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
}

async function resolved(sessionId: string): Promise<UserContext> {
  const result = await resolveContextForSession(sessionId);
  if (!result.ok) throw new Error(result.reason);
  return result.context;
}

function events(sessionId: string) {
  return prisma.authEvent.findMany({ where: { sessionId }, select: { type: true } });
}

async function refusal(promise: Promise<unknown>): Promise<AccessError> {
  const caught = await promise.then(() => null, (thrown: unknown) => thrown);
  expect(caught).toBeInstanceOf(AccessError);
  return caught as AccessError;
}

/** A task form, sent from a tab that rendered `tabWorkspace` (the AUD-03 header). */
async function submitTask(title: string, projectId: string | null, tabWorkspace: string | null) {
  browser.headers = new Headers(tabWorkspace ? { [TAB_WORKSPACE_HEADER]: tabWorkspace } : {});
  const data = new FormData();
  data.set("title", `${PREFIX}${title}`);
  if (projectId) data.set("projectId", projectId);
  try {
    return { thrown: null, result: await createTaskAction(data) };
  } catch (error) {
    return { thrown: error as Error & { digest?: string; code?: string }, result: null };
  }
}

function tasksTitled(title: string) {
  return prisma.task.findMany({ where: { title: `${PREFIX}${title}` }, select: { companyId: true, createdByMemberId: true } });
}

const companyKey = (companyId: string) => workspaceKey({ parentGroupId: GROUP_ID, scopeType: "COMPANY", companyId });

describe("a Company switch keeps the person and the session (RP-06)", () => {
  it("moves only the workspace: same user, session id, token and expiry; recorded as a context switch, not a sign-in", async () => {
    const owner = await signedIn("member_owner");
    const before = await sessionRow(owner.sessionId);
    const ownSessions = await prisma.session.count({ where: { userId: owner.userId } });

    const result = await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.b });
    expect(result.switched).toBe(true);

    const after = await sessionRow(owner.sessionId);
    expect(after).toMatchObject({ id: before.id, sessionToken: before.sessionToken, userId: before.userId, expiresAt: before.expiresAt, createdAt: before.createdAt });
    expect(after).toMatchObject({ membershipId: "member_owner__b", currentCompanyId: COMPANY.b, workspaceScope: "COMPANY" });
    expect(after.workspaceVersion).toBeGreaterThan(before.workspaceVersion);
    expect(await prisma.session.count({ where: { userId: owner.userId } })).toBe(ownSessions);
    expect(await events(owner.sessionId)).toEqual([{ type: "COMPANY_CONTEXT_SWITCHED" }]);

    const now = await resolved(owner.sessionId);
    expect(now).toMatchObject({ userId: owner.userId, sessionId: owner.sessionId, fullName: owner.fullName, email: owner.email, role: "OWNER" });
    expect(now).toMatchObject({ companyId: COMPANY.b, membershipId: "member_owner__b" });
    expect(now.workspace).toEqual({ parentGroupId: GROUP_ID, scopeType: "COMPANY", companyId: COMPANY.b });
  });

  it("writes into the new company from a tab showing it, and refuses the tab still showing the old one", async () => {
    const owner = await signedIn("member_owner");
    await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.b });

    // The stale tab: rendered in Aurelia, naming Aurelia's project.
    const stale = await submitTask("stale-tab", PROJECT.a, companyKey(COMPANY.a));
    expect(stale.thrown?.digest).toBe("NESTO_WORKSPACE_CHANGED");
    expect(await tasksTitled("stale-tab")).toEqual([]);

    // Positive control: the tab that followed the switch.
    const fresh = await submitTask("new-company", PROJECT.b, companyKey(COMPANY.b));
    expect(fresh.result).toMatchObject({ ok: true });
    expect(await tasksTitled("new-company")).toEqual([{ companyId: COMPANY.b, createdByMemberId: "member_owner__b" }]);
  });
});

describe("a refused switch changes nothing and lets no write cross (RP-06)", () => {
  it("a company the person holds no membership in", async () => {
    const pm = await signedIn("member_pm");
    const before = await sessionRow(pm.sessionId);

    expect((await refusal(switchWorkspace(pm, { scopeType: "COMPANY", companyId: COMPANY.b }))).code).toBe("FORBIDDEN");

    expect(await sessionRow(pm.sessionId)).toEqual(before);
    expect(await events(pm.sessionId)).toEqual([]);
    expect((await resolved(pm.sessionId)).workspace).toEqual({ parentGroupId: GROUP_ID, scopeType: "COMPANY", companyId: COMPANY.a });

    // A tab that assumed the switch went through: refused, whatever it names.
    const assumed = await submitTask("assumed-b", PROJECT.b, companyKey(COMPANY.b));
    expect(assumed.thrown?.digest).toBe("NESTO_WORKSPACE_CHANGED");
    // No tab header at all, forging Meridian's project: the record's own company check refuses it.
    const forged = await submitTask("forged-b", PROJECT.b, null);
    expect(forged.result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(await prisma.task.count({ where: { title: { in: [`${PREFIX}assumed-b`, `${PREFIX}forged-b`] } } })).toBe(0);

    // Positive control: the same person, the workspace they are really in.
    const own = await submitTask("own-a", PROJECT.a, companyKey(COMPANY.a));
    expect(own.result).toMatchObject({ ok: true });
    expect(await tasksTitled("own-a")).toEqual([{ companyId: COMPANY.a, createdByMemberId: "member_pm" }]);
  });

  it("a suspended company the person does belong to", async () => {
    const owner = await signedIn("member_armaar_owner_building_construction_invest");
    const armaarKey = (companyId: string) => workspaceKey({ parentGroupId: owner.parentGroupId, scopeType: "COMPANY", companyId });
    expect(await prisma.companyMember.count({ where: { userId: owner.userId, companyId: EKSO, status: "ACTIVE" } })).toBe(1);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: EKSO } })).status).toBe("SUSPENDED");
    const before = await sessionRow(owner.sessionId);
    const eksoTasks = await prisma.task.count({ where: { companyId: EKSO } });

    expect((await refusal(switchWorkspace(owner, { scopeType: "COMPANY", companyId: EKSO }))).code).toBe("COMPANY_INACTIVE");

    expect(await sessionRow(owner.sessionId)).toEqual(before);
    expect(await events(owner.sessionId)).toEqual([]);
    expect((await resolved(owner.sessionId)).companyId).toBe(owner.companyId);
    const assumed = await submitTask("assumed-ekso", null, armaarKey(EKSO));
    expect(assumed.thrown?.digest).toBe("NESTO_WORKSPACE_CHANGED");
    expect(await prisma.task.count({ where: { companyId: EKSO } })).toBe(eksoTasks);

    // Positive control: an active ARMAAR company of theirs switches.
    const other = await prisma.companyMember.findFirstOrThrow({ where: { userId: owner.userId, status: "ACTIVE", company: { status: "ACTIVE" }, companyId: { not: owner.companyId } }, select: { companyId: true } });
    expect((await switchWorkspace(owner, { scopeType: "COMPANY", companyId: other.companyId })).switched).toBe(true);
    expect((await resolved(owner.sessionId)).companyId).toBe(other.companyId);
  });

  it("an older switch arriving after a newer one: the newer workspace stands and the older tab cannot write", async () => {
    const owner = await signedIn("member_owner");
    const newer = await switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.b, transitionId: 2_000_000 });
    expect(newer.switched).toBe(true);
    const settled = await sessionRow(owner.sessionId);

    // The older request, still carrying the context it started with.
    expect((await refusal(switchWorkspace(owner, { scopeType: "COMPANY", companyId: COMPANY.c, transitionId: 1_000_000 }))).code).toBe("FORBIDDEN");
    expect(await sessionRow(owner.sessionId)).toEqual(settled);
    expect(await events(owner.sessionId)).toEqual([{ type: "COMPANY_CONTEXT_SWITCHED" }]);

    const older = await submitTask("older-c", PROJECT.c, companyKey(COMPANY.c));
    expect(older.thrown?.digest).toBe("NESTO_WORKSPACE_CHANGED");
    expect(await tasksTitled("older-c")).toEqual([]);
    const current = await submitTask("newer-b", PROJECT.b, companyKey(COMPANY.b));
    expect(current.result).toMatchObject({ ok: true });
    expect(await tasksTitled("newer-b")).toEqual([{ companyId: COMPANY.b, createdByMemberId: "member_owner__b" }]);
  });

  it("the Group workspace writes nowhere: no fallback to the company the session is anchored in", async () => {
    const owner = await signedIn("member_owner", "GROUP");
    expect(owner.workspace.scopeType).toBe("GROUP");
    const attempt = await submitTask("from-group", PROJECT.a, workspaceKey(owner.workspace));
    expect(attempt.thrown).toBeInstanceOf(AccessError);
    expect(attempt.thrown?.code).toBe("WORKSPACE_COMPANY_REQUIRED");
    expect(await tasksTitled("from-group")).toEqual([]);
  });
});

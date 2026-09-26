import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearThrottle, clientAddress, hitThrottle } from "@/lib/core/security/throttle";

import { dashboardForRole } from "@/config/dashboards";
import { DEMO_PASSWORD } from "@/config/demo-accounts";
import { signInAsDemoAccountAction, switchDemoUserAction } from "@/lib/actions/demo";
import { authenticateCredentials } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";
import { resolveDashboard } from "@/lib/modules/dashboard/dashboard.service";
import { switchWorkspace } from "@/lib/workspace/workspace.service";
import { projectListQuerySchema } from "@/lib/modules/projects/project.schema";
import { getProject, listProjects } from "@/lib/modules/projects/project.service";
import { prisma } from "../../helpers";
import { companyId } from "../../../prisma/seed/armaar/organization";
import { projectId } from "../../../prisma/seed/armaar/projects";

/**
 * The demo user switch (C-01): choosing another demo user is signing out and
 * signing in as them, never a role laid over the same person.
 *
 * The browser is simulated: its Auth.js cookie is `browser.user`, which
 * `auth()` reads and `signIn` / `signOut` replace, and its other cookies are a
 * map. `signIn` runs the credentials check Auth.js would, so every session here
 * is a real row made by the real sign-in pipeline, and every context is the
 * real resolver's.
 */
const browser = vi.hoisted(() => ({
  user: null as null | { id: string; username: string; sessionId: string },
  cookies: new Map<string, string>(),
  dev: true,
  refuseSignIn: false,
  signIns: 0,
}));

vi.mock("@/lib/auth/dev-mode", () => ({
  get isDevMode() {
    return browser.dev;
  },
  // A developer's machine: the platform account is a one-click target here.
  get allowsPlatformOneClick() {
    return browser.dev;
  },
}));
// `unstable_cache` runs at import time in lib/auth/demo-tenants.ts: the
// roster cache is a pass-through here, so every read is live.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/auth", async () => {
  const { CredentialsSignin } = await import("next-auth");
  const { authenticateCredentials: check } = await import("@/lib/auth/credentials");
  return {
    auth: async () => (browser.user ? { user: browser.user } : null),
    signOut: async () => {
      browser.user = null;
    },
    signIn: async (_provider: string, credentials: Record<string, unknown>) => {
      browser.signIns += 1;
      const user = browser.refuseSignIn ? null : await check(credentials, new Headers());
      if (!user) throw new CredentialsSignin();
      browser.user = { id: user.id, username: user.username, sessionId: user.sessionId };
      return "/";
    },
  };
});

const sessions: string[] = [];

/** Signs in on the form: the starting point of every switch. */
async function signInOnTheForm(username: string) {
  const user = await authenticateCredentials({ username, password: DEMO_PASSWORD }, new Headers());
  if (!user) throw new Error(`${username} could not sign in`);
  browser.user = { id: user.id, username: user.username, sessionId: user.sessionId };
  sessions.push(user.sessionId);
  return browser.user;
}

/** The context the browser's session resolves to now. */
async function contextNow(): Promise<UserContext> {
  if (!browser.user) throw new Error("the browser is signed out");
  sessions.push(browser.user.sessionId);
  const result = await resolveContextForSession(browser.user.sessionId, { expectedUserId: browser.user.id });
  if (!result.ok) throw new Error(`the browser's session does not resolve: ${result.reason}`);
  return result.context;
}

async function switchTo(username: string) {
  const result = await switchDemoUserAction(username);
  if (browser.user) sessions.push(browser.user.sessionId);
  return result;
}

beforeEach(() => {
  browser.user = null;
  browser.cookies.clear();
  browser.dev = true;
  browser.refuseSignIn = false;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { id: { in: sessions } } });
});

describe("the demo user switch replaces the session (C-01 §7, §21-§24)", () => {
  it("makes the Owner the Head of Finance: another user, a new session, the old one ended (§64, §69)", async () => {
    const before = await signInOnTheForm("armaar.owner");
    const owner = await contextNow();
    expect(owner).toMatchObject({ fullName: "Armand Lilo", role: "OWNER", position: "GROUP_HEAD" });

    await expect(switchTo("armaar.finance")).resolves.toEqual({ ok: true, landing: "/dashboard" });

    const after = browser.user!;
    expect(after.id).not.toBe(before.id);
    expect(after.sessionId).not.toBe(before.sessionId);
    expect(await prisma.session.findUnique({ where: { id: before.sessionId } })).toBeNull();
    await expect(resolveContextForSession(before.sessionId, { expectedUserId: before.id })).resolves.toEqual({ ok: false, reason: "SESSION_EXPIRED" });

    const finance = await contextNow();
    expect(finance).toMatchObject({ userId: after.id, fullName: "Edvin Gace", role: "FINANCE", roleLabel: "Finance", position: "GROUP_HEAD" });
    expect(finance.permissions).toContain("finance.budget.create");
    expect(owner.permissions).toContain("audit.view");
    expect(finance.permissions).not.toContain("audit.view");
    expect((await resolveDashboard(finance)).focus).toBe(dashboardForRole("FINANCE", "GROUP_HEAD").focus);
  });

  it("starts where the form would: the same membership and company a normal sign-in picks (§11, §24, §25)", async () => {
    await signInOnTheForm("armaar.owner");
    await switchTo("armaar.finance");
    const switched = await prisma.session.findUniqueOrThrow({ where: { id: browser.user!.sessionId } });

    const normal = await authenticateCredentials({ username: "armaar.finance", password: DEMO_PASSWORD }, new Headers());
    sessions.push(normal!.sessionId);
    const signedIn = await prisma.session.findUniqueOrThrow({ where: { id: normal!.sessionId } });
    expect(switched).toMatchObject({ userId: signedIn.userId, membershipId: signedIn.membershipId, currentCompanyId: signedIn.currentCompanyId });
  });

  it.each([
    ["armaar.architecture", "Besar Zifla", "ARCHITECT"],
    ["armaar.hse", "Arted Ballaj", "HSE"],
  ] as const)("makes the Owner %s: %s, a group head with their own role (§65, §66)", async (username, name, role) => {
    await signInOnTheForm("armaar.owner");
    await expect(switchTo(username)).resolves.toEqual({ ok: true, landing: "/dashboard" });
    const context = await contextNow();
    expect(context).toMatchObject({ fullName: name, role, position: "GROUP_HEAD" });
    expect(context.permissions).not.toContain("audit.view");
    expect((await resolveDashboard(context)).focus).toBe(dashboardForRole(role, "GROUP_HEAD").focus);
  });

  it("makes the Owner Eyes of Tirana's manager, who sees that project and no other (§9, §54, §67)", async () => {
    await signInOnTheForm("armaar.owner");
    await switchTo("unico.pm");
    const manager = await contextNow();
    expect(manager).toMatchObject({ fullName: "Tedi Gogu", role: "PROJECT_MANAGER", position: "MEMBER", companyId: companyId("IDEAL_CONSTRUCTION") });
    const listed = await listProjects(manager, projectListQuerySchema.parse({}));
    expect(listed.data.map((row) => row.id)).toEqual([projectId("EYES_OF_TIRANA")]);
    await expect(getProject(manager, projectId("TIRANA_LAKE"))).rejects.toThrow();
  });

  it("rebuilds the Owner from nothing on the way back: the context a fresh sign-in gives (§68)", async () => {
    await signInOnTheForm("armaar.finance");
    await switchTo("armaar.owner");
    const back = await contextNow();

    const fresh = await authenticateCredentials({ username: "armaar.owner", password: DEMO_PASSWORD }, new Headers());
    sessions.push(fresh!.sessionId);
    const signedIn = await resolveContextForSession(fresh!.sessionId);
    if (!signedIn.ok) throw new Error(signedIn.reason);
    // Everything but the session itself is what signing in gives.
    expect({ ...back, sessionId: signedIn.context.sessionId }).toEqual(signedIn.context);
    expect(back.fullName).toBe("Armand Lilo");
  });

  it("goes to the platform and back, each a real session of its own (§26, §27, §78)", async () => {
    const owner = await signInOnTheForm("armaar.owner");
    await expect(switchTo("platform-admin")).resolves.toEqual({ ok: true, landing: "/platform-admin" });
    const platform = browser.user!;
    expect(await prisma.session.findUniqueOrThrow({ where: { id: platform.sessionId } })).toMatchObject({ membershipId: null, currentCompanyId: null });
    await expect(resolveContextForSession(platform.sessionId, { expectedUserId: platform.id })).resolves.toEqual({ ok: false, reason: "PLATFORM_SESSION" });
    expect(await prisma.session.findUnique({ where: { id: owner.sessionId } })).toBeNull();

    await expect(switchTo("armaar.owner")).resolves.toEqual({ ok: true, landing: "/dashboard" });
    expect(browser.user!.sessionId).not.toBe(owner.sessionId);
    expect(await prisma.session.findUnique({ where: { id: platform.sessionId } })).toBeNull();
    expect((await contextNow()).fullName).toBe("Armand Lilo");
  });

  it("records the switch: a sign-out of the old session saying where it went, a sign-in of the new (§57, §58)", async () => {
    const before = await signInOnTheForm("armaar.owner");
    await switchTo("armaar.hse");
    const after = browser.user!;
    expect(await prisma.authEvent.findFirst({ where: { type: "LOGOUT", sessionId: before.sessionId } })).toMatchObject({
      userId: before.id,
      metadata: { switchType: "DEMO_USER_SWITCH", toUserId: after.id },
    });
    // The sign-in says it was a switch, not a password typed (AUD-06 §4).
    expect(await prisma.authEvent.findFirst({ where: { type: "LOGIN_SUCCESS", sessionId: after.sessionId } })).toMatchObject({
      userId: after.id,
      metadata: { via: "DEMO_USER_SWITCH" },
    });
  });

  it("deletes the old role-override cookie, which nothing reads (§28, §70)", async () => {
    await signInOnTheForm("armaar.owner");
    browser.cookies.set("nesto.dev-role", "QAQC");
    await switchTo("armaar.finance");
    expect(browser.cookies.has("nesto.dev-role")).toBe(false);
    expect(await contextNow()).toMatchObject({ role: "FINANCE", roleLabel: "Finance" });
  });

  it("does nothing when the account chosen is the one signed in (§42)", async () => {
    const before = await signInOnTheForm("armaar.finance");
    const signIns = browser.signIns;
    await expect(switchTo("armaar.finance")).resolves.toEqual({ ok: true, landing: null });
    expect(browser.user).toEqual(before);
    expect(browser.signIns).toBe(signIns);
    expect((await contextNow()).fullName).toBe("Edvin Gace");
  });
});

describe("company switching is still a different thing (C-01 §10, §55, §75)", () => {
  it("moves Edvin's own session to another of his companies, then a switch away and back starts him where sign-in does", async () => {
    const edvin = await signInOnTheForm("armaar.finance");
    const first = await contextNow();
    // Working in a company is a workspace switch: the same person and session, another place (Workspace Context §11).
    const moved = await switchWorkspace(first, { scopeType: "COMPANY", companyId: companyId("ARLIS_NDERTIM") });
    expect(moved.switched).toBe(true);
    expect(browser.user).toEqual(edvin);
    const there = await contextNow();
    expect(there).toMatchObject({ userId: edvin.id, sessionId: edvin.sessionId, fullName: "Edvin Gace", companyId: companyId("ARLIS_NDERTIM"), role: "FINANCE" });
    expect(there.membershipId).not.toBe(first.membershipId);

    // Nothing of the company he had moved to survives him: he comes back where he starts.
    await switchTo("armaar.owner");
    await switchTo("armaar.finance");
    expect((await contextNow()).companyId).toBe(first.companyId);
  });
});

describe("the demo user switch refuses before it replaces anything (C-01 §13, §20, §59-§63)", () => {
  async function refused(username: string, message: RegExp) {
    const before = await signInOnTheForm("armaar.owner");
    const signIns = browser.signIns;
    const result = await switchTo(username);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringMatching(message) });
    expect(result).not.toHaveProperty("landing");
    // Still signed in as the Owner, on the same session.
    expect(browser.user).toEqual(before);
    expect(browser.signIns).toBe(signIns);
    expect((await contextNow()).fullName).toBe("Armand Lilo");
  }

  it("refuses an unknown username (§61)", () => refused("not-a-user", /Unknown demo account/));

  it("refuses a customer's account outside every demo, as if it did not exist (§60)", async () => {
    // Meridian's CEO: a real login of a group that is no demo tenant, and no curated persona.
    await refused("ceo-b", /Unknown demo account/);
    // A test fixture's owner.
    await refused("tenant-owner", /Unknown demo account/);
  });

  it("refuses an inactive demo login (§62)", async () => {
    await prisma.user.update({ where: { username: "bci.viewer" }, data: { status: "INACTIVE" } });
    try {
      await refused("bci.viewer", /not active/);
    } finally {
      await prisma.user.update({ where: { username: "bci.viewer" }, data: { status: "ACTIVE" } });
    }
  });

  it("refuses a demo login whose only company is suspended, as sign-in would (§63)", async () => {
    const bci = companyId("BUILDING_CONSTRUCTION_INVEST");
    const viewer = await prisma.user.findUniqueOrThrow({ where: { username: "bci.viewer" }, select: { memberships: { select: { companyId: true } } } });
    expect(viewer.memberships.map((membership) => membership.companyId)).toEqual([bci]);
    await prisma.company.update({ where: { id: bci }, data: { status: "SUSPENDED" } });
    try {
      // The Owner signs in with BCI suspended, so he starts in the next of his companies.
      await refused("bci.viewer", /no active company/);
    } finally {
      await prisma.company.update({ where: { id: bci }, data: { status: "ACTIVE" } });
    }
  });

  it("refuses a demo login whose password is not the demo password, so no session is ended for nothing (§20)", async () => {
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { username: "bci.viewer" }, select: { passwordHash: true } });
    await prisma.user.update({ where: { username: "bci.viewer" }, data: { passwordHash: await hashPassword("a-password-of-its-own") } });
    try {
      await refused("bci.viewer", /demo password was refused/);
    } finally {
      await prisma.user.update({ where: { username: "bci.viewer" }, data: { passwordHash } });
    }
  });

  it("is not there outside development: no session ends and nobody signs in (§12, §59)", async () => {
    const before = await signInOnTheForm("armaar.owner");
    const signIns = browser.signIns;
    browser.dev = false;
    await expect(switchTo("armaar.finance")).resolves.toEqual({ ok: false, error: "Not found." });
    await expect(signInAsDemoAccountAction("armaar.finance")).resolves.toEqual({ error: "Demo sign-in is available in development only." });
    expect(browser.user).toEqual(before);
    expect(browser.signIns).toBe(signIns);
    expect(await prisma.session.findUnique({ where: { id: before.sessionId } })).not.toBeNull();
  });

  it("refuses while new sign-ins are paused, and the current session stands (AUD-06 RP-03)", async () => {
    const before = await signInOnTheForm("armaar.owner");
    const signIns = browser.signIns;
    const admin = await prisma.user.findFirstOrThrow({ where: { platformAccess: { status: "ACTIVE" } }, select: { id: true } });
    await prisma.platformSetting.upsert({
      where: { key: "maintenance.disableNewLogins" },
      create: { key: "maintenance.disableNewLogins", category: "maintenance", value: true, updatedByUserId: admin.id },
      update: { value: true },
    });
    try {
      const result = await switchTo("armaar.finance");
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/paused for maintenance/) });
      expect(result).not.toHaveProperty("landing");
      expect(browser.user).toEqual(before);
      expect(browser.signIns).toBe(signIns);
      expect(await prisma.session.findUnique({ where: { id: before.sessionId } })).not.toBeNull();
    } finally {
      await prisma.platformSetting.update({ where: { key: "maintenance.disableNewLogins" }, data: { value: false } });
    }
  });

  it("refuses a target whose sign-in is throttled, and the current session stands (AUD-06 RP-03)", async () => {
    const before = await signInOnTheForm("armaar.owner");
    const subjects = { account: "armaar.finance", ip: clientAddress(new Headers()) };
    for (let attempt = 0; attempt < 6; attempt += 1) await hitThrottle("AUTH_LOGIN", subjects);
    try {
      const result = await switchTo("armaar.finance");
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Too many recent sign-in attempts/) });
      expect(browser.user).toEqual(before);
      expect(await prisma.session.findUnique({ where: { id: before.sessionId } })).not.toBeNull();
    } finally {
      await clearThrottle("AUTH_LOGIN", { account: "armaar.finance" });
    }
  });

  it("sends the browser to sign in when the new sign-in fails after the old session ended (§46)", async () => {
    const before = await signInOnTheForm("armaar.owner");
    browser.refuseSignIn = true;
    await expect(switchTo("armaar.finance")).resolves.toEqual({ ok: false, error: "Could not switch demo user.", landing: "/login?reason=demo-switch-failed" });
    expect(browser.user).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: before.sessionId } })).toBeNull();
  });
});

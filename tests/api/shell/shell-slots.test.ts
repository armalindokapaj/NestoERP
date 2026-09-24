import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { GET as criticalAnnouncement } from "@/app/api/shell/critical-announcement/route";
import { GET as shellWorkspaces } from "@/app/api/shell/workspaces/route";
import { ROLE_KEYS } from "@/config/roles";
import { prisma as app } from "@/lib/database/prisma";
import { listAvailableActions } from "@/lib/modules/quick-create/quick-create.service";
import { resolveShellCore } from "@/lib/workspace/shell-core";
import { listWorkspaces } from "@/lib/workspace/workspace.service";
import { actAs } from "@/tests/security/harness/actor";
import { cleanupSessions, loginAs, prisma } from "@/tests/helpers";

vi.mock("@/lib/context/resolve-user-context", () => import("@/tests/security/harness/actor"));

/**
 * The shell core and the slot retry endpoints (NAV-02 API-01, API-02,
 * COMPAT-01, COMPAT-02; S08, S11, V03).
 */

afterEach(() => {
  vi.restoreAllMocks();
  actAs(null);
});
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

function total(workspaces: Awaited<ReturnType<typeof listWorkspaces>>): number {
  return (workspaces.parentGroup.groupViewAllowed ? 1 : 0) + workspaces.companies.length + workspaces.otherGroups.reduce((sum, group) => sum + group.companies.length, 0);
}

describe("the shell core", () => {
  it("knows whether there is a choice to make exactly when the chooser would offer one, for every role", async () => {
    for (const role of ROLE_KEYS.filter((key) => key !== "PLATFORM_ADMIN")) {
      const context = await loginAs(role);
      const [core, workspaces] = await Promise.all([resolveShellCore(context), listWorkspaces(context)]);
      expect(core.workspaceChoice, role).toBe(total(workspaces) >= 2);
    }
  });

  it("draws + Create from the session's own context, before and without the chooser (S08, COMPAT-02)", async () => {
    for (const role of ["OWNER", "PROJECT_MANAGER", "VIEWER", "FINANCE"] as const) {
      const context = await loginAs(role);
      const memberships = vi.spyOn(app.companyMember, "findMany");
      const [core, menu] = await Promise.all([resolveShellCore(context), listAvailableActions(context)]);
      expect(core.quickCreate.canOpen, role).toBe(menu.actions.length > 0);
      expect(core.quickCreate.contextKey, role).toBe(menu.contextKey);
      // No membership list was read for it: that is the chooser's, and it streams.
      expect(memberships, role).not.toHaveBeenCalled();
      memberships.mockRestore();
    }
  });

  it("in the Group workspace, knows Group entry at once; in a company it is pending (COMPAT-01)", async () => {
    const inGroup = await loginAs("OWNER", { workspace: "GROUP" });
    expect((await resolveShellCore(inGroup)).groupEntry).toEqual({ status: "ready", canEnter: true });
    const inCompany = await loginAs("OWNER");
    expect((await resolveShellCore(inCompany)).groupEntry).toEqual({ status: "pending" });
    expect((await resolveShellCore(inCompany)).activeWorkspace).toMatchObject({ scopeType: "COMPANY", label: inCompany.company.name, groupLabel: inCompany.parentGroup.name });
  });
});

describe("the slot retry endpoints (API-02)", () => {
  it("answer the caller's own workspaces with the shell's context key, privately", async () => {
    const owner = await loginAs("OWNER");
    actAs(owner);
    const response = await shellWorkspaces();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.contextKey).toBe((await resolveShellCore(owner)).contextKey);
    expect(body.data.workspaces.companies.map((company: { id: string }) => company.id)).toContain(owner.companyId);
  });

  it("take no identity from the request (V03): another member's id in the URL changes nothing", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const owner = await loginAs("OWNER");
    actAs(pm);
    // The handler takes no request at all; whatever a caller appends is never read.
    const response = await (shellWorkspaces as unknown as (request: Request) => Promise<Response>)(new Request(`http://localhost/api/shell/workspaces?userId=${owner.userId}&companyId=${owner.companyId}`));
    const body = await response.json();
    expect(body.data.contextKey).toBe((await resolveShellCore(pm)).contextKey);
    expect(body.data.workspaces.companies.every((company: { id: string }) => company.id === pm.companyId)).toBe(true);
  });

  it("answer the banner with one row query and no unread count (S11)", async () => {
    actAs(await loginAs("ENGINEER"));
    const count = vi.spyOn(app.announcement, "count");
    const findFirst = vi.spyOn(app.announcement, "findFirst");
    const response = await criticalAnnouncement();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toHaveProperty("banner");
    expect(count).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("refuse a signed-out caller", async () => {
    expect((await shellWorkspaces()).status).toBe(401);
    expect((await criticalAnnouncement()).status).toBe(401);
  });

  it("answer a failure as an error, never as an empty chooser (S18)", async () => {
    actAs(await loginAs("OWNER"));
    vi.spyOn(app.companyMember, "findMany").mockRejectedValue(new Error("statement timeout") as never);
    const response = await shellWorkspaces();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("statement timeout");
  });
});

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { isPermission, type Permission } from "@/config/permissions";
import { permissionsForRole } from "@/config/role-defaults";
import { HELP_VERSION, MODULE_HELP } from "@/lib/help/help-content";
import { helpHref, moduleForHelpSlug } from "@/lib/help/help-routes";
import { START_HERE_LIMIT, startHereFor, type StartHereAccess } from "@/lib/modules/dashboard/dashboard.start-here";

/**
 * AUD-05 §7: module Help (UX-16) and the dashboard's Start here (UX-15).
 */

const APP = join(process.cwd(), "app", "(nesto)");
function pageExists(route: string): boolean {
  const parts = route.split("?")[0].split("/").filter(Boolean);
  const walk = (dir: string, index: number): boolean => {
    if (!existsSync(dir)) return false;
    if (readdirSync(dir).some((name) => name.startsWith("(") && walk(join(dir, name), index))) return true;
    if (index === parts.length) return existsSync(join(dir, "page.tsx"));
    if (walk(join(dir, parts[index]), index + 1)) return true;
    return readdirSync(dir).some((name) => name.startsWith("[") && !name.startsWith("[...") && walk(join(dir, name), index + 1));
  };
  return walk(APP, 0);
}

describe("module Help (UX-16)", () => {
  it("covers every module, with a purpose and a permissions line", () => {
    for (const key of MODULE_KEYS) {
      expect(MODULE_HELP[key], key).toBeDefined();
      expect(MODULE_HELP[key].purpose.length, key).toBeGreaterThan(20);
      expect(MODULE_HELP[key].permissions.length, key).toBeGreaterThan(20);
    }
  });

  it("writes out the acceptance journeys' modules", () => {
    for (const key of ["tasks", "approvals", "finance", "projects", "dailyLogs"] as ModuleKey[]) {
      expect(MODULE_HELP[key].detailed, key).toBe(true);
      expect(MODULE_HELP[key].terms.length, key).toBeGreaterThanOrEqual(4);
      expect(MODULE_HELP[key].actions.length, key).toBeGreaterThanOrEqual(3);
    }
  });

  it("names only real permissions and real pages", () => {
    for (const key of MODULE_KEYS) {
      for (const action of MODULE_HELP[key].actions) {
        expect(isPermission(action.permission), `${key}: ${action.permission}`).toBe(true);
        if (action.href) expect(pageExists(action.href), `${key}: ${action.href}`).toBe(true);
      }
    }
  });

  it("has an address per module that reads like the module and round-trips", () => {
    expect(helpHref("dailyLogs")).toBe("/help/daily-logs");
    expect(helpHref("contracts")).toBe("/help/contracts");
    for (const key of MODULE_KEYS) expect(moduleForHelpSlug(helpHref(key).replace("/help/", "")), key).toBe(key);
    expect(moduleForHelpSlug("dailyLogs")).toBeNull();
    expect(moduleForHelpSlug("../settings")).toBeNull();
    expect(pageExists("/help")).toBe(true);
    expect(pageExists("/help/:module")).toBe(true);
  });

  it("is versioned, and reached from every module header", () => {
    expect(HELP_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    const header = readFileSync(join(process.cwd(), "components/modules/module-page.tsx"), "utf8");
    expect(header).toContain("<HelpEntry");
  });

  it("is loaded by its own page, never with the module (no help text in the module header's bundle)", () => {
    const entry = readFileSync(join(process.cwd(), "components/help/help-entry.tsx"), "utf8");
    expect(entry).not.toContain("help-content");
    expect(entry).not.toMatch(/^"use client"/);
  });
});

describe("Start here (UX-15)", () => {
  function access(permissions: readonly string[], scope: "GROUP" | "COMPANY" = "COMPANY", disabled: ModuleKey[] = []): StartHereAccess {
    const held = new Set(permissions);
    return { scope, holds: (permission: Permission) => held.has(permission), enabled: (module) => !disabled.includes(module) };
  }
  const empty = { hasProjects: false, hasTasks: false };

  it("gives a creator at most three steps they may take, on a genuinely empty view", () => {
    const result = startHereFor(access(permissionsForRole("OWNER")), empty);
    expect(result.kind).toBe("steps");
    if (result.kind !== "steps") return;
    expect(result.steps.length).toBeLessThanOrEqual(START_HERE_LIMIT);
    expect(result.steps[0]).toMatchObject({ label: "New project", href: "/projects/new" });
  });

  it("never tells a Viewer to create anything", () => {
    const result = startHereFor(access(permissionsForRole("VIEWER")), empty);
    expect(result.kind).toBe("waiting");
  });

  it("shows nothing once there is real work, or nothing it could judge by", () => {
    expect(startHereFor(access(permissionsForRole("OWNER")), { hasProjects: true, hasTasks: false }).kind).toBe("none");
    expect(startHereFor(access(permissionsForRole("OWNER")), { hasProjects: false, hasTasks: true }).kind).toBe("none");
    expect(startHereFor(access(permissionsForRole("OWNER")), { hasProjects: null, hasTasks: null }).kind).toBe("none");
  });

  it("shows nothing in the Group workspace", () => {
    expect(startHereFor(access(permissionsForRole("OWNER"), "GROUP"), empty).kind).toBe("none");
  });

  it("offers only steps whose module is on and whose every grant is held", () => {
    const withoutProjects = startHereFor(access(permissionsForRole("OWNER"), "COMPANY", ["projects"]), empty);
    expect(withoutProjects.kind === "steps" && withoutProjects.steps.some((step) => step.href === "/projects/new")).toBe(false);
    // Invite without the right to give a role: the Team invitation would refuse, so it is not offered.
    const inviteOnly = startHereFor(access(["task.view", "project.view", "team.member.invite"]), empty);
    expect(inviteOnly.kind).toBe("waiting");
  });

  it("offers a creator of every role steps that are theirs", () => {
    for (const role of ["PROJECT_MANAGER", "FINANCE", "SALES", "ENGINEER", "HR"] as const) {
      const permissions = permissionsForRole(role);
      const result = startHereFor(access(permissions), empty);
      if (result.kind !== "steps") continue;
      for (const step of result.steps) expect(pageExists(step.href), `${role}: ${step.href}`).toBe(true);
    }
  });
});

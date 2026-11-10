import { describe, expect, it } from "vitest";

import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { roleModuleAccess } from "@/config/role-defaults";
import { ROLE_KEYS, type RoleKey } from "@/config/roles";
import { settingsSections } from "@/config/settings";
import { visibleSettingsSections } from "@/lib/access/settings-sections";
import { buildModuleAccess } from "@/lib/context/build-context";
import type { ModuleAccess } from "@/lib/context/types";

/**
 * Settings visibility per role (PRD #5 §39).
 *
 * Profile and Appearance are personal — they describe the person, not the
 * company — so they belong to every authenticated role. The company sections
 * are a different matter and stay behind settings.manage.
 */
function accessFor(role: RoleKey) {
  const moduleAccess = Object.fromEntries(
    MODULE_KEYS.map((moduleKey): [ModuleKey, ModuleAccess] => {
      const preset = roleModuleAccess[role][moduleKey];
      return [
        moduleKey,
        {
          module: moduleKey,
          accessLevel: preset.accessLevel,
          scope: preset.scope,
          permissions: [...preset.permissions],
          // Every module switched on, so the only thing under test is the role.
          enabled: true,
        },
      ];
    }),
  ) as Record<ModuleKey, ModuleAccess>;

  const permissions = Object.values(moduleAccess).flatMap((access) => access.permissions);

  return { permissions, moduleAccess };
}

/** A member of `role` holding CEO access: the CEO's rights laid over their own (2026-11). */
function holderAccess(role: RoleKey) {
  const moduleAccess = buildModuleAccess(role, [...MODULE_KEYS], "MEMBER", [], { role: "CEO", position: "MEMBER" });
  return { permissions: Object.values(moduleAccess).flatMap((access) => access.permissions), moduleAccess };
}

const PERSONAL = settingsSections.filter((section) => section.personal).map((s) => s.slug);

describe("visibleSettingsSections", () => {
  /**
   * The regression this exists for: the user menu used to hide its Settings
   * link behind Settings *module* access, which left twelve of the sixteen
   * roles with no route to their own theme preferences. The link is now
   * offered to everyone, so /settings must never be an empty page.
   */
  it("gives every role its personal sections, whatever its module access", () => {
    expect(PERSONAL).toEqual(["profile", "appearance", "notifications", "security"]);

    for (const role of ROLE_KEYS) {
      const slugs = visibleSettingsSections(accessFor(role)).map((section) => section.slug);
      for (const personal of PERSONAL) {
        expect(slugs, `${role} cannot reach ${personal}`).toContain(personal);
      }
    }
  });

  /**
   * Settings management is the floor for every company section, not the whole
   * rule. A section may carry a narrower permission of its own — Audit does,
   * because it is evidence about administrators as much as anyone else, and an
   * Admin is not automatically an audit reader (PRD #28 §222-§225).
   */
  it("never shows a company section to a role without settings.manage", () => {
    for (const role of ROLE_KEYS) {
      const access = accessFor(role);
      const slugs = visibleSettingsSections(access).map((section) => section.slug);
      const mayManage = access.permissions.includes("settings.manage");

      for (const section of settingsSections.filter((s) => !s.personal)) {
        // Users and Roles are Team administration's doors from Company Settings
        // (CEO Users & Roles §5): their own Team permission is the rule.
        const teamDoor = section.slug === "users" || section.slug === "roles";
        const expected =
          (teamDoor || mayManage) &&
          access.moduleAccess.settings.accessLevel !== "NONE" &&
          access.permissions.includes(section.permission);
        expect(slugs.includes(section.slug), `${role} sees ${section.slug}`).toBe(expected);
      }
    }
  });

  /*
   * The CEO manages the company's settings as the Owner does (the user,
   * 2026-11-10: "CEO can."), and so does a member holding CEO access. The audit
   * log is the one company section that stays the Owner's.
   */
  it("opens every section but Audit to the CEO and to a CEO access holder", () => {
    const allButAudit = settingsSections.map((section) => section.slug).filter((slug) => slug !== "audit");
    expect(visibleSettingsSections(accessFor("CEO")).map((section) => section.slug)).toEqual(allButAudit);
    expect(visibleSettingsSections(holderAccess("ARCHITECT")).map((section) => section.slug)).toEqual(allButAudit);
  });

  it("gives the CEO and a CEO access holder the company's settings, and not the audit log or the Owner and Group IT seats", () => {
    for (const [who, access] of [["CEO", accessFor("CEO")], ["Architect with CEO access", holderAccess("ARCHITECT")], ["Viewer with CEO access", holderAccess("VIEWER")]] as const) {
      for (const permission of [
        "settings.manage",
        "company.manage",
        "company.settings.update",
        "company.finance_settings.manage",
        "company.modules.manage",
        "company.integrations.manage",
        "company.numbering.manage",
        "company.localization.manage",
        "company.security_settings.manage",
        "security.policy.manage",
        "security.devices.revoke",
        "security.sessions.revoke",
        "company.storage.view",
      ] as const) {
        expect(access.permissions.includes(permission), `${who} holds ${permission}`).toBe(true);
      }
      for (const permission of ["audit.view", "audit.export", "audit.sensitive.view", "team.owner.assign", "team.group_role.assign"] as const) {
        expect(access.permissions.includes(permission), `${who} holds ${permission}`).toBe(false);
      }
    }
  });

  it("keeps Audit away from every role except the Owner", () => {
    for (const role of ROLE_KEYS) {
      const slugs = visibleSettingsSections(accessFor(role)).map((section) => section.slug);
      expect(slugs.includes("audit"), `${role} sees audit`).toBe(role === "OWNER");
    }
  });

  it("opens every section to an owner", () => {
    const slugs = visibleSettingsSections(accessFor("OWNER")).map((section) => section.slug);
    expect(slugs).toEqual(settingsSections.map((section) => section.slug));
  });

  it("hides the company sections once Settings is switched off for the company", () => {
    const access = accessFor("OWNER");
    const withoutSettings = {
      ...access,
      moduleAccess: {
        ...access.moduleAccess,
        settings: { ...access.moduleAccess.settings, enabled: false },
      },
    };

    const slugs = visibleSettingsSections(withoutSettings).map((section) => section.slug);
    expect(slugs).toEqual(PERSONAL);
  });
});

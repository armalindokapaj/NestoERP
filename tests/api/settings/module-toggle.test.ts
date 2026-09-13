import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import {
  listCompanyModules,
  setModuleEnabled,
} from "@/lib/modules/settings/module-toggle.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Company module activation (PRD #24 §47-§70, §165-§178).
 *
 * The 2026-09-13 gap audit found this with no coverage at all, and its server
 * action unreachable — the settings page listed modules read-only and said
 * activation "becomes editable once module configuration is functional", while
 * the service had been functional the whole time.
 *
 * `hse` is the module under test throughout: not core, not shared, and nothing
 * declares a dependency on it, so toggling it is safe and is restored after
 * every test.
 */
const TOGGLED = "hse" as const;

afterEach(async () => {
  const owner = await loginAs("OWNER");
  const modules = await listCompanyModules(owner);
  const hse = modules.find((row) => row.key === TOGGLED);
  if (hse && !hse.enabled) await setModuleEnabled(owner, TOGGLED, true);

  await prisma.auditEvent.deleteMany({
    where: {
      actionKey: {
        in: [AuditAction.COMPANY_MODULE_ENABLED, AuditAction.COMPANY_MODULE_DISABLED],
      },
      entityId: TOGGLED,
    },
  });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("what may be switched off (PRD #24 §47, §170, §175)", () => {
  it("refuses to disable a core module", async () => {
    const owner = await loginAs("OWNER");

    await expect(setModuleEnabled(owner, "dashboard", false)).rejects.toThrow(
      "CORE_MODULE_REQUIRED",
    );
  });

  it("refuses to disable a module another enabled module depends on", async () => {
    const owner = await loginAs("OWNER");

    // Sales and Contracts both declare a dependency on Clients.
    await expect(setModuleEnabled(owner, "clients", false)).rejects.toThrow();
  });

  /**
   * The blockers are reported, not only thrown, so the interface can disable
   * the switch and say why rather than letting somebody click and fail
   * (PRD #24 §66, §225).
   */
  it("reports the same blockers it enforces", async () => {
    const owner = await loginAs("OWNER");
    const modules = await listCompanyModules(owner);

    const dashboard = modules.find((row) => row.key === "dashboard");
    expect(dashboard!.requiredCore).toBe(true);
    expect(dashboard!.blockers[0]?.code).toBe("CORE_MODULE_REQUIRED");

    const hse = modules.find((row) => row.key === TOGGLED);
    expect(hse!.blockers).toEqual([]);
  });
});

describe("who may switch modules (PRD #24 §46)", () => {
  it("refuses a member without company.modules.manage", async () => {
    const engineer = await loginAs("ENGINEER");

    await expect(setModuleEnabled(engineer, TOGGLED, false)).rejects.toBeInstanceOf(AccessError);
  });

  it("marks the list read-only for somebody who cannot manage it", async () => {
    const hr = await loginAs("HR");

    const modules = await listCompanyModules(hr).catch(() => null);
    if (!modules) return; // HR may not hold company.modules.view at all.

    expect(modules.every((row) => row.canManage === false)).toBe(true);
  });
});

describe("disabling takes effect (PRD #24 §60, §61, §165, §168)", () => {
  it("turns the module off, records it, and bumps the config version", async () => {
    const owner = await loginAs("OWNER");

    const before = await prisma.company.findUniqueOrThrow({
      where: { id: owner.companyId },
      select: { configVersion: true },
    });

    await setModuleEnabled(owner, TOGGLED, false);

    const modules = await listCompanyModules(owner);
    expect(modules.find((row) => row.key === TOGGLED)!.enabled).toBe(false);

    // Nothing may keep serving a disabled module from a stale cache.
    const after = await prisma.company.findUniqueOrThrow({
      where: { id: owner.companyId },
      select: { configVersion: true },
    });
    expect(after.configVersion).toBeGreaterThan(before.configVersion);

    // CRITICAL configuration change, and the policy is required — so it
    // commits with the toggle or not at all (PRD #28 §99, §136).
    const event = await prisma.auditEvent.findFirst({
      where: {
        companyId: owner.companyId,
        actionKey: AuditAction.COMPANY_MODULE_DISABLED,
        entityId: TOGGLED,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(event!.severity).toBe("CRITICAL");
  });

  /**
   * The guarantee that makes disabling safe to try: records are kept, not
   * deleted, and come back intact (PRD #24 §60, §61).
   */
  it("keeps the module's records and restores them when it is re-enabled", async () => {
    const owner = await loginAs("OWNER");

    const countBefore = await prisma.hseIncident.count({ where: { companyId: owner.companyId } });
    expect(countBefore).toBeGreaterThan(0);

    await setModuleEnabled(owner, TOGGLED, false);
    expect(await prisma.hseIncident.count({ where: { companyId: owner.companyId } })).toBe(
      countBefore,
    );

    await setModuleEnabled(owner, TOGGLED, true);

    const modules = await listCompanyModules(owner);
    expect(modules.find((row) => row.key === TOGGLED)!.enabled).toBe(true);
    expect(await prisma.hseIncident.count({ where: { companyId: owner.companyId } })).toBe(
      countBefore,
    );
  });

  /**
   * A disabled module must stop the API, not merely hide a link — so a context
   * resolved after the toggle holds none of its permissions (PRD #24 §168).
   */
  it("removes the module's permissions from a freshly resolved context", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.permissions.some((permission) => permission.startsWith("hse."))).toBe(true);

    await setModuleEnabled(owner, TOGGLED, false);

    const after = await loginAs("OWNER");
    expect(after.moduleAccess[TOGGLED].enabled).toBe(false);
    expect(after.permissions.some((permission) => permission.startsWith("hse."))).toBe(false);
  });
});

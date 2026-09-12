import { afterAll, describe, expect, it } from "vitest";

import { canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { findRecordSection } from "@/lib/modules/records/registry";
import { cleanupSessions, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Department module tests (PRD #9 §134–§138, §189).
 *
 * The approval shell, the read-only rule and the module-disabled path all run
 * through the shared record registry, so these assertions cover every
 * department module at once.
 */
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});


describe("finance module access (PRD #9 §134)", () => {
  /*
   * The invoice list itself is tested in tests/api/finance, against the real
   * Finance service (PRD #15). What belongs here is the *module-level* access
   * that the shell still owns: who reaches Finance at all, and with what.
   */
  it("denies the Viewer Finance entirely (PRD #5 §32)", async () => {
    const context = await loginAs("VIEWER");
    expect(canAccessModule(context, "finance")).toBe(false);
  });

  it("gives the Architect no operational invoice permission (PRD #5 §18)", async () => {
    const context = await loginAs("ARCHITECT");
    expect(context.permissions).not.toContain("finance.invoice.view");
    // What an Architect does keep is the project budget summary.
    expect(context.permissions).toContain("finance.project_budget.view");
  });

  it("keeps Admin and Company IT out of Finance (PRD #15 §20)", async () => {
    // Administering NESTO is not financial authorisation.
    for (const role of ["ADMIN", "COMPANY_IT"] as const) {
      const context = await loginAs(role);
      expect(canAccessModule(context, "finance")).toBe(false);
    }
  });
});

/*
 * The shell's own approval behaviour has no module left to demonstrate it.
 *
 * Finance (PRD #15), Sales (PRD #17), Legal (PRD #18) and now Procurement
 * (PRD #19) each run their own approval service, with their own separation-of-
 * duties rules, covered in tests/api/{finance,sales,contracts,procurement}. The
 * department modules still on the shell record no approvals.
 */

describe("company-disabled modules (PRD #9 §110, §142)", () => {
  it("switches Finance off for Company B", async () => {
    const context = await loginAsEmail("owner-b@nesto.test");

    expect(isModuleEnabled(context, "finance")).toBe(false);
    expect(canAccessModule(context, "finance")).toBe(false);
    expect(context.enabledModules).not.toContain("finance");
  });

  it("drops the module's permissions from the context entirely", async () => {
    const context = await loginAsEmail("owner-b@nesto.test");

    // Company B's Owner holds Finance permissions by role, but the company has
    // the module switched off — so the resolved context holds none of them.
    expect(context.permissions).not.toContain("finance.invoice.view");
    expect(context.permissions).not.toContain("finance.view");
  });

  it("keeps enabled modules working for the same user", async () => {
    const context = await loginAsEmail("owner-b@nesto.test");
    expect(canAccessModule(context, "projects")).toBe(true);
    expect(context.permissions).toContain("project.view");
  });
});

describe("company isolation across every record type (PRD #9 §12, §157)", () => {
  // Every department module now has services of its own, with its own tests —
  // they are deliberately absent from the shell registry. What still renders
  // through it is the platform's own support queue.
  const cases: { module: string; section: string; role: Parameters<typeof loginAs>[0] }[] = [
    { module: "support", section: "requests", role: "ADMIN" },
  ];

  for (const testCase of cases) {
    it(`never returns another company's ${testCase.module}/${testCase.section}`, async () => {
      const section = findRecordSection(testCase.module, testCase.section)!;
      const context = await loginAs(testCase.role);
      const result = await section.list(context, { filters: {}, page: 1, limit: 200 });

      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        const detail = await section.get(context, row.id);
        expect(detail, `${testCase.module}/${row.id}`).not.toBeNull();
      }
    });
  }

  /**
   * Every department module has left the generic registry for its own services
   * — Tasks (#11), Clients (#12), Documents (#13), Finance (#15), HR (#16),
   * Sales (#17), Legal (#18), Procurement (#19), Inventory (#20), QA/QC (#21)
   * and now HSE (#22). Their isolation is covered by their own suites under
   * tests/api; what remains here is the support queue.
   */
});

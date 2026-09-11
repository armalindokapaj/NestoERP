import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
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

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

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

describe("approval shell (PRD #9 §189)", () => {
  /*
   * Finance has graduated out of the record shell (PRD #15), so the invoice
   * cases that used to live here are now in tests/api/finance — against the
   * real approval service, with its own separation-of-duties rules. What is
   * left is the shell's own approval behaviour, which Procurement still uses.
   */
  const requests = findRecordSection("procurement", "requests")!;

  afterEach(async () => {
    await prisma.purchaseRequest.updateMany({
      where: { reference: "PR-001" },
      data: { status: "PENDING_APPROVAL", approvedBy: null, approvedAt: null },
    });
  });

  it("approves a purchase request for a permitted approver", async () => {
    const context = await loginAs("CEO");
    const request = await prisma.purchaseRequest.findFirstOrThrow({
      where: { reference: "PR-001" },
    });

    await requests.decide!(context, request.id, "APPROVE");

    const after = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe("APPROVED");
  });

  it("refuses a non-approver (PRD #9 §189)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const request = await prisma.purchaseRequest.findFirstOrThrow({
      where: { reference: "PR-001" },
    });

    await expectError(requests.decide!(context, request.id, "APPROVE"), "FORBIDDEN");
  });

  it("refuses the Viewer outright", async () => {
    const context = await loginAs("VIEWER");
    const request = await prisma.purchaseRequest.findFirstOrThrow({
      where: { reference: "PR-001" },
    });

    await expectError(requests.decide!(context, request.id, "APPROVE"), "FORBIDDEN");
  });

  it("refuses a record that is not awaiting a decision (PRD #9 §190)", async () => {
    const context = await loginAs("CEO");
    const ordered = await prisma.purchaseRequest.findFirstOrThrow({
      where: { reference: "PR-002" },
    });

    await expectError(requests.decide!(context, ordered.id, "APPROVE"), "CONFLICT");
  });
});

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
  // Finance, HR and Sales are real modules now, with their own services and
  // their own tests — they are deliberately absent from the shell registry.
  const cases: { module: string; section: string; role: Parameters<typeof loginAs>[0] }[] = [
    { module: "contracts", section: "contracts", role: "LEGAL" },
    { module: "procurement", section: "requests", role: "PROCUREMENT" },
    { module: "inventory", section: "items", role: "INVENTORY" },
    { module: "qaqc", section: "inspections", role: "QAQC" },
    { module: "hse", section: "incidents", role: "HSE" },
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
   * Tasks (PRD #11), Clients (PRD #12) and Documents (PRD #13) have left the
   * generic registry for their own services. Their isolation is covered by
   * tests/api/{tasks,clients,documents}; what remains here is the department
   * modules still rendering through the shell.
   */
});

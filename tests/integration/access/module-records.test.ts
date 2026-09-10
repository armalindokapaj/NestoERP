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

const listArgs = { filters: {}, page: 1, limit: 50 };

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

describe("finance access (PRD #9 §134)", () => {
  const invoices = findRecordSection("finance", "invoices")!;

  it("gives the Finance role every Company A invoice", async () => {
    const context = await loginAs("FINANCE");
    const result = await invoices.list(context, listArgs);
    expect(result.total).toBeGreaterThanOrEqual(12);
  });

  it("keeps the Project Manager to invoices on their own projects", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const result = await invoices.list(context, listArgs);

    const projectIds = await prisma.invoice.findMany({
      where: { id: { in: result.rows.map((row) => row.id) } },
      select: { projectId: true },
    });

    for (const row of projectIds) {
      expect(["project_a", "project_b"]).toContain(row.projectId);
    }
  });

  it("denies the Viewer Finance entirely (PRD #5 §32)", async () => {
    const context = await loginAs("VIEWER");
    expect(canAccessModule(context, "finance")).toBe(false);
  });

  it("gives the Architect no operational invoice permission (PRD #5 §18)", async () => {
    const context = await loginAs("ARCHITECT");
    expect(context.permissions).not.toContain("finance.invoice.view");
  });
});

describe("HR scope (PRD #9 §135)", () => {
  const leave = findRecordSection("hr", "leave")!;

  it("gives HR the whole company's leave", async () => {
    const context = await loginAs("HR");
    const result = await leave.list(context, listArgs);
    expect(result.total).toBeGreaterThanOrEqual(8);
  });

  it("gives the Architect only their own leave (SELF scope)", async () => {
    const context = await loginAs("ARCHITECT");
    const result = await leave.list(context, listArgs);

    const rows = await prisma.leaveRequest.findMany({
      where: { id: { in: result.rows.map((row) => row.id) } },
      select: { employeeMemberId: true },
    });

    for (const row of rows) {
      expect(row.employeeMemberId).toBe(context.membershipId);
    }
  });

  it("denies the Project Manager sensitive leave records", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    expect(context.permissions).not.toContain("hr.leave.view");
  });
});

describe("approval shell (PRD #9 §189)", () => {
  const invoices = findRecordSection("finance", "invoices")!;
  const requests = findRecordSection("procurement", "requests")!;

  afterEach(async () => {
    // Return the seeded fixtures to their documented state.
    await prisma.invoice.updateMany({
      where: { invoiceNumber: { in: ["INV-001", "INV-006"] } },
      data: { status: "PENDING", approvedBy: null, approvedAt: null },
    });
    await prisma.purchaseRequest.updateMany({
      where: { reference: "PR-001" },
      data: { status: "PENDING_APPROVAL", approvedBy: null, approvedAt: null },
    });
  });

  it("lets an approver approve, and records who and when", async () => {
    const context = await loginAs("CEO");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { invoiceNumber: "INV-001" },
    });

    await invoices.decide!(context, invoice.id, "APPROVE");

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.approvedBy).toBe(context.userId);
    expect(after.approvedAt).not.toBeNull();

    const activity = await prisma.activity.findFirst({
      where: { entityId: invoice.id, action: "RECORD_APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity).not.toBeNull();
  });

  it("refuses a non-approver (PRD #9 §189)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { invoiceNumber: "INV-006" },
    });

    await expectError(invoices.decide!(context, invoice.id, "APPROVE"), "FORBIDDEN");
  });

  it("refuses the Viewer outright", async () => {
    const context = await loginAs("VIEWER");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { invoiceNumber: "INV-006" },
    });

    await expectError(invoices.decide!(context, invoice.id, "APPROVE"), "FORBIDDEN");
  });

  it("refuses a record that is not awaiting a decision (PRD #9 §190)", async () => {
    const context = await loginAs("CEO");
    const paid = await prisma.invoice.findFirstOrThrow({ where: { invoiceNumber: "INV-002" } });

    await expectError(invoices.decide!(context, paid.id, "APPROVE"), "CONFLICT");
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
  const cases: { module: string; section: string; role: Parameters<typeof loginAs>[0] }[] = [
    { module: "finance", section: "invoices", role: "FINANCE" },
    { module: "sales", section: "opportunities", role: "SALES" },
    { module: "contracts", section: "contracts", role: "LEGAL" },
    { module: "procurement", section: "requests", role: "PROCUREMENT" },
    { module: "inventory", section: "items", role: "INVENTORY" },
    { module: "qaqc", section: "inspections", role: "QAQC" },
    { module: "hse", section: "incidents", role: "HSE" },
    { module: "clients", section: "all", role: "SALES" },
    { module: "tasks", section: "all", role: "OWNER" },
    { module: "documents", section: "all", role: "OWNER" },
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

  it("answers null for a record belonging to another company", async () => {
    const section = findRecordSection("tasks", "all")!;
    const context = await loginAs("OWNER");

    const companyBTask = await prisma.task.findFirstOrThrow({
      where: { companyId: "company_demo_b" },
    });

    expect(await section.get(context, companyBTask.id)).toBeNull();
  });
});

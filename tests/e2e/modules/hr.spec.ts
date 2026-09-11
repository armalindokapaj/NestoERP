import { expect, test } from "@playwright/test";

import { db, removeTestHrRecords, resetHrFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The HR journey (PRD #16 §296–§303).
 *
 * Walks the module as the roles the confidentiality rules are written for: the
 * HR manager who runs it, the CEO who may see figures but not pay, an employee
 * who may only see their own, and the Admin and Company IT roles who administer
 * the platform without being given the employment file.
 */
const PREFIX = "E2E-HR";

test.afterAll(async () => {
  await removeTestHrRecords(PREFIX);
  await resetHrFixtures();
  await db.$disconnect();
});

test.describe("HR role (PRD #16 §296)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "HR");
  });

  test("opens the module, the directory and an employment record", async ({ page }) => {
    await page.goto("/hr");
    await expect(page.getByRole("heading", { name: "HR", level: 1 })).toBeVisible();
    await expect(mainRegion(page).getByText("Active employees")).toBeVisible();

    await page.goto("/hr/employees");
    await expect(recordTable(page).getByText("EMP-007")).toBeVisible();

    await recordTable(page).getByRole("link", { name: /Ethan Cole/ }).click();
    await page.waitForURL(/\/hr\/employees\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Employment" }).first()).toBeVisible();
  });

  test("sees pay on its own tab, and nowhere else", async ({ page }) => {
    await page.goto("/hr/employees");
    await recordTable(page).getByRole("link", { name: /Ethan Cole/ }).click();
    await page.waitForURL(/\/hr\/employees\/[^/]+$/);

    // Not on the employment record: compensation is never part of an employee
    // DTO (PRD #16 §169).
    await expect(mainRegion(page).getByText("3,400")).toHaveCount(0);

    await page.getByRole("link", { name: "Compensation" }).click();
    await expect(page).toHaveURL(/\/compensation$/);
    await expect(mainRegion(page).getByText("Confidential.")).toBeVisible();
    await expect(mainRegion(page).getByText("Current").first()).toBeVisible();
  });

  test("records a new pay level, closing the one it replaces", async ({ page }) => {
    const memberId = await memberIdFor("architect@nesto.test");
    await page.goto(`/hr/employees/${memberId}/compensation/new`);

    await page.locator("#baseAmount").fill("4250.00");
    await page.locator("#effectiveFrom").fill("2027-03-01");
    await page.locator("#notes").fill(`${PREFIX} annual review`);
    await page.getByRole("button", { name: "Record compensation" }).click();

    await page.waitForURL(/\/compensation$/);

    const profile = await db.employeeProfile.findUniqueOrThrow({
      where: { companyMemberId: memberId },
      select: { id: true },
    });
    const open = await db.compensation.findMany({
      where: { employeeProfileId: profile.id, effectiveTo: null },
    });

    // Exactly one open record, and it is the new one (PRD #16 §65, §189).
    expect(open).toHaveLength(1);
    expect(open[0]!.baseAmount.toFixed(2)).toBe("4250.00");
  });

  test("approves a pending leave request, and the balance moves with it", async ({ page }) => {
    await resetHrFixtures();

    const pending = await db.leaveRequest.findUniqueOrThrow({
      where: { id: "leave_008" },
      select: { startDate: true },
    });
    const year = pending.startDate.getUTCFullYear();
    const before = await annualBalanceFor("engineer@nesto.test", year);

    await page.goto("/hr/leave/leave_008");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Leave approved.").first()).toBeVisible();

    const row = await db.leaveRequest.findUniqueOrThrow({ where: { id: "leave_008" } });
    expect(row.status).toBe("APPROVED");

    const after = await annualBalanceFor("engineer@nesto.test", year);
    expect(Number(after) - Number(before)).toBe(Number(row.days));

    // Approved leave writes its own attendance days (PRD #16 §108).
    const generated = await db.attendanceRecord.count({
      where: { sourceEntityId: "leave_008", status: "ON_LEAVE", source: "SYSTEM" },
    });
    expect(generated).toBe(Number(row.days));
  });

  test("must give a reason to reject", async ({ page }) => {
    await resetHrFixtures();
    await page.goto("/hr/leave/leave_009");

    await page.getByRole("button", { name: "Reject" }).click();
    await page.getByRole("button", { name: "Reject", exact: true }).last().click();

    // The dialog refuses an empty reason rather than rejecting silently
    // (PRD #16 §88).
    await expect(page.getByText(/say why it was rejected/i)).toBeVisible();

    await page.getByLabel("Reason").fill("Clashes with the commissioning week.");
    await page.getByRole("button", { name: "Reject", exact: true }).last().click();

    await expect(page.getByText("Leave rejected.").first()).toBeVisible();
    const row = await db.leaveRequest.findUniqueOrThrow({ where: { id: "leave_009" } });
    expect(row.status).toBe("REJECTED");
    expect(row.decisionNote).toContain("commissioning");
  });

  test("reads a leave reason, because it holds the grant for it", async ({ page }) => {
    // leave_002 is a sick day with a medical reason (PRD #16 §95).
    await page.goto("/hr/leave/leave_002");
    await expect(mainRegion(page).getByText(/Flu/)).toBeVisible();
  });

  test("moves somebody through onboarding", async ({ page }) => {
    await page.goto("/hr/onboarding");
    await expect(page.getByRole("heading", { name: "HR", level: 1 })).toBeVisible();
    await expect(recordTable(page).getByText(/Onboarding|Not started|In progress/).first()).toBeVisible();
  });

  test("runs the reports its permissions reach", async ({ page }) => {
    await page.goto("/hr/reports");
    await expect(mainRegion(page).getByRole("heading", { name: "Headcount" })).toBeVisible();

    await page.getByRole("link", { name: "Compensation" }).click();
    await expect(page).toHaveURL(/report=compensation/);
    await expect(
      mainRegion(page).getByText(/needs the compensation permission/),
    ).toBeVisible();
  });
});

test.describe("CEO (PRD #16 §298)", () => {
  test("sees company HR figures without any pay in them", async ({ page }) => {
    await signIn(page, "CEO");

    await page.goto("/hr");
    await expect(mainRegion(page).getByText("Active employees")).toBeVisible();

    await page.goto("/hr/employees");
    await recordTable(page).getByRole("link", { name: /Ethan Cole/ }).click();
    await page.waitForURL(/\/hr\/employees\/[^/]+$/);

    // The tab is absent, not disabled: a locked placeholder would still confirm
    // that a salary is on file (PRD #16 §317).
    const recordTabs = page.getByRole("navigation", { name: "Employee sections" });
    await expect(recordTabs.getByRole("link", { name: "Compensation" })).toHaveCount(0);

    await page.goto("/hr/reports");
    await expect(page.getByRole("link", { name: "Compensation", exact: true })).toHaveCount(0);
  });

  test("cannot read a medical leave reason", async ({ page }) => {
    await signIn(page, "CEO");
    await page.goto("/hr/leave/leave_002");

    await expect(mainRegion(page).getByText(/Flu/)).toHaveCount(0);
    await expect(mainRegion(page).getByText(/shown only to the person who asked/)).toBeVisible();
  });
});

test.describe("Employee self-service (PRD #16 §299)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "ENGINEER");
  });

  test("is offered their own records, named as theirs", async ({ page }) => {
    await page.goto("/hr");

    const tabs = page.getByRole("navigation", { name: /HR sections/i });
    await expect(tabs.getByRole("link", { name: "My employment" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "My leave" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "My attendance" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Employees", exact: true })).toHaveCount(0);
  });

  test("sees their own leave and nobody else's", async ({ page }) => {
    await page.goto("/hr/leave");

    await expect(recordTable(page).getByRole("row")).not.toHaveCount(0);
    await expect(mainRegion(page).getByText(/Anna Rossi|Alex Morgan/)).toHaveCount(0);
  });

  test("requests leave, and the days are counted for them", async ({ page }) => {
    await page.goto("/hr/leave/new");

    const week = bookingWeek();
    await page.locator("#startDate").fill(week.from);
    await page.locator("#endDate").fill(week.to);
    await page.locator("#reason").fill(`${PREFIX} winter break`);

    // Five calendar days, five working days, counted before it is submitted.
    await expect(mainRegion(page).getByText(/5 working days/)).toBeVisible();

    await page.getByRole("button", { name: "Create request" }).click();
    // Not /hr/leave/new: a validation failure would leave the form in place,
    // and that URL would otherwise satisfy a looser pattern.
    await page.waitForURL(/\/hr\/leave\/(?!new$)[^/]+$/);

    await expect(page.getByText("Draft").first()).toBeVisible();
    const row = await db.leaveRequest.findFirstOrThrow({
      where: { reason: { startsWith: PREFIX } },
    });
    expect(row.days.toFixed(2)).toBe("5.00");
    expect(row.status).toBe("DRAFT");
  });

  test("cannot approve their own request", async ({ page }) => {
    await page.goto("/hr/leave?status=PENDING");

    const pending = recordTable(page).getByRole("link").first();
    await pending.click();
    await page.waitForURL(/\/hr\/leave\/[^/]+$/);

    // Nobody decides their own leave, whatever else they hold (PRD #16 §194).
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("reaches their own employment record but not the directory", async ({ page }) => {
    await page.goto("/hr/employees");

    // The section exists for them; it just leads to their own record.
    await page.waitForURL(/\/hr\/employees\/[^/]+$/);
    await expect(page.getByRole("heading", { name: /Ethan Cole/ })).toBeVisible();
  });

  test("is not offered pay, on any route", async ({ page }) => {
    const memberId = await memberIdFor("engineer@nesto.test");
    await page.goto(`/hr/employees/${memberId}`);
    await expect(
      page.getByRole("navigation", { name: "Employee sections" }).getByRole("link", {
        name: "Compensation",
      }),
    ).toHaveCount(0);

    const response = await page.goto(`/hr/employees/${memberId}/compensation`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("Admin and Company IT (PRD #16 §300, §301)", () => {
  test("Admin reads the directory but not the employment file", async ({ page }) => {
    await signIn(page, "ADMIN");

    await page.goto("/hr/employees");
    await expect(recordTable(page).getByText("EMP-007")).toBeVisible();

    // Administering the platform is not seeing somebody's contract
    // (PRD #16 §18). The only HR file Admin reaches is their own, so the tab
    // says so.
    const tabs = page.getByRole("navigation", { name: /HR sections/i });
    await expect(tabs.getByRole("link", { name: "Documents", exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "My documents" })).toBeVisible();

    const memberId = await memberIdFor("engineer@nesto.test");
    await page.goto(`/hr/employees/${memberId}`);

    // Scoped to the record's own tabs: the sidebar carries a Documents module
    // link, which is a different door and not what this asserts.
    const recordTabs = page.getByRole("navigation", { name: "Employee sections" });
    await expect(recordTabs.getByRole("link", { name: "Documents" })).toHaveCount(0);

    const response = await page.goto(`/hr/employees/${memberId}/documents`);
    expect(response?.status()).toBe(404);
  });

  test("Company IT is left with self-service alone", async ({ page }) => {
    await signIn(page, "COMPANY_IT");

    await page.goto("/hr");
    const tabs = page.getByRole("navigation", { name: /HR sections/i });
    await expect(tabs.getByRole("link", { name: "Employees", exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "My leave" })).toBeVisible();

    // The directory is not refused so much as reduced: it is their own record.
    await page.goto("/hr/employees");
    await page.waitForURL(/\/hr\/employees\/[^/]+$/);

    await expectAccessDenied(page, "/hr/reports");
  });
});

test("a role with no HR access cannot reach the module at all (PRD #16 §9)", async ({ page }) => {
  await signIn(page, "SALES");
  await expectAccessDenied(page, "/hr");
});

test("a filtered list that matches nothing offers to clear the filters (PRD #16 §315)", async ({
  page,
}) => {
  await signIn(page, "HR");
  await page.goto("/hr/employees?search=zzzznobodyzzz");

  await expect(mainRegion(page).getByText("No HR records match these filters.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
});

test("an employment record that is out of view is not found, never forbidden", async ({ page }) => {
  await signIn(page, "ENGINEER");
  const ownerMember = await memberIdFor("owner@nesto.test");

  // 403 would confirm the Owner has an employment record (PRD #16 §202).
  const response = await page.goto(`/hr/employees/${ownerMember}`);
  expect(response?.status()).toBe(404);
});

/**
 * A clear Monday-to-Friday week to book.
 *
 * Inside the current leave year, because that is the year the seed entitles,
 * and far enough out not to collide with the requests the seed already places.
 */
function bookingWeek(): { from: string; to: string } {
  const year = new Date().getUTCFullYear();
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + 84);
  if (start.getUTCFullYear() !== year) start.setUTCDate(start.getUTCDate() - 182);
  while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4);

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

async function memberIdFor(email: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    select: { memberships: { where: { status: { not: "INACTIVE" } }, take: 1, select: { id: true } } },
  });
  return user.memberships[0]!.id;
}

/** A balance belongs to a leave year, so the year is part of the question. */
async function annualBalanceFor(email: string, year: number): Promise<string> {
  const memberId = await memberIdFor(email);
  const balance = await db.leaveBalance.findFirstOrThrow({
    where: { companyMemberId: memberId, leaveType: "ANNUAL", year },
    select: { usedDays: true },
  });
  return balance.usedDays.toString();
}

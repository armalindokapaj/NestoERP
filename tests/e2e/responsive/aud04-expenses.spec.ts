import { Prisma } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { memberId } from "../approvals-fixtures";
import { db, removeTestDocuments, removeTestFinanceRecords } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { expectInViewport, expectInputsAtLeast16px, expectNoPageOverflow, expectTouchTargets, outsideProjects } from "./geometry";

/**
 * AUD-04 §7 Expense entry on phones and tablets (MW-08, MW-09, MW-13, MW-15).
 *
 * Group Finance raises an expense at 360/390, 768/820 and 844×390: required
 * company/project/category/date/amount fields, validation that is visible
 * where the field is, save, reopen, edit, the receipt attached the way the
 * product attaches it (after the save, from the expense's Documents tab),
 * submit — and then the CEO, signed in as themself in a fresh session,
 * approves it. Saving never approves anything: the status is read back after
 * every step, on screen after a reload and in the database.
 *
 * The expense lives in Aurelia (company_demo_a), where Group Finance works and
 * the CEO decides expenses (AUD-10 journeys). Every record is prefixed and
 * removed afterwards, with its receipt.
 */

const PREFIX = "aud04d_";
const COMPANY = "company_demo_a";
const TARGETS = /aud04-(phone-360|phone-390|tablet-768|tablet-820|landscape-844|webkit-phone|firefox-phone)$/;
const PDF = (label: string) => Buffer.from(`%PDF-1.4\n${label}\n%%EOF\n`);

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, TARGETS), "expense entry is asserted at 360/390, 768/820 and 844×390");
});

test.afterAll(async () => {
  await removeTestDocuments(PREFIX);
  await removeTestFinanceRecords(PREFIX);
  await db.$disconnect();
});

/** A description unique to this project's run, so sizes never read each other's records. */
const label = (project: string, what: string) => `${PREFIX}${project} ${what}`;

/** A full user switch: the old session is gone before the next person signs in (PRD §7). */
async function switchUser(page: Page, role: "CEO" | "FINANCE", to: string) {
  await page.context().clearCookies();
  await signIn(page, role, { to });
}

async function draftExpense(description: string): Promise<string> {
  const finance = await memberId("finance@nesto.test", COMPANY);
  const row = await db.expense.create({
    data: {
      companyId: COMPANY,
      projectId: "project_a",
      expenseDate: new Date(),
      category: "MATERIALS",
      description,
      currency: "EUR",
      netAmount: new Prisma.Decimal("100"),
      taxAmount: new Prisma.Decimal("20"),
      totalAmount: new Prisma.Decimal("120"),
      status: "DRAFT",
      createdByMemberId: finance,
    },
    select: { id: true },
  });
  return row.id;
}

test("MW-13 an expense is raised, edited, given its receipt, submitted, and approved by a second person", async ({ page }, testInfo) => {
  const description = label(testInfo.project.name, "site fuel");
  await signIn(page, "FINANCE", { to: "/finance/expenses/new" });
  const main = mainRegion(page);
  await expect(main.getByRole("heading", { name: "New expense" })).toBeVisible();
  // Where the receipt goes is said before the first save (J-E4).
  await expect(main).toContainText("Attach the receipt from the expense’s Documents tab once it is saved.");
  await expectNoPageOverflow(page, "new expense");
  await expectInputsAtLeast16px(page, main);

  // Required fields are labelled and on screen, one column on a phone.
  for (const field of ["Description", "Category", "Expense date", "Project", "Currency", /^Net amount/]) {
    await expect(main.getByLabel(field).first()).toBeVisible();
  }
  const net = main.getByLabel(/^Net amount/);
  await expect(net).toHaveAttribute("inputmode", "decimal");

  // Refused before anything is sent: the missing description and an ambiguous amount, each said where it is.
  await net.fill("1,234");
  await main.getByRole("button", { name: "Create expense" }).click();
  await expect(main.getByText(/"1,234" is ambiguous/).first()).toBeVisible();
  await expect(main.getByLabel("Description")).toHaveAttribute("aria-invalid", "true");
  expect(await db.expense.count({ where: { description } })).toBe(0);

  await main.getByLabel("Description").fill(description);
  await main.getByLabel("Category").selectOption({ label: "Materials" });
  await main.getByLabel("Project").selectOption({ index: 1 });
  await net.fill("1 250,50");
  await main.getByLabel(/^Tax amount/).fill("250,10");
  await expect(main).toContainText("€1,500.60");
  const create = main.getByRole("button", { name: "Create expense" });
  await expectInViewport(create, "primary action");
  await create.click();

  await expect(page).toHaveURL(/\/finance\/expenses\/c[a-z0-9]+$/);
  const expenseId = page.url().split("/").pop()!;
  await expect(main.getByText("Draft").first()).toBeVisible();
  let stored = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
  expect(stored).toMatchObject({ status: "DRAFT", description });
  expect(stored.projectId).not.toBeNull();
  expect([stored.netAmount.toString(), stored.taxAmount.toString(), stored.totalAmount.toString()]).toEqual(["1250.5", "250.1", "1500.6"]);
  await expectNoPageOverflow(page, "expense detail");
  await expectTouchTargets(page, main.getByTestId("expense-receipt-hint"));

  // Reopened and edited.
  await page.reload();
  await main.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(new RegExp(`/finance/expenses/${expenseId}/edit$`));
  await expect(main.getByLabel(/^Net amount/)).toHaveValue(/^1250\.50?$/);
  await main.getByLabel(/^Net amount/).fill("1300");
  await main.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/finance/expenses/${expenseId}$`));
  await expect(main).toContainText("€1,550.10");
  stored = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
  expect(stored.totalAmount.toString()).toBe("1550.1");

  // The receipt, the product's way: the expense's Documents tab, after the save.
  await main.getByTestId("expense-receipt-hint").getByRole("link", { name: "Attach receipt" }).click();
  await expect(page).toHaveURL(new RegExp(`/finance/expenses/${expenseId}/documents$`));
  await main.getByRole("link", { name: "Add document" }).click();
  await expect(page).toHaveURL(/\/documents\/new\?/);
  const receipt = `${PREFIX}${testInfo.project.name}-receipt.pdf`;
  await page.getByLabel("Choose files to upload").setInputFiles({ name: receipt, mimeType: "application/pdf", buffer: PDF("receipt") });
  const row = mainRegion(page).getByTestId("upload-queue-item").filter({ hasText: receipt });
  await expect(row).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await mainRegion(page).getByRole("link", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/finance/expenses/${expenseId}/documents$`));
  await expect(main).toContainText(receipt.replace(/\.pdf$/, ""));
  const attached = await db.document.findMany({ where: { entityType: "expense", entityId: expenseId }, select: { storageStatus: true } });
  expect(attached).toEqual([{ storageStatus: "AVAILABLE" }]);

  // Submitted: pending, not approved — whatever the save said.
  await main.getByRole("link", { name: "Overview" }).click();
  const submit = main.getByRole("button", { name: "Submit for approval" });
  await expectTouchTargets(page, submit);
  await submit.click();
  await expect(page.getByText("Submitted for approval.").first()).toBeVisible();
  await page.reload();
  await expect(main.getByText("Pending approval").first()).toBeVisible();
  expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("PENDING_APPROVAL");

  // The CEO, in a session of their own, approves it on the same phone.
  await switchUser(page, "CEO", `/finance/expenses/${expenseId}`);
  await expect(main).toContainText("€1,550.10");
  const approve = main.getByRole("button", { name: "Approve", exact: true });
  await expectInViewport(approve, "approve");
  await approve.click();
  await expect(page.getByText("Expense approved.").first()).toBeVisible();
  await page.reload();
  await expect(main.getByText("Approved").first()).toBeVisible();
  const approved = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
  expect(approved.status).toBe("APPROVED");
  expect(approved.totalAmount.toString()).toBe("1550.1");
  expect(await db.financeApproval.count({ where: { recordId: expenseId, status: "APPROVED" } })).toBe(1);
  expect(await db.document.count({ where: { entityType: "expense", entityId: expenseId } })).toBe(1);
});

test("MW-15 two taps on Create make one expense", async ({ page }, testInfo) => {
  const description = label(testInfo.project.name, "double tap");
  await signIn(page, "FINANCE", { to: "/finance/expenses/new" });
  const main = mainRegion(page);
  await main.getByLabel("Description").fill(description);
  await main.getByLabel("Project").selectOption({ index: 1 });
  await main.getByLabel(/^Net amount/).fill("75");
  // Both taps land before the first re-render.
  await main.getByRole("button", { name: "Create expense" }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(/\/finance\/expenses\/c[a-z0-9]+$/);
  expect(await db.expense.count({ where: { description } })).toBe(1);
});

test("MW-15 Submit: a double tap submits once, a failed or unanswered request is never shown as done", async ({ page }, testInfo) => {
  const failing = await draftExpense(label(testInfo.project.name, "server failure"));
  const doubled = await draftExpense(label(testInfo.project.name, "slow double tap"));
  await signIn(page, "FINANCE", { to: `/finance/expenses/${failing}` });
  const main = mainRegion(page);
  const isAction = (method: string, headers: Record<string, string>) => method === "POST" && Boolean(headers["next-action"]);

  // The server action fails: the unknown outcome is said, nothing claims success, the draft is still a draft.
  await page.route(`**/finance/expenses/${failing}`, (route) =>
    isAction(route.request().method(), route.request().headers()) ? route.fulfill({ status: 500, body: "" }) : route.continue(),
  );
  await main.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("We couldn't confirm whether this saved. Check the record before trying again.").first()).toBeVisible();
  await expect(page.getByText("Submitted for approval.")).toHaveCount(0);
  await page.unroute(`**/finance/expenses/${failing}`);
  expect((await db.expense.findUniqueOrThrow({ where: { id: failing } })).status).toBe("DRAFT");

  // A slow answer and two taps in one frame: one request, one approval cycle.
  await page.goto(`/finance/expenses/${doubled}`);
  let actions = 0;
  await page.route(`**/finance/expenses/${doubled}`, async (route) => {
    if (!isAction(route.request().method(), route.request().headers())) return route.continue();
    actions += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const submit = main.getByRole("button", { name: "Submit for approval" });
  await submit.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(main.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await expect(page.getByText("Submitted for approval.").first()).toBeVisible({ timeout: 15_000 });
  expect(actions).toBe(1);
  expect((await db.expense.findUniqueOrThrow({ where: { id: doubled } })).status).toBe("PENDING_APPROVAL");
  expect(await db.financeApproval.count({ where: { recordId: doubled } })).toBe(1);
});

test("MW-08 invoice line items: stacked, labelled, exact, and a removed line can be undone", async ({ page }) => {
  await signIn(page, "FINANCE", { to: "/finance/invoices/new" });
  const main = mainRegion(page);
  await main.getByRole("button", { name: "Add line" }).click();
  const rows = main.locator("[data-line-row]");
  await expect(rows).toHaveCount(2);
  await main.getByLabel("Description").nth(0).fill("Rebar supply");
  await main.getByLabel(/^Quantity/).nth(0).fill("12,5");
  await main.getByLabel(/^Unit price/).nth(0).fill("48,1234");
  await expect(main.getByLabel(/^Unit price/).nth(0)).toHaveAttribute("inputmode", "decimal");
  await main.getByLabel("Description").nth(1).fill("Formwork hire");

  // Each field keeps a usable width: a 4-decimal price is not cut to a few characters.
  for (const field of [/^Quantity/, /^Unit price/, /^Tax/]) {
    const box = await main.getByLabel(field).nth(0).boundingBox();
    expect(box!.width, `${String(field)} width`).toBeGreaterThanOrEqual(110);
  }
  // The line's total is on screen beside its figures, below lg without hovering.
  await expect(rows.nth(0).getByTestId("line-total")).toContainText("€");
  await expectNoPageOverflow(page, "invoice lines");

  // Remove is a 44px control in the line's header; the removal is said and undoable.
  const remove = rows.nth(1).getByRole("button", { name: /Remove line 2/ });
  await expectTouchTargets(page, remove);
  await remove.click();
  await expect(rows).toHaveCount(1);
  const notice = main.getByTestId("line-removed-notice");
  await expect(notice).toContainText("Line 2 removed: Formwork hire.");
  await notice.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(2);
  await expect(main.getByLabel("Description").nth(1)).toHaveValue("Formwork hire");
});

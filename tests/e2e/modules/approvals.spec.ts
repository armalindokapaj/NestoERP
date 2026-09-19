import { expect, test, type Page } from "@playwright/test";

import { AMENDMENT_COMPANY, CHAIN, createPendingAmendment, createPendingExpense, removeAmendments, removeExpenses, resetChainFixture } from "../approvals-fixtures";
import { db } from "../db";
import { signIn } from "../fixtures";

/**
 * The Unified Approvals Center, desktop (PRD #41 §279-§281).
 *
 * An executive decides the last step of a purchase order chain with the quote
 * in view; an approver rejects with a reason the dialog insists on; Legal
 * returns an amendment and sees the requester's resubmission as a new cycle.
 * The source record moves every time — decided by its own module.
 */

const EXPENSE = "E2E approval expense";
const AMENDMENT = "E2E approval amendment";

test.beforeAll(async () => {
  await resetChainFixture();
});

test.afterAll(async () => {
  await resetChainFixture();
  await removeExpenses(EXPENSE);
  await removeAmendments(AMENDMENT);
  await db.$disconnect();
});

const center = (page: Page) => page.getByTestId("approvals-center");
const row = (page: Page, id: string) => page.locator(`[data-approval="${id}"]`);
const detail = (page: Page) => page.getByTestId("approval-detail");

test("an executive reviews a high-value purchase order, its quote and history, and approves the final step (§279)", async ({ page }) => {
  const started = new Date();
  await signIn(page, "CEO", { to: "/approvals" });
  await expect(center(page).getByTestId("approvals-heading")).toHaveText(/\d+ waiting for you/);

  await center(page).getByLabel("Search approvals").fill(CHAIN.poNumber);
  await expect(page.getByTestId("approval-row")).toHaveCount(1);
  await row(page, `procurement:${CHAIN.approval}`).click();
  await expect(page).toHaveURL(new RegExp(`approval=procurement%3A${CHAIN.approval}`));

  await expect(detail(page).getByTestId("approval-title")).toHaveText(/PO-2026-0142/);
  await expect(detail(page).getByTestId("approval-amount")).toHaveText("€81,600");
  await expect(detail(page).getByText("Why approval is needed")).toBeVisible();
  const steps = detail(page).getByTestId("approval-steps").getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(2)).toContainText("Pending");
  await expect(detail(page).getByTestId("approval-history")).toContainText("Procurement approved");
  await expect(detail(page).getByTestId("approval-history")).toContainText("Within the Riverside structural budget.");

  // The supporting quote, previewed without leaving the decision.
  const documents = detail(page).getByTestId("approval-documents");
  await expect(documents).toContainText("Nordsteel quotation Q-5521.pdf");
  await documents.getByRole("button", { name: /Preview Nordsteel quotation/ }).click();
  await expect(detail(page).getByTestId("approval-preview").or(detail(page).getByText("Preview unavailable"))).toBeVisible();

  // High value: Approve asks once more, naming the amount.
  await detail(page).getByRole("button", { name: "Approve this purchase order" }).click();
  const confirm = page.getByRole("dialog", { name: /Approve €81,600 purchase order\?/ });
  await expect(confirm).toBeVisible();
  await confirm.getByTestId("confirm-approve").click();
  await expect(page.getByText("Purchase order approved", { exact: true })).toBeVisible();

  // It leaves Waiting for me and appears in Approved.
  await expect(row(page, `procurement:${CHAIN.approval}`)).toHaveCount(0);
  await center(page).getByRole("tab", { name: "Approved" }).click();
  await center(page).getByLabel("Search approvals").fill(CHAIN.poNumber);
  await expect(row(page, `procurement:${CHAIN.approval}`)).toBeVisible();

  // The module moved its record, and the requester is told.
  expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: CHAIN.order } })).status).toBe("APPROVED");
  expect(await db.notificationEventOutbox.count({ where: { entityId: CHAIN.order, eventType: "APPROVAL_APPROVED", createdAt: { gte: started } } })).toBe(1);

  await resetChainFixture(started);
});

test("an approver rejects an expense, and the reason is required (§280)", async ({ page }) => {
  const { expenseId, approvalId } = await createPendingExpense(`${EXPENSE} crane standby`);
  await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });

  await expect(detail(page).getByTestId("approval-title")).toContainText(`${EXPENSE} crane standby`);
  await detail(page).getByRole("button", { name: "Reject this expense" }).click();
  const dialog = page.getByRole("dialog", { name: /Reject/ });
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give a reason for rejecting it.");
  await dialog.getByLabel("Reason for rejecting").fill("Standby was not agreed with the crane supplier.");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Expense rejected", { exact: true })).toBeVisible();

  expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("REJECTED");
  const decision = await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } });
  expect(decision).toMatchObject({ status: "REJECTED", decisionNote: "Standby was not agreed with the crane supplier." });
  expect(await db.notificationEventOutbox.count({ where: { entityId: expenseId, eventType: "APPROVAL_REJECTED" } })).toBe(1);
});

test("Legal returns an amendment; the requester resubmits and it comes back as a new cycle with its history (§281)", async ({ page, browser }) => {
  const { amendmentId, approvalId } = await createPendingAmendment(`${AMENDMENT} basement level`);

  // Group Legal lands in Aurelia; the contract is Nova's.
  await signIn(page, "LEGAL", { to: "/approvals", company: AMENDMENT_COMPANY });
  await row(page, `legal:${approvalId}`).click();
  await detail(page).getByRole("button", { name: "Return this amendment for revision" }).click();
  const dialog = page.getByRole("dialog", { name: /for revision\?/ });
  await dialog.getByLabel("What needs to change").fill("State the contingency separately from the base value.");
  await dialog.getByRole("button", { name: "Return for revision" }).click();
  await expect(page.getByText("Amendment returned for revision", { exact: true })).toBeVisible();
  expect((await db.contractAmendment.findUniqueOrThrow({ where: { id: amendmentId } })).status).toBe("DRAFT");

  // The Owner sees it returned to them, and resubmits.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "OWNER", { to: "/approvals?tab=returned&returned=to", company: AMENDMENT_COMPANY });
  await expect(row(owner, `legal:${approvalId}`)).toBeVisible();
  const resubmitted = await owner.request.post(`/api/contracts/contract_005/amendments/${amendmentId}/submit`);
  expect(resubmitted.ok()).toBe(true);
  await ownerContext.close();

  const next = await db.contractApproval.findFirstOrThrow({ where: { recordId: amendmentId, status: "PENDING" } });
  expect(next.id).not.toBe(approvalId);
  await page.goto(`/approvals?approval=legal%3A${next.id}`);
  const history = detail(page).getByTestId("approval-history");
  await expect(history).toContainText("Returned for revision");
  await expect(history).toContainText("State the contingency separately from the base value.");
  await expect(history).toContainText("Resubmitted");
});

test("filters and search narrow the queue, chips undo them, and the counts stay yours (§91-§93, §96)", async ({ page }) => {
  await signIn(page, "CEO", { to: "/approvals" });
  const heading = await center(page).getByTestId("approvals-heading").textContent();

  await center(page).getByRole("button", { name: /^Filters/ }).click();
  const filters = page.getByTestId("approval-filters");
  await filters.getByLabel("Procurement").check();
  await filters.getByRole("button", { name: "Show results" }).click();
  await expect(page).toHaveURL(/provider=procurement/);
  const sources = await page.getByTestId("approval-row").allTextContents();
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every((text) => /PURCHASE (ORDER|REQUEST)/i.test(text))).toBe(true);
  await expect(center(page).getByTestId("approvals-heading")).toHaveText(heading!);

  await center(page).getByRole("button", { name: "Remove filter Procurement" }).click();
  await expect(page).not.toHaveURL(/provider=/);
});

test("a person without approval authority tracks what they asked for, and the Viewer has no Approvals at all (§150-§151)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/approvals?tab=requested" });
  await expect(row(page, `procurement:${CHAIN.approval}`)).toBeVisible();
  await row(page, `procurement:${CHAIN.approval}`).click();
  await expect(detail(page).getByTestId("decision-bar")).toContainText("You requested this");

  const viewer = await page.context().browser()!.newContext();
  const viewerPage = await viewer.newPage();
  await signIn(viewerPage, "VIEWER", { to: "/dashboard" });
  await viewerPage.goto("/approvals");
  await expect(viewerPage).toHaveURL(/access-denied|module-unavailable/);
  await viewer.close();
});

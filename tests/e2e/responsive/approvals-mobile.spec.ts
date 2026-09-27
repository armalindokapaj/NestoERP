import { expect, test, type Page } from "@playwright/test";

import { CHAIN, createPendingExpense, removeExpenses, resetChainFixture } from "../approvals-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { expectInViewport, expectNoPageOverflow, expectTouchTargets, VIEWPORTS, type ViewportName } from "./geometry";

/**
 * The Approvals Center on a phone (PRD #41 §99-§101, §218, §282): the waiting
 * list, a full-screen review with the decision bar under the thumb, the
 * supporting document, and an approval that updates the queue.
 */

test.beforeAll(async () => {
  await resetChainFixture();
});

/** Expenses this spec creates for itself (AUD-04), removed with their trail. */
const OWNED = "aud04c_ approval";

test.afterAll(async () => {
  await resetChainFixture();
  await removeExpenses(OWNED);
  await db.$disconnect();
});

test("reviews a purchase order in a full-screen sheet, opens its quote and approves it", async ({ page }) => {
  const started = new Date();
  await signIn(page, "CEO", { to: "/approvals" });
  const item = mainRegion(page).locator(`[data-approval="procurement:${CHAIN.approval}"]`);
  await item.scrollIntoViewIfNeeded();
  await item.click();

  const sheet = page.getByTestId("approval-sheet");
  await expect(sheet).toBeVisible();
  const bar = sheet.getByTestId("decision-bar");
  await expect(bar).toBeInViewport();
  const approve = bar.getByRole("button", { name: "Approve this purchase order" });
  const box = await approve.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Nothing in the sheet is wider than the phone.
  const overflow = await sheet.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const documents = sheet.getByTestId("approval-documents");
  await documents.scrollIntoViewIfNeeded();
  await documents.getByRole("button", { name: /Preview Nordsteel quotation/ }).click();
  // Never a blank box reported as loaded (AUD-04 §5, MW-12): a preview the
  // browser really draws, or an explicit fallback — and either way an
  // authorised Open / Download beside it.
  const preview = sheet.getByTestId("approval-preview");
  const fallback = sheet.getByTestId("approval-preview-fallback");
  await expect(preview.or(fallback)).toBeVisible();
  const download = sheet.getByRole("link", { name: /^Download Nordsteel quotation/ });
  await expect(download).toBeVisible();
  await expectTouchTargets(page, download);
  const file = await page.request.get((await download.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"] ?? "").toMatch(/attachment/);

  await approve.click();
  await page.getByTestId("confirm-approve").click();
  await expect(page.getByText("Purchase order approved", { exact: true })).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect(item).toHaveCount(0);
  expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: CHAIN.order } })).status).toBe("APPROVED");

  await resetChainFixture(started);
});

test("keeps the queue inside the viewport", async ({ page }) => {
  await signIn(page, "CEO", { to: "/approvals" });
  await expect(mainRegion(page).getByTestId("approval-list")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------------------------ */
/* AUD-04 §7 "Approval review" (MW-12, MW-15, MW-16)                         */
/* ------------------------------------------------------------------------ */

/** The phone, tablet and landscape sizes the journey is checked at (PRD §3). */
const JOURNEY_SIZES: ViewportName[] = ["phone360", "phone390", "tabletPortrait", "tabletPortraitLarge", "phoneLandscape"];

const row = (page: Page, approvalId: string) => mainRegion(page).locator(`[data-approval="finance:${approvalId}"]`);
const sheet = (page: Page) => page.getByTestId("approval-sheet");

/** A high-value approval asks once more; a small one is decided at once. Either way, answered. */
async function confirmIfAsked(page: Page, done: string) {
  const confirm = page.getByTestId("confirm-approve");
  await expect(confirm.or(page.getByText(done, { exact: true }))).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
}

/** Opens the filter drawer, stages amounts, and returns it. */
async function openFilters(page: Page) {
  await mainRegion(page).getByRole("button", { name: /^Filters/ }).click();
  const drawer = page.getByTestId("approval-filters");
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("MW-12 the approval journey at phone, tablet and landscape sizes", () => {
  test("filters by amount (refusing ambiguous input), reviews in the sheet and approves with a note", async ({ page }) => {
    await signIn(page, "CEO", { to: "/approvals" });
    for (const size of JOURNEY_SIZES) {
      await page.setViewportSize(VIEWPORTS[size]);
      const description = `${OWNED} ${size} ${Date.now().toString(36)}`;
      const { expenseId, approvalId } = await createPendingExpense(description);
      await page.goto(`/approvals?q=${encodeURIComponent(description)}`);
      await expect(row(page, approvalId)).toBeVisible();
      await expectNoPageOverflow(page, `queue at ${size}`);

      // The amount filter reads what was typed with the shared decimal rule; it never strips characters.
      const drawer = await openFilters(page);
      const min = drawer.getByLabel("Minimum amount");
      const max = drawer.getByLabel("Maximum amount");
      await min.fill("5,040.00");
      await drawer.getByRole("button", { name: "Show results" }).click();
      await expect(drawer.getByTestId("filter-amount-error")).toContainText("mixes a point and a comma");
      await expect(min).toHaveAttribute("aria-invalid", "true");
      await expect(page).not.toHaveURL(/amountMin=/);
      await min.fill("5,040");
      await drawer.getByRole("button", { name: "Show results" }).click();
      await expect(drawer.getByTestId("filter-amount-error")).toContainText("ambiguous");
      await min.fill("5040");
      await max.fill("5040,00");
      await expectInViewport(drawer.getByRole("button", { name: "Show results" }), `Show results at ${size}`);
      await drawer.getByRole("button", { name: "Show results" }).click();
      await expect(drawer).toBeHidden();
      await expect(page).toHaveURL(/amountMin=5040(&|$)/);
      await expect(page).toHaveURL(/amountMax=5040\.00/);
      const chip = mainRegion(page).getByRole("button", { name: /^Remove filter Amount/ });
      await expect(chip).toBeVisible();
      await expectTouchTargets(page, chip);
      await expect(row(page, approvalId)).toBeVisible();

      // The review: a full-screen sheet below 1024px, the amount readable, the bar entirely on screen.
      await row(page, approvalId).click();
      await expect(sheet(page)).toBeVisible();
      await expect(sheet(page).getByTestId("approval-amount")).toContainText("5,040");
      const bar = sheet(page).getByTestId("decision-bar");
      for (const name of ["Return this expense for revision", "Reject this expense", "Approve this expense"]) {
        const button = bar.getByRole("button", { name });
        if ((await button.count()) === 0) continue;
        await expectInViewport(button, `${name} at ${size}`);
      }
      await expectTouchTargets(page, bar);
      expect(await sheet(page).evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);

      // Add note is there on every size, phones included.
      await bar.getByRole("button", { name: "Add note" }).click();
      await bar.getByLabel("Note with your approval (optional)").fill(`Checked against the delivery note (${size}).`);
      await bar.getByRole("button", { name: "Approve this expense" }).click();
      await confirmIfAsked(page, "Expense approved");
      await expect(page.getByText("Expense approved", { exact: true })).toBeVisible();
      await expect(row(page, approvalId)).toHaveCount(0);

      await page.reload();
      await expect(row(page, approvalId)).toHaveCount(0);
      expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("APPROVED");
      expect(await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({
        status: "APPROVED",
        decisionNote: `Checked against the delivery note (${size}).`,
      });
    }
  });

  test("rejects only with a reason, in a dialog that fits a phone on its side", async ({ page }) => {
    await signIn(page, "CEO", { to: "/approvals" });
    for (const size of ["phone390", "phoneLandscape"] as const) {
      await page.setViewportSize(VIEWPORTS[size]);
      const { expenseId, approvalId } = await createPendingExpense(`${OWNED} reject ${size} ${Date.now().toString(36)}`);
      await page.goto(`/approvals?approval=finance%3A${approvalId}`);
      await expect(sheet(page)).toBeVisible();
      await sheet(page).getByRole("button", { name: "Reject this expense" }).click();
      const dialog = page.getByRole("dialog", { name: /Reject/ });
      await dialog.getByRole("button", { name: "Reject", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Give a reason for rejecting it.");
      const reason = dialog.getByLabel("Reason for rejecting");
      await reason.fill("The invoice does not match the purchase order quantities.");
      await expectInViewport(reason, `reason at ${size}`);
      await expectInViewport(dialog.getByRole("button", { name: "Reject", exact: true }), `Reject at ${size}`);
      await expectTouchTargets(page, dialog.getByRole("button"));
      await dialog.getByRole("button", { name: "Reject", exact: true }).click();
      await expect(page.getByText("Expense rejected", { exact: true })).toBeVisible();

      expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("REJECTED");
      expect(await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({
        status: "REJECTED",
        decisionNote: "The invoice does not match the purchase order quantities.",
      });
    }
  });

  test("a second decision on stale data is refused, says so, and records nothing (AUD-10)", async ({ page, browser }) => {
    await page.setViewportSize(VIEWPORTS.phone390);
    const { expenseId, approvalId } = await createPendingExpense(`${OWNED} stale ${Date.now().toString(36)}`);
    await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });
    await expect(sheet(page).getByTestId("approval-title")).toContainText(`${OWNED} stale`);

    // The Owner, in a browser of their own, decides first.
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await signIn(owner, "OWNER", { company: "company_demo_a" });
    const read = await owner.request.get(`/api/approvals/finance/${approvalId}`);
    expect(read.status(), await read.text()).toBe(200);
    const { data } = (await read.json()) as { data: { item: { version: number } } };
    const approved = await owner.request.post(`/api/approvals/finance/${approvalId}/approve`, {
      data: { expectedVersion: data.item.version },
      headers: { "idempotency-key": `aud04c_${Date.now().toString(36)}` },
    });
    expect(approved.status(), await approved.text()).toBe(200);
    await ownerContext.close();

    // The CEO's page still shows it pending; their rejection is refused inside the dialog.
    await sheet(page).getByRole("button", { name: "Reject this expense" }).click();
    const dialog = page.getByRole("dialog", { name: /Reject/ });
    await dialog.getByLabel("Reason for rejecting").fill("Over budget for this phase.");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(dialog.getByTestId("decision-dialog-failure")).toContainText("Nothing was decided");
    await expect(dialog.getByLabel("Reason for rejecting")).toHaveValue("Over budget for this phase.");
    await expect(page.getByText("Expense rejected", { exact: true })).toHaveCount(0);

    // Leaving the dialog asks about the reason first (AUD-03); the review then offers Reload.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("unsaved-prompt")).toBeVisible();
    await page.getByTestId("unsaved-discard").click();
    const failure = sheet(page).getByTestId("approval-decision-failure");
    await expect(failure).toBeVisible();
    await expectInViewport(failure, "stale refusal");
    await failure.getByRole("button", { name: "Reload" }).click();
    await expect(sheet(page).getByTestId("decision-bar")).toContainText("This approval has been decided.");

    expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("APPROVED");
    const decision = await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(decision.status).toBe("APPROVED");
    expect(decision.decisionNote).not.toBe("Over budget for this phase.");
  });
});

test.describe("MW-15 slow, doubled and failed decisions", () => {
  test("a slow approval shows progress, a double tap sends one decision, and a failure is never success", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.phone390);
    const { expenseId, approvalId } = await createPendingExpense(`${OWNED} slow ${Date.now().toString(36)}`);
    await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });
    const bar = sheet(page).getByTestId("decision-bar");
    const url = `**/api/approvals/finance/${approvalId}/approve`;

    // A definite server failure: said so, nothing recorded, the bar usable again.
    await page.route(url, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "The decision service is unavailable." } }) }));
    await bar.getByRole("button", { name: "Approve this expense" }).click();
    await confirmIfAsked(page, "Expense approved");
    await expect(sheet(page).getByTestId("approval-decision-failure").or(page.getByRole("dialog").getByTestId("decision-dialog-failure")).first()).toContainText("The decision service is unavailable.");
    await expect(page.getByText("Expense approved", { exact: true })).toHaveCount(0);
    expect((await db.financeApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("PENDING");
    await page.unroute(url);
    if (await page.getByRole("dialog").isVisible()) await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // A lost connection: unconfirmed, not "nothing decided".
    await page.route(url, (route) => route.abort("connectionreset"));
    await bar.getByRole("button", { name: "Approve this expense" }).click();
    await confirmIfAsked(page, "Expense approved");
    await expect(page.getByText("We couldn't confirm whether this was recorded.", { exact: false }).first()).toBeVisible();
    await page.unroute(url);
    if (await page.getByRole("dialog").isVisible()) await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // Slow, and tapped twice: one request, pending shown, one decision.
    let sent = 0;
    await page.route(url, async (route) => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    const confirm = page.getByTestId("confirm-approve");
    await bar.getByRole("button", { name: "Approve this expense" }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    }
    await expect(bar.getByRole("button", { name: "Approve this expense" }).or(confirm).first()).toBeDisabled({ timeout: 500 });
    await expect(page.getByText("Expense approved", { exact: true })).toBeVisible();
    expect(sent).toBe(1);
    expect((await db.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe("APPROVED");
    expect(await db.notificationEventOutbox.count({ where: { entityId: expenseId, eventType: "APPROVAL_APPROVED" } })).toBe(1);
  });
});

test.describe("MW-16 rotation across the 1024px review breakpoint", () => {
  test("the note and an open reason survive the move between the sheet and the side panel, without re-reading the review", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tabletPortrait);
    const { approvalId } = await createPendingExpense(`${OWNED} rotation ${Date.now().toString(36)}`);
    await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });
    await expect(sheet(page)).toBeVisible();
    let reads = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === `/api/approvals/finance/${approvalId}`) reads += 1;
    });

    const detail = () => page.getByTestId("approval-detail");
    await detail().getByRole("button", { name: "Add note" }).click();
    await detail().getByLabel("Note with your approval (optional)").fill("Typed in portrait.");

    // Portrait → landscape: the sheet gives way to the side panel; the note moves with it.
    await page.setViewportSize(VIEWPORTS.tabletLandscape);
    await expect(sheet(page)).toHaveCount(0);
    await expect(detail().getByLabel("Note with your approval (optional)")).toHaveValue("Typed in portrait.");

    // A reason being written survives the turn back too, dialog and all.
    await detail().getByRole("button", { name: "Reject this expense" }).click();
    await page.getByRole("dialog", { name: /Reject/ }).getByLabel("Reason for rejecting").fill("Typed in landscape.");
    await page.setViewportSize(VIEWPORTS.tabletPortrait);
    await expect(sheet(page)).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Reject/ }).getByLabel("Reason for rejecting")).toHaveValue("Typed in landscape.");
    expect(reads).toBe(0);

    // Discarding the reason keeps the note (AUD-03 asks first).
    await page.getByRole("dialog", { name: /Reject/ }).getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId("unsaved-discard").click();
    await expect(page.getByRole("dialog", { name: /Reject/ })).toHaveCount(0);
    await expect(detail().getByLabel("Note with your approval (optional)")).toHaveValue("Typed in portrait.");
  });

  test("a desktop deep link never flashes the phone sheet (SP-15, D-08-03)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    const { approvalId } = await createPendingExpense(`${OWNED} deep link ${Date.now().toString(36)}`);
    await page.addInitScript(() => {
      const w = window as unknown as { __sheetSeen?: boolean };
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="approval-sheet"]')) w.__sheetSeen = true;
      }).observe(document, { subtree: true, childList: true });
    });
    await signIn(page, "CEO", { to: `/approvals?approval=finance%3A${approvalId}` });
    await expect(page.getByRole("complementary", { name: "Approval review" }).getByTestId("approval-detail")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sheetSeen?: boolean }).__sheetSeen ?? false)).toBe(false);
  });
});

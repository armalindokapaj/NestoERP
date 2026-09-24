import { expect, test } from "@playwright/test";

import { CHAIN, resetChainFixture } from "../approvals-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The Approvals Center on a phone (PRD #41 §99-§101, §218, §282): the waiting
 * list, a full-screen review with the decision bar under the thumb, the
 * supporting document, and an approval that updates the queue.
 */

test.beforeAll(async () => {
  await resetChainFixture();
});

test.afterAll(async () => {
  await resetChainFixture();
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
  await expect(sheet.getByTestId("approval-preview").or(sheet.getByText("Preview unavailable"))).toBeVisible();

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

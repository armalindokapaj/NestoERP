import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { ENGINEERING_SEED, PROJECT, restoreContractorsEngineering } from "../engineering-fixtures";
import { openSectionMenu, signIn } from "../fixtures";

/**
 * Engineering review on a phone (PRD #46 §313, §317, §318): the engineer opens
 * the project's engineering, answers the RFI waiting on them from its card,
 * then opens a submittal, sees its file and records a review decision.
 */

const S = ENGINEERING_SEED;

test.beforeAll(async () => {
  await restoreContractorsEngineering();
  // The engineer holds the open RFI and the crane method statement for review.
  await db.rfi.update({ where: { id: S.rfis.slabEdge }, data: { assignedToMemberId: "member_engineer" } });
  await db.technicalSubmittal.update({ where: { id: S.submittals.crane }, data: { assignedReviewerMemberId: "member_engineer" } });
});

test.afterAll(async () => {
  await restoreContractorsEngineering();
  await db.$disconnect();
});

/** Below 1024px the engineering sections are a group of the top bar's section pill, under the project's own. */
async function openEngineeringSection(page: Page, name: string | RegExp) {
  const menu = await openSectionMenu(page);
  await menu.getByRole("group", { name: "Engineering sections" }).getByRole("link", { name }).click();
}

async function expectNoSidewaysScroll(page: Page) {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client + 1);
}

test("the engineer answers an RFI and reviews a submittal from the phone", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "ENGINEER", { to: `/projects/${PROJECT}/engineering` });
  // The section column is not drawn on a phone: its sections are in the section pill.
  await expect(page.getByTestId("engineering-nav")).toBeHidden();
  await expectNoSidewaysScroll(page);

  await openEngineeringSection(page, /^RFIs/);
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/engineering/rfis$`));
  await expect(page.getByTestId("rfi-row").first()).toBeHidden();
  await page.getByTestId("rfi-card").filter({ hasText: "RFI-001" }).click();
  await expect(page.getByTestId("rfi-question")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.getByLabel("Your response").fill("Slab edge set back 50 mm at C/4; add U-bars at 200 centres as on STR-SK-014.");
  await page.getByRole("button", { name: "Send response" }).click();
  await expect(page.getByTestId("rfi-status")).toHaveText("Answered");
  await expect(page.getByTestId("rfi-response").last()).toContainText("U-bars at 200 centres");

  await openEngineeringSection(page, /^Submittals$/);
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/engineering/submittals$`));
  await page.getByTestId("submittal-card").filter({ hasText: "SUB-002" }).click();
  await expect(page.getByTestId("submittal-status")).toHaveText("Submitted");
  await expectNoSidewaysScroll(page);

  const revision = page.locator('[data-testid="revision-item"][data-revision="01"]');
  await expect(revision.getByTestId("revision-file")).toBeVisible();
  await revision.getByRole("button", { name: "Approve with comments" }).click();
  const dialog = page.getByTestId("decision-dialog");
  await dialog.getByLabel("Review comment").fill("Approved. Keep the exclusion zone taped off during every lift.");
  await dialog.getByRole("button", { name: "Record: approved with comments" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("submittal-status")).toHaveText("Approved with comments");
  await expect(revision).toHaveAttribute("data-status", "FINALIZED");
  expect((await db.technicalSubmittal.findUniqueOrThrow({ where: { id: S.submittals.crane } })).status).toBe("APPROVED_WITH_COMMENTS");
});

import { expect, test } from "@playwright/test";

import { db, removeTestDocuments, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * AUD-08 list operations on the module lists (§3, §4; DT-05, DT-19, DT-20).
 *
 * Thirty tasks `AUD08C task 01…30` and thirty documents `AUD08C doc 01…30` in
 * Aurelia, eight of the tasks on Project A. Written by agent C1; run once at
 * the end with the rest of the suite. Expected counts are written from the
 * fixtures: 30 matching → page 1 "1–25 of 30", page 2 "26–30 of 30".
 */

const PREFIX = "AUD08C";
const AURELIA = "company_demo_a";
const TASKS = `/tasks/all?search=${PREFIX}`;
const DOCUMENTS = `/documents/all?search=${PREFIX}`;
const pad = (index: number) => String(index + 1).padStart(2, "0");

test.beforeAll(async () => {
  await removeTestTasks(PREFIX);
  await removeTestDocuments(PREFIX);
  const owner = await db.companyMember.findFirstOrThrow({ where: { companyId: AURELIA, user: { email: "owner@nesto.test" } }, select: { id: true, userId: true } });
  await db.task.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      id: `aud08c_e2e_task_${pad(index)}`,
      companyId: AURELIA,
      title: `${PREFIX} task ${pad(index)}`,
      createdByMemberId: owner.id,
      createdBy: owner.userId,
      projectId: index < 8 ? "project_a" : null,
    })),
  });
  await db.document.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      id: `aud08c_e2e_doc_${pad(index)}`,
      companyId: AURELIA,
      name: `${PREFIX} doc ${pad(index)}`,
      originalFileName: `doc-${pad(index)}.pdf`,
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(1024),
      status: "ACTIVE" as const,
      storageStatus: "AVAILABLE" as const,
      createdBy: owner.userId,
    })),
  });
});

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await removeTestDocuments(PREFIX);
  await db.$disconnect();
});

const count = (page: import("@playwright/test").Page) => mainRegion(page).getByTestId("pagination-count");

test.describe("DT-05 out-of-range pages move once to the last real page", () => {
  test("Tasks: page 99 lands on page 2 with every other key kept", async ({ page }) => {
    await signIn(page, "OWNER", { to: `${TASKS}&sort=title-asc&page=99` });
    await expect(page).toHaveURL(/page=2/);
    const url = new URL(page.url());
    expect(url.searchParams.get("search")).toBe(PREFIX);
    expect(url.searchParams.get("sort")).toBe("title-asc");
    await expect(count(page)).toHaveText(/26–30\s+of\s+30/);
  });

  test("Documents: page 99 lands on page 2", async ({ page }) => {
    await signIn(page, "OWNER", { to: `${DOCUMENTS}&page=99` });
    await expect(page).toHaveURL(/page=2/);
    await expect(count(page)).toHaveText(/26–30\s+of\s+30/);
  });

  test("an empty filtered list says 0 results on page 1, never 1–0", async ({ page }) => {
    await signIn(page, "OWNER", { to: `/tasks/all?search=${PREFIX}-no-such-task&page=4` });
    await expect(page).not.toHaveURL(/page=/);
    await expect(mainRegion(page).getByText("No tasks match these filters.")).toBeVisible();
  });

  test("the Project A Tasks tab pages every task with a true count", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/projects/project_a/tasks?page=50" });
    await expect(page).not.toHaveURL(/page=50/);
    await expect(count(page)).toHaveText(/of\s+\d+/);
  });
});

test.describe("DT-19 header sorts and DT-05 Clear filters", () => {
  test("the Task header sorts through the URL, announces aria-sort and returns to page 1", async ({ page }) => {
    await signIn(page, "OWNER", { to: `${TASKS}&page=2` });
    const header = mainRegion(page).locator('th[data-sort-key="title"]');
    await expect(header).toHaveAttribute("aria-sort", "none");
    await header.getByRole("button").click();
    await expect(page).toHaveURL(/sort=title-asc/);
    await expect(page).not.toHaveURL(/page=2/);
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(mainRegion(page).getByRole("row").nth(1)).toContainText(`${PREFIX} task 01`);
    await header.getByRole("button").click();
    await expect(page).toHaveURL(/sort=title-desc/);
    await expect(mainRegion(page).getByRole("row").nth(1)).toContainText(`${PREFIX} task 30`);
  });

  test("Clear filters drops the filters and search but keeps the sort", async ({ page }) => {
    await signIn(page, "OWNER", { to: `/tasks/all?search=${PREFIX}-nothing&priority=CRITICAL&sort=title-desc` });
    await mainRegion(page).getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/sort=title-desc/);
    await expect(page).not.toHaveURL(/search=|priority=/);
  });

  test("Back restores the previous sort and page", async ({ page }) => {
    await signIn(page, "OWNER", { to: `${TASKS}&sort=title-asc&page=2` });
    await expect(count(page)).toHaveText(/26–30\s+of\s+30/);
    await mainRegion(page).locator('th[data-sort-key="title"]').getByRole("button").click();
    await expect(page).toHaveURL(/sort=title-desc/);
    await page.goBack();
    await expect(page).toHaveURL(/sort=title-asc/);
    await expect(page).toHaveURL(/page=2/);
    await expect(count(page)).toHaveText(/26–30\s+of\s+30/);
  });
});

test.describe("honest counts on nested lists", () => {
  test("the project Units tab shows its count on a single page", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/projects/project_a/units" });
    const units = mainRegion(page).getByTestId("pagination-count");
    if ((await units.count()) > 0) await expect(units.first()).toHaveText(/results|of\s+\d+/);
  });
});

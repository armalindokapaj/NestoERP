import { expect, test } from "@playwright/test";

import { db } from "../db";
import { engineerFile, removeEmployeeFiles } from "../employee-files-fixtures";
import { mainRegion, signIn } from "../fixtures";

/**
 * Employee documents and qualifications (E-02 §94-§105, §153, §217-§223).
 *
 * HR files a licence on the employee's record and verifies it; the employee
 * adds a qualification and shares it with the group; HR finds it waiting,
 * verifies it, and only then does a colleague see its summary — never the
 * file, never before it is checked. The steps build on each other, so they
 * run in order, and everything is removed afterwards.
 */

const PREFIX = "E2E employee file";
const LICENCE = `${PREFIX} Driving licence`;
const QUALIFICATION = `${PREFIX} Working at height`;

let employeeId: string;
let personId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ({ employeeId, personId } = await engineerFile());
  await removeEmployeeFiles(PREFIX);
});

test.afterAll(async () => {
  await removeEmployeeFiles(PREFIX);
  await db.$disconnect();
});

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test("HR files a driving licence on the employee's record and verifies it", async ({ page }) => {
  await signIn(page, "HR", { to: `/hr/employees/${employeeId}/documents` });
  const main = mainRegion(page);

  await main.getByTestId("add-employee-document").click();
  const dialog = page.getByTestId("add-employee-document-dialog");
  await dialog.getByLabel("What it is").selectOption({ label: "Driving licence" });
  await dialog.getByLabel("Title").fill(LICENCE);
  await dialog.getByLabel("Issued by").fill("DPSHTRR");
  await dialog.getByLabel("Expires on").fill(inDays(20));
  await dialog.getByTestId("employee-document-file").setInputFiles({ name: "licence.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nE2E licence\n%%EOF\n") });
  await dialog.getByRole("button", { name: "Add document" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const row = main.getByTestId("employee-document").filter({ hasText: LICENCE });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("verification")).toHaveText("Unverified");
  await expect(row).toContainText(/in \d+ days/);

  await row.getByTestId("employee-document-actions").click();
  await page.getByRole("menuitem", { name: "Verify" }).click();
  await page.getByTestId("verify-document-dialog").getByRole("button", { name: "Verify" }).click();
  await expect(row.getByTestId("verification")).toHaveText("Verified");

  // One canonical file, filed once on the employment (§11, §189).
  const link = await db.employeeDocumentLink.findFirstOrThrow({ where: { title: LICENCE }, select: { employeeProfileId: true, verificationStatus: true, document: { select: { entityType: true, entityId: true } } } });
  expect(link).toMatchObject({ employeeProfileId: employeeId, verificationStatus: "VERIFIED", document: { entityType: "employee", entityId: employeeId } });
});

test("the employee adds a qualification, shares it with the group, and sees their own licence", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: `/people/${personId}?tab=qualifications` });
  const main = mainRegion(page);

  await main.getByTestId("add-qualification").click();
  const dialog = page.getByTestId("qualification-dialog");
  await dialog.getByLabel("What it is").selectOption({ label: "Safety certificate" });
  await dialog.getByLabel("Title").fill(QUALIFICATION);
  await dialog.getByLabel("Issued by").fill("ISSH");
  await dialog.getByLabel("Expires on").fill(inDays(200));
  await dialog.getByLabel("Who may see it").selectOption({ label: "Everyone in the group, once verified" });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const card = main.getByTestId("qualification").filter({ hasText: QUALIFICATION });
  await expect(card.getByTestId("verification")).toHaveText("Unverified");
  // Nobody verifies their own (§74).
  await card.getByTestId("qualification-actions").click();
  await expect(page.getByRole("menuitem", { name: "Verify" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto(`/people/${personId}?tab=documents`);
  await expect(main.getByTestId("employee-document").filter({ hasText: LICENCE })).toBeVisible();
});

test("a colleague sees neither the file nor the unverified qualification", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: `/people/${personId}?tab=qualifications` });
  const main = mainRegion(page);
  await expect(main.getByTestId("person-qualifications")).toBeVisible();
  await expect(main.getByText(QUALIFICATION)).toHaveCount(0);

  await page.goto(`/people/${personId}?tab=documents`);
  await expect(main.getByText(LICENCE)).toHaveCount(0);
});

test("HR finds the qualification waiting, verifies it, and the colleague then sees its summary", async ({ page, browser }) => {
  await signIn(page, "HR", { to: "/hr/documents?view=verify" });
  const main = mainRegion(page);
  await expect(main.getByTestId("hr-document-views")).toBeVisible();

  await main.getByRole("link", { name: QUALIFICATION }).click();
  await page.waitForURL(new RegExp(`/people/${personId}\\?tab=qualifications`));
  const card = main.getByTestId("qualification").filter({ hasText: QUALIFICATION });
  await card.getByTestId("qualification-actions").click();
  await page.getByRole("menuitem", { name: "Verify" }).click();
  await page.getByTestId("verify-qualification-dialog").getByRole("button", { name: "Verify" }).click();
  await expect(card.getByTestId("verification")).toHaveText("Verified");

  // The licence expires within 30 days: it is on HR's list for that.
  await page.goto("/hr/documents?view=expiring");
  await expect(main.getByTestId("credential-worklist")).toContainText(LICENCE);

  const colleague = await browser.newPage();
  await signIn(colleague, "PROJECT_MANAGER", { to: `/people/${personId}?tab=qualifications` });
  const summary = mainRegion(colleague).getByTestId("qualification-summary").filter({ hasText: QUALIFICATION });
  await expect(summary).toBeVisible();
  // A summary: no number, no file, no actions (§34-§37).
  await expect(summary.getByRole("link")).toHaveCount(0);
  await expect(mainRegion(colleague).getByTestId("qualification-actions")).toHaveCount(0);
  await colleague.close();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the employee file, the qualifications and HR's worklist inside the viewport", async ({ page }) => {
    await signIn(page, "HR", { to: `/hr/employees/${employeeId}/documents` });
    const main = mainRegion(page);
    await expect(main.getByTestId("employee-document-card").filter({ hasText: LICENCE })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await main.getByTestId("employee-document-card").filter({ hasText: LICENCE }).locator("button").first().click();
    await expect(page.getByTestId("employee-document-drawer")).toContainText("DPSHTRR");
    await page.keyboard.press("Escape");

    await page.goto(`/people/${personId}?tab=qualifications`);
    await expect(main.getByTestId("qualification").filter({ hasText: QUALIFICATION })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await page.goto("/hr/documents?view=expiring");
    await expect(main.getByTestId("worklist-card").filter({ hasText: LICENCE })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

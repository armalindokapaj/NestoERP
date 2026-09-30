import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { expectNoPageOverflow, outsideProjects } from "./geometry";

/**
 * MOB-10 notification settings: the Push column, quiet hours and the project
 * level picker, on a phone and a desktop, saved on the server and read back.
 */
const SIZES = /^aud04-(phone-320|phone-390|tablet-768|desktop-1280)$/;

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, SIZES), "MOB-10 settings run at 320, 390, 768 and 1280.");
});

test.afterAll(async () => {
  await db.$disconnect();
});

test("quiet hours and the push switch are saved and survive a reload", async ({ page }) => {
  await signIn(page, "ENGINEER");
  const user = await db.user.findFirstOrThrow({ where: { username: "engineer-a" }, select: { id: true } });
  await db.notificationQuietHours.deleteMany({ where: { userId: user.id } });

  try {
    await page.goto("/settings/notifications");
    const main = mainRegion(page);
    await expect(main.getByTestId("quiet-hours")).toBeVisible();
    await expectNoPageOverflow(page);

    await main.getByRole("switch", { name: "Quiet hours" }).click();
    await expect(main.getByLabel("From")).toBeVisible();
    await main.getByLabel("From").fill("21:30");
    await expect.poll(async () => (await db.notificationQuietHours.findUnique({ where: { userId: user.id } }))?.startMinute).toBe(21 * 60 + 30);

    await page.reload();
    await expect(mainRegion(page).getByLabel("From")).toHaveValue("21:30");
    await expectNoPageOverflow(page);

    // The critical-alert line only shows while the override is on.
    await expect(mainRegion(page).getByText("Critical alerts may still be delivered during quiet hours.")).toBeVisible();
    await mainRegion(page).getByRole("switch", { name: "Let critical safety alerts through" }).click();
    await expect(mainRegion(page).getByText("Critical alerts may still be delivered during quiet hours.")).toHaveCount(0);

    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  } finally {
    await db.notificationQuietHours.deleteMany({ where: { userId: user.id } });
  }
});

test("the push switch for a category is stored and mandatory categories stay locked", async ({ page }) => {
  await signIn(page, "ENGINEER");
  const member = await db.companyMember.findFirstOrThrow({ where: { user: { username: "engineer-a" } }, select: { id: true } });
  await db.notificationPreference.deleteMany({ where: { memberId: member.id, category: "tasks" } });

  try {
    await page.goto("/settings/notifications");
    const tasksPush = mainRegion(page).getByLabel("Tasks — Phone");
    await expect(tasksPush).toBeChecked();
    await tasksPush.click();
    await expect.poll(async () => (await db.notificationPreference.findFirst({ where: { memberId: member.id, category: "tasks" } }))?.pushEnabled).toBe(false);

    await expect(mainRegion(page).getByLabel("HSE — Phone")).toBeDisabled();
  } finally {
    await db.notificationPreference.deleteMany({ where: { memberId: member.id, category: "tasks" } });
  }
});

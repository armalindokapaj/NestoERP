import { expect, test } from "@playwright/test";

import { addLocalDays, dateLabel, localDate } from "@/lib/modules/project-planning/planning.dates";
import { db } from "../db";
import { signIn } from "../fixtures";
import { PLANNING_SEED, restoreSeededPlanning } from "../planning-fixtures";

/**
 * Planning on a phone (PRD #44 §116-§119, §246, §301): open the plan, filter the
 * delayed milestones, open one from its card's action menu, move its forecast
 * and add a blocker — then Riverside's plan is put back as seeded.
 */

const ZONE = "Europe/Tirane";

test.afterAll(async () => {
  await restoreSeededPlanning();
  await db.$disconnect();
});

test("updates a delayed milestone from the phone", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/planning" });
  await expect(page.getByTestId("planning-view-timeline")).toHaveCount(0);
  await page.getByTestId("planning-view-milestones").click();
  await page.getByRole("button", { name: "Delayed", exact: true }).click();

  const card = page.getByTestId("milestone-card").filter({ hasText: "Scaffold Inspection Passed" });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("milestone-status")).toHaveText("Delayed");
  await card.getByRole("button", { name: "Actions for Scaffold Inspection Passed" }).click();
  await page.getByRole("menuitem", { name: "Update forecast" }).click();

  const drawer = page.getByTestId("milestone-drawer");
  await expect(drawer.getByTestId("drawer-milestone-name")).toHaveText("Scaffold Inspection Passed");
  const forecast = addLocalDays(localDate(new Date(), ZONE), 4);
  await drawer.getByTestId("drawer-quick-update").getByLabel("Forecast date").fill(forecast);
  await drawer.getByTestId("drawer-quick-update").getByRole("button", { name: "Save update" }).click();
  await expect(drawer.getByTestId("drawer-forecast")).toHaveText(dateLabel(forecast));

  await drawer.getByTestId("drawer-blockers").getByRole("button", { name: "Add blocker" }).click();
  await drawer.getByTestId("drawer-blockers").getByLabel("Title").fill("Scaffold tags missing on level 3");
  await drawer.getByTestId("drawer-blockers").getByRole("button", { name: "Save blocker" }).click();
  await expect(drawer.getByTestId("milestone-blocker").filter({ hasText: "Scaffold tags missing on level 3" })).toBeVisible();

  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("milestone-card").filter({ hasText: "Scaffold Inspection Passed" })).toHaveCount(0);
  const saved = await db.projectMilestone.findUniqueOrThrow({ where: { id: PLANNING_SEED.milestones.scaffold }, select: { forecastDate: true } });
  expect(saved.forecastDate?.toISOString().slice(0, 10)).toBe(forecast);
});

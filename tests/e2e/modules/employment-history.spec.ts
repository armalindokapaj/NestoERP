import { expect, test, type Page } from "@playwright/test";

import { snapshotEmploymentsWith } from "../../support/employment-snapshot";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Employment & organization history (E-03 §220-§224, §169, §172, §247).
 *
 * HR promotes, transfers, corrects and schedules through "Change employment";
 * the employee reads their own history, on a phone as well; a colleague sees
 * the current profile and nothing of the history. Every test puts the
 * employments it touched back exactly as the seed left them.
 */

const COMPANY_A = "company_demo_a";

async function memberOf(username: string): Promise<{ memberId: string; employmentId: string }> {
  const member = await db.companyMember.findFirstOrThrow({ where: { companyId: COMPANY_A, user: { username } }, select: { id: true, employeeProfile: { select: { id: true } } } });
  return { memberId: member.id, employmentId: member.employeeProfile!.id };
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function openChange(page: Page, item: string) {
  await mainRegion(page).getByTestId("employment-change-menu").first().click();
  await page.getByRole("menuitem", { name: item }).click();
}

test.afterAll(async () => {
  await db.$disconnect();
});

test("HR promotes somebody, links the amendment, and the history keeps old and new (§220)", async ({ page }) => {
  const isaac = await memberOf("group-inventory");
  const restore = await snapshotEmploymentsWith(db, [isaac.employmentId]);
  const hr = await db.user.findFirstOrThrow({ where: { username: "group-hr" }, select: { id: true } });
  const amendment = await db.document.create({
    data: { companyId: COMPANY_A, name: "E2E contract amendment.pdf", module: "hr", entityType: "employee", entityId: isaac.employmentId, status: "ACTIVE", createdBy: hr.id },
    select: { id: true },
  });
  try {
    const documents = await db.document.count();
    await signIn(page, "HR", { to: `/hr/employees/${isaac.employmentId}` });
    await openChange(page, "Promote or change title");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Job title").fill("Director of Inventory");
    await dialog.getByLabel("Kind of change").selectOption("PROMOTION");
    await dialog.getByLabel("Supporting document").selectOption({ label: "E2E contract amendment.pdf" });
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByRole("table", { name: "Before and after" })).toContainText("Director of Inventory");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(mainRegion(page).getByText("Director of Inventory").first()).toBeVisible();

    await page.goto(`/hr/employees/${isaac.employmentId}/history`);
    const timeline = page.getByRole("list", { name: /Employment timeline/ });
    await expect(timeline.getByTestId("timeline-event").first()).toContainText("Promoted to Director of Inventory");
    await expect(timeline.getByRole("link", { name: "E2E contract amendment.pdf" })).toBeVisible();
    await expect(mainRegion(page).getByRole("cell", { name: "Head of Group Inventory" })).toBeVisible();
    await expect(mainRegion(page).getByRole("cell", { name: "Director of Inventory" })).toBeVisible();
    // Linked, not copied: still one document (§216).
    expect(await db.document.count()).toBe(documents);
  } finally {
    await restore();
    await db.document.delete({ where: { id: amendment.id } });
  }
});

test("HR moves somebody to another company of the group, and where they were stays (§221)", async ({ page }) => {
  const henry = await memberOf("group-hse");
  const restore = await snapshotEmploymentsWith(db, [henry.employmentId]);
  try {
    await signIn(page, "HR", { to: `/hr/employees/${henry.employmentId}` });
    await openChange(page, "Transfer to another company");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Company").selectOption({ label: "Meridian Developments" });
    await dialog.getByLabel("Department").selectOption({ label: "HSE" });
    await dialog.getByLabel("Job title").fill("HSE Manager");
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
    await dialog.getByTestId("confirm-high-impact").check();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto("/people/person_hse?tab=employment");
    const history = mainRegion(page).getByTestId("organization-history");
    await expect(history).toContainText("Transferred to Meridian Developments");
    await expect(history).toContainText("Aurelia Construction");
  } finally {
    await restore();
  }
});

test("an employee reads their own history, on a phone too (§222, §172)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "ARCHITECT", { to: "/people/person_architect?tab=employment" });
  const history = mainRegion(page).getByTestId("organization-history");
  await expect(history).toContainText("Promoted to Lead Architect");
  await expect(history).not.toContainText("Recorded by");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a colleague sees the current profile, and none of the history (§223)", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/people/person_architect" });
  await expect(page.getByRole("heading", { name: /Anna Rossi/ }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Employment" })).toHaveCount(0);
  const response = await page.request.get("/api/people/person_architect/employment-history");
  expect(response.status()).toBe(403);
});

test("HR corrects a date with a reason, and the original is kept beside it (§224)", async ({ page }) => {
  const anna = await memberOf("architect-a");
  const restore = await snapshotEmploymentsWith(db, [anna.employmentId]);
  try {
    await signIn(page, "HR", { to: `/hr/employees/${anna.employmentId}/history` });
    const promoted = mainRegion(page).getByTestId("assignment-row").filter({ hasText: "Promoted" });
    await promoted.getByRole("button", { name: /Correct/ }).click();
    const dialog = page.getByRole("dialog");
    const started = await dialog.getByLabel("Started").inputValue();
    const later = new Date(new Date(`${started}T00:00:00Z`).getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Started").fill(later);
    await dialog.getByLabel("Why is this being corrected?").fill("The promotion letter took effect three days later.");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(mainRegion(page).getByTestId("assignment-superseded").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Correction: The promotion letter took effect three days later.").first()).toBeVisible();
  } finally {
    await restore();
  }
});

test("HR schedules a change, sees it waiting, and cancels it before it applies (§169, §157)", async ({ page }) => {
  const isaac = await memberOf("group-inventory");
  const restore = await snapshotEmploymentsWith(db, [isaac.employmentId]);
  try {
    await signIn(page, "HR", { to: `/hr/employees/${isaac.employmentId}` });
    await openChange(page, "Change work location");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Works at").selectOption("REMOTE");
    await dialog.getByLabel("Effective from").fill(inDays(10));
    await expect(dialog.getByText(/Scheduled for/)).toBeVisible();
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto(`/hr/employees/${isaac.employmentId}/history`);
    const scheduled = mainRegion(page).getByTestId("scheduled-change");
    await expect(scheduled).toContainText("Location change");
    await scheduled.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel the change" }).click();
    await expect(mainRegion(page).getByTestId("scheduled-change")).toHaveCount(0);
    await expect(mainRegion(page).getByText(/Location change for .* — cancelled/)).toBeVisible();
  } finally {
    await restore();
  }
});

test("HR reads the organization as of a date (§247)", async ({ page }) => {
  await signIn(page, "HR", { to: "/hr/reports?report=organization" });
  await expect(mainRegion(page).getByTestId("org-headcount")).toContainText(/\d+/);
  await expect(mainRegion(page).getByTestId("org-by-department")).toBeVisible();
});

// A test of its own, so a fresh session: signing out by clearing cookies races
// the previous page's in-flight requests, which set the session again.
test("the CEO is not offered the organization report (§195)", async ({ page }) => {
  await signIn(page, "CEO", { to: "/hr/reports" });
  const reports = page.getByRole("navigation", { name: "Reports" });
  await expect(reports.getByRole("link", { name: "Headcount" })).toBeVisible();
  await expect(reports.getByRole("link", { name: "Organization" })).toHaveCount(0);
});

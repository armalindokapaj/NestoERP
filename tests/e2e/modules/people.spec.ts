import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * People (E-01 §200-§204, ADR 0002).
 *
 * A project manager finds a colleague in another company of the group and
 * reads their work profile, sees an architect's project as a link where they
 * can open it and as a name where they cannot, and edits their own profile.
 * HR reads the Employment and Private tabs nobody else is shown. Somebody from
 * another group cannot open a profile by its address.
 */

test.describe.configure({ mode: "serial" });

let seeded: { workPhoneExtension: string | null } | null = null;

test.beforeAll(async () => {
  seeded = await db.personProfile.findUnique({ where: { id: "person_pm" }, select: { workPhoneExtension: true } });
});

test.afterAll(async () => {
  if (seeded) await db.personProfile.update({ where: { id: "person_pm" }, data: seeded });
  await db.auditEvent.deleteMany({ where: { actionKey: "PERSON_WORK_PROFILE_UPDATED", entityId: "person_pm" } });
  await db.$disconnect();
});

test("a project manager finds a colleague in another company and reads their work profile (§200)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/people" });
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

  const find = mainRegion(page).getByRole("form", { name: "Find people" });
  await find.getByRole("searchbox", { name: "Search" }).fill("Dritan");
  // A company workspace opens on its own company; the directory is the group's
  // for everyone who works in it, and this is how it widens (E-01 §103, §85, §86).
  await find.getByLabel("Company").selectOption({ label: "Every company" });
  await find.getByRole("button", { name: "Search" }).click();
  const card = mainRegion(page).getByTestId("person-card").filter({ hasText: "Dritan Lleshi" });
  await expect(card).toContainText("Meridian Developments");
  await card.getByRole("link", { name: "Dritan Lleshi" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Dritan Lleshi" })).toBeVisible();
  await expect(mainRegion(page)).toContainText("Chief Executive Officer");
  await expect(mainRegion(page).getByRole("link", { name: "ceo-b@nesto.test" })).toHaveAttribute("href", "mailto:ceo-b@nesto.test");
  const sections = page.getByRole("navigation", { name: "Profile sections" });
  await expect(sections.getByRole("link", { name: "Overview" })).toBeVisible();
  // HR's views do not exist for a colleague (§165).
  await expect(sections.getByRole("link", { name: "Employment" })).toHaveCount(0);
  await expect(sections.getByRole("link", { name: "Private" })).toHaveCount(0);
});

test("a project shows as a link where the reader can open it (§201)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/people/person_architect?tab=projects" });
  await expect(mainRegion(page).getByTestId("person-project").filter({ hasText: "Riverside Residences" }).getByRole("link")).toHaveAttribute("href", "/projects/project_a");
});

test("and as a name only where the reader cannot (§44, §201)", async ({ page }) => {
  await signIn(page, "PM_B", { to: "/people/person_architect?tab=projects" });
  const row = mainRegion(page).getByTestId("person-project").filter({ hasText: "Riverside Residences" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("link")).toHaveCount(0);
});

test("a person edits their own work profile", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/people/me" });
  await expect(page.getByRole("heading", { level: 1, name: "Alex Morgan" })).toBeVisible();
  await mainRegion(page).getByRole("button", { name: "Edit your profile" }).click();
  const dialog = page.getByTestId("own-profile-dialog");
  await dialog.getByRole("textbox", { name: "Extension" }).fill("299");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(mainRegion(page).getByLabel("Contact")).toContainText("ext. 299");
});

test("HR reads the Employment and Private tabs (§203)", async ({ page }) => {
  await signIn(page, "HR", { to: "/people/person_pm" });
  const sections = page.getByRole("navigation", { name: "Profile sections" });
  await sections.getByRole("link", { name: "Employment" }).click();
  await expect(mainRegion(page).getByTestId("employment-record").first()).toContainText("Aurelia Construction sh.p.k.");
  await sections.getByRole("link", { name: "Private" }).click();
  await expect(mainRegion(page).getByRole("heading", { name: "Private details" })).toBeVisible();
});

test("somebody from another group cannot open a profile by its address (§182)", async ({ page }) => {
  await signIn(page, "OWNER_B", { to: "/people/person_pm" });
  await expect(page.getByRole("heading", { name: "Alex Morgan" })).toHaveCount(0);
  await expect(page.getByText(/not found|could not be found|doesn.t exist/i).first()).toBeVisible();
});

import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn, signOut } from "../fixtures";

/**
 * One way to a person (E-08 §101-§105, §112, §117, §118; ADR 0008).
 *
 * A name on a project's team, a task, a comment, the audit log and a search
 * result all lead to the same `/people/[personId]`, and from a profile back to
 * the project. The architect sets her own photo; Group IT reads the Access
 * section nobody else is shown; the Head of Group Architecture puts her on a
 * project from her profile and takes her off again.
 */

test.describe.configure({ mode: "serial" });

const MARKER = `e2e-e08-${Date.now()}`;
const PAVILION = { id: "e2e_e08_project_pavilion", code: "E2E-E08-PAV", name: "E2E E-08 Pavilion" };
// A 1×1 PNG: an image by its bytes, not by its name.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const startedAt = new Date();

test.beforeAll(async () => {
  await db.project.upsert({
    where: { id: PAVILION.id },
    update: {},
    create: { id: PAVILION.id, companyId: "company_demo_a", code: PAVILION.code, name: PAVILION.name, status: "ACTIVE", createdBy: "e2e" },
  });
});

test.afterAll(async () => {
  const comments = await db.comment.findMany({ where: { body: { contains: MARKER } }, select: { id: true, threadId: true } });
  if (comments.length > 0) {
    await db.comment.deleteMany({ where: { id: { in: comments.map((row) => row.id) } } });
    for (const threadId of new Set(comments.map((row) => row.threadId))) {
      const remaining = await db.comment.count({ where: { threadId, archivedAt: null } });
      await db.collaborationThread.update({ where: { id: threadId }, data: { commentCount: remaining } });
    }
  }
  await db.personProfile.update({
    where: { id: "person_architect" },
    data: { photoStorageKey: null, photoContentType: null, photoChecksum: null, photoSizeBytes: null, photoUpdatedAt: null },
  });
  await db.auditEvent.deleteMany({ where: { actionKey: "PERSON_PROFILE_PHOTO_UPDATED", entityId: "person_architect", occurredAt: { gte: startedAt } } });
  await db.auditEvent.deleteMany({ where: { projectId: PAVILION.id } });
  await db.activity.deleteMany({ where: { entityType: "Project", entityId: PAVILION.id } });
  await db.projectMember.deleteMany({ where: { projectId: PAVILION.id } });
  await db.project.deleteMany({ where: { id: PAVILION.id } });
  await db.$disconnect();
});

test("from a project's team to the architect's profile, and from her projects back to the project (§101)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a/team" });
  await mainRegion(page).getByRole("link", { name: "Anna Rossi" }).first().click();
  await page.waitForURL(/\/people\/person_architect$/);
  await expect(page.getByRole("heading", { level: 1, name: "Anna Rossi" })).toBeVisible();

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /^Projects/ }).click();
  await mainRegion(page).getByTestId("person-project").filter({ hasText: "Riverside Residences" }).getByRole("link").click();
  await page.waitForURL(/\/projects\/project_a$/);
});

test("a task's assignee, and a comment's author, lead to their profiles (§102, §103)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/tasks/task_003" });
  const composer = page.getByPlaceholder("Add a comment. Type @ to mention someone.");
  await composer.fill(`Layouts look right ${MARKER}`);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = mainRegion(page).getByTestId("comment").filter({ hasText: MARKER });
  await expect(comment).toBeVisible();
  await comment.getByRole("link", { name: "Alex Morgan" }).click();
  await page.waitForURL(/\/people\/person_pm$/);
  await expect(page.getByRole("heading", { level: 1, name: "Alex Morgan" })).toBeVisible();

  await page.goto("/tasks/task_003");
  await mainRegion(page).getByRole("link", { name: "Anna Rossi" }).first().click();
  await page.waitForURL(/\/people\/person_architect$/);
});

test("the audit log's actor leads to the profile (§104)", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/settings/audit" });
  const actor = mainRegion(page).locator("table [data-person-link]").first();
  const name = (await actor.textContent())!.trim();
  await actor.click();
  await page.waitForURL(/\/people\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("a person found by search, with title and company, opens their profile (§105)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search NESTO" }).fill("Anna Rossi");
  const result = page.getByRole("listbox", { name: "Search results" }).getByRole("option", { name: /Anna Rossi/ }).first();
  await expect(result).toContainText("Aurelia Construction");
  await result.click();
  await page.waitForURL(/\/people\/person_architect$/);
});

test("the architect sets her photo, a colleague sees it in the directory, and she removes it (§43, §93)", async ({ page }) => {
  await signIn(page, "ARCHITECT", { to: "/people/person_architect" });
  await page.getByTestId("profile-photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Photo saved.", { exact: true })).toBeVisible();
  await expect(mainRegion(page).locator("header img").first()).toHaveAttribute("src", /^\/api\/people\/person_architect\/photo\?v=[0-9a-f]{16}$/);
  await signOut(page);

  // Anna works in Aurelia and the reader in Meridian, so the directory is widened
  // to the group, which it is for everyone who works in it (E-01 §103, §85).
  await signIn(page, "PM_B", { to: "/people?q=Anna+Rossi&company=all" });
  const card = mainRegion(page).getByTestId("person-card").filter({ hasText: "Anna Rossi" });
  const photo = card.locator("img");
  await expect(photo).toHaveAttribute("src", /^\/api\/people\/person_architect\/photo\?v=/);
  const response = await page.request.get((await photo.getAttribute("src"))!);
  expect(response.headers()["content-type"]).toBe("image/png");
  await signOut(page);

  await signIn(page, "ARCHITECT", { to: "/people/person_architect" });
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(mainRegion(page).locator("header img")).toHaveCount(0);
});

test("the Access section is Group IT's, not a colleague's (§29, §66)", async ({ page }) => {
  await signIn(page, "GROUP_IT", { to: "/people/person_pm?tab=access" });
  const access = mainRegion(page).getByTestId("person-access");
  await expect(access).toContainText("pm-a");
  await expect(access.getByTestId("profile-completeness")).toContainText("Active account");
  await signOut(page);

  await signIn(page, "PROJECT_MANAGER", { to: "/people/person_pm?tab=access" });
  await expect(page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Access" })).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("person-access")).toHaveCount(0);
});

test("the Head of Group Architecture puts the architect on a project from her profile, and takes her off (§49, §64)", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_HEAD", { to: "/people/person_architect?tab=projects" });
  await mainRegion(page).getByRole("button", { name: "Assign to a project" }).click();
  const dialog = page.getByTestId("assign-project-dialog");
  await dialog.getByRole("combobox", { name: /^Project/ }).selectOption({ label: `${PAVILION.code} · ${PAVILION.name} — Aurelia Construction` });
  await dialog.getByLabel("Role on the project").fill("Facade architect");
  await dialog.getByRole("button", { name: "Assign" }).click();
  const row = mainRegion(page).getByTestId("person-project").filter({ hasText: PAVILION.name });
  await expect(row).toContainText("Facade architect");

  await row.getByRole("button", { name: `Take Anna Rossi off ${PAVILION.name}` }).click();
  await page.getByRole("dialog", { name: `Take Anna Rossi off ${PAVILION.name}?` }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Anna Rossi is off the project.", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: `Take Anna Rossi off ${PAVILION.name}` })).toHaveCount(0);
  expect(await db.projectMember.count({ where: { projectId: PAVILION.id, status: "ACTIVE" } })).toBe(0);
});

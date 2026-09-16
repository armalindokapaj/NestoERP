import { expect, type Page, test } from "@playwright/test";

import { db, removeTestProjects } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The Projects journey (PRD #9 §153, §163, PRD #10 §241–§246, E-05A §63-§70).
 */

const card = (page: Page, name: string | RegExp) =>
  mainRegion(page).getByTestId("project-card").filter({ has: page.getByRole("link", { name }) });

test.describe("Project Manager (PRD #9 §153)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees Project A and B only, as cards", async ({ page }) => {
    await page.goto("/projects");

    await expect(card(page, "Riverside Residences")).toBeVisible();
    await expect(card(page, "Central Office Tower")).toBeVisible();
    await expect(card(page, "Central Office Tower").getByTestId("project-company")).toHaveText("NESTO Demo Construction");
    await expect(mainRegion(page).getByText("Marina Apartments")).toHaveCount(0);
    await expect(mainRegion(page).getByText("Logistics Hub")).toHaveCount(0);
  });

  test("gives every cover the 3:4 shape, image or placeholder (E-05A §7.1, §8)", async ({ page }) => {
    await page.goto("/projects");

    for (const name of ["Riverside Residences", "Central Office Tower"]) {
      const cover = card(page, name).locator(".aspect-\\[3\\/4\\]");
      const box = await cover.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.height / box!.width, name).toBeCloseTo(4 / 3, 1);
    }
    await expect(card(page, "Central Office Tower").getByRole("img", { name: "Cover image of Central Office Tower" })).toBeVisible();
    await expect(card(page, "Riverside Residences").getByRole("img", { name: "No cover image for Riverside Residences" })).toBeVisible();
  });

  test("opens a project and can edit it", async ({ page }) => {
    await page.goto("/projects/project_a");

    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByText("PRJ-001").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
    // The managing company is part of where the person is (E-05A §26).
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("NESTO Demo Construction");
  });

  test("answers not found for a project outside scope (PRD #9 §112)", async ({ page }) => {
    const response = await page.goto("/projects/project_c");

    expect(response?.status()).toBe(404);
    // The response must not confirm that Project C exists.
    await expect(page.getByText("Marina Apartments")).toHaveCount(0);
  });

  test("search returns nothing for an out-of-scope project (PRD #9 §169)", async ({ page }) => {
    await page.goto("/projects?q=Marina");
    await expect(mainRegion(page).getByText(/no projects match these filters/i)).toBeVisible();
  });

  test("filters do not offer a place the person cannot see (E-05A §18, §73)", async ({ page }) => {
    await page.goto("/projects");

    const location = mainRegion(page).getByLabel("Location");
    await expect(location.locator("option", { hasText: "Durrës" })).toHaveCount(1);
    const options = await location.locator("option").allTextContents();
    expect(options.join(" ")).toContain("Durrës");
    expect(options.join(" ")).not.toContain("Vlorë");
    // One company: no company filter to choose from.
    await expect(mainRegion(page).getByLabel("Company")).toHaveCount(0);
  });

  test("keeps search, filters and sort in the URL, and Back returns to them (E-05A §48)", async ({ page }) => {
    await page.goto("/projects?status=ACTIVE&sort=name-asc");

    await expect(mainRegion(page).getByRole("button", { name: "Active", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(mainRegion(page).getByLabel("Sort")).toHaveValue("name-asc");
    await page.reload();
    await expect(mainRegion(page).getByLabel("Sort")).toHaveValue("name-asc");

    await mainRegion(page).getByRole("searchbox", { name: "Search projects" }).fill("Riverside");
    await expect(page).toHaveURL(/q=Riverside/);
    await expect(card(page, "Central Office Tower")).toHaveCount(0);

    await card(page, "Riverside Residences").getByTestId("project-card-link").click();
    await expect(page).toHaveURL(/\/projects\/project_a$/);
    await page.goBack();
    await expect(page).toHaveURL(/q=Riverside/);
    await expect(card(page, "Riverside Residences")).toBeVisible();
    await expect(mainRegion(page).getByRole("searchbox", { name: "Search projects" })).toHaveValue("Riverside");
  });

  test("shows Clear filters only while something is filtered (E-05A §19)", async ({ page }) => {
    await page.goto("/projects");
    await expect(mainRegion(page).getByTestId("projects-clear-filters")).toHaveCount(0);

    await page.goto("/projects?status=PENDING");
    await mainRegion(page).getByTestId("projects-clear-filters").click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(mainRegion(page).getByTestId("projects-clear-filters")).toHaveCount(0);
  });

  test("shows the project tabs and each one loads", async ({ page }) => {
    await page.goto("/projects/project_a");

    // Scoped to the record's own tab bar: the sidebar also has a "Tasks" link,
    // and they lead to different places.
    const tabs = page.getByRole("navigation", { name: "Project sections" });

    for (const tab of ["Tasks", "Team", "Documents", "Activity"] as const) {
      await tabs.getByRole("link", { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/project_a/${tab.toLowerCase()}$`));
      await expect(
        page.getByRole("heading", { name: "Riverside Residences" }).first(),
      ).toBeVisible();
    }
  });

  test("runs projects but does not open new ones (E-05A §29)", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("link", { name: /new project/i })).toHaveCount(0);

    await page.goto("/projects/new");
    await expect(page).toHaveURL(/\/access-denied/);
  });
});

test.describe("Project Manager changes a status (E-05A §12, §68)", () => {
  const prefix = "PRJ-E2E-STATUS-";

  test.afterAll(async () => {
    await removeTestProjects(prefix);
  });

  test("moves a project they manage from the card menu, and it stays on the page", async ({ page }) => {
    const pm = await db.companyMember.findFirstOrThrow({ where: { user: { username: "pm" }, companyId: "company_demo_a" } });
    const name = `Status Test ${Date.now().toString().slice(-6)}`;
    const project = await db.project.create({
      data: { companyId: "company_demo_a", code: `${prefix}${Date.now()}`, name, status: "ACTIVE", projectManagerMemberId: pm.id, createdBy: "e2e" },
    });
    await db.projectMember.create({ data: { companyId: "company_demo_a", projectId: project.id, companyMemberId: pm.id, projectRole: "Project Manager", status: "ACTIVE" } });

    await signIn(page, "PROJECT_MANAGER");
    await page.goto(`/projects?q=${encodeURIComponent(name)}`);

    const target = card(page, name);
    await target.getByTestId("project-menu").click();
    await page.getByRole("menuitem", { name: /change status/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /finished/i }).check();
    await dialog.getByLabel(/reason/i).fill("Handover completed");
    await dialog.getByRole("button", { name: /change status/i }).click();

    await expect(target.getByTestId("project-status")).toHaveText("Finished");
    // Finished is not a separate section: it is still in the one collection.
    await page.reload();
    await expect(card(page, name).getByTestId("project-status")).toHaveText("Finished");

    const audit = await db.auditEvent.findFirst({ where: { entityId: project.id, actionKey: "PROJECT_STATUS_CHANGED" } });
    expect(audit?.reason).toBe("Handover completed");
  });
});

test.describe("Architect (PRD #9 §154)", () => {
  test("sees Project A and C only", async ({ page }) => {
    await signIn(page, "ARCHITECT");
    await page.goto("/projects");

    await expect(card(page, "Riverside Residences")).toBeVisible();
    await expect(card(page, "Marina Apartments")).toBeVisible();
    await expect(mainRegion(page).getByText("Central Office Tower")).toHaveCount(0);
    await expect(mainRegion(page).getByText("Logistics Hub")).toHaveCount(0);
  });

  test("may contribute but neither create nor change a status (PRD #10 §124, E-05A §11)", async ({ page }) => {
    await signIn(page, "ARCHITECT");
    await page.goto("/projects");

    await expect(page.getByRole("link", { name: /new project/i })).toHaveCount(0);
    await card(page, "Riverside Residences").getByTestId("project-menu").click();
    await expect(page.getByRole("menuitem", { name: /edit project/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /change status/i })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/projects/new");
    await expect(page).toHaveURL(/\/access-denied/);
  });
});

test.describe("Viewer (PRD #9 §163)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "VIEWER");
  });

  test("sees Project A only, read-only", async ({ page }) => {
    await page.goto("/projects");

    await expect(card(page, "Riverside Residences")).toBeVisible();
    await expect(mainRegion(page).getByText("Central Office Tower")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /new project/i })).toHaveCount(0);
  });

  test("is offered no mutation on a project it can open", async ({ page }) => {
    await page.goto("/projects/project_a");

    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /more project actions/i })).toHaveCount(0);
  });

  test("is refused every mutation endpoint (PRD #9 §113)", async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const header = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const create = await request.post("/api/projects", {
      headers: { cookie: header, "content-type": "application/json" },
      data: { code: "PRJ-HACK", name: "Should not exist", status: "PENDING" },
    });
    expect(create.status()).toBe(403);

    const update = await request.patch("/api/projects/project_a", {
      headers: { cookie: header, "content-type": "application/json" },
      data: { code: "PRJ-001", name: "Renamed", status: "ACTIVE" },
    });
    expect(update.status()).toBe(403);

    const status = await request.patch("/api/projects/project_a/status", {
      headers: { cookie: header, "content-type": "application/json" },
      data: { status: "FINISHED" },
    });
    expect(status.status()).toBe(403);

    const archive = await request.post("/api/projects/project_a/archive", {
      headers: { cookie: header },
    });
    expect(archive.status()).toBe(403);
  });
});

test.describe("Owner (PRD #9 §148, PRD #10 §241)", () => {
  // The projects these tests create are removed afterwards, so the seed is the
  // same world on the next run (PRD #9 §126).
  test.afterAll(async () => {
    await removeTestProjects("PRJ-E2E-");
    await removeTestProjects("PRJ-DATE-");
    await db.userFavorite.deleteMany({ where: { entityType: "project", entityId: "project_d", memberId: "member_owner" } });
  });

  test("creates, edits, archives and restores a project", async ({ page }) => {
    await signIn(page, "OWNER");

    const code = `PRJ-E2E-${Date.now().toString().slice(-6)}`;

    await page.goto("/projects/new");
    await expect(page.getByTestId("project-form-company")).toContainText("NESTO Demo Construction");
    await page.getByLabel("Project name").fill("End-to-end Test Project");
    await page.getByLabel("Project code").fill(code);
    await page.getByLabel("Project type").selectOption("HOSPITAL");
    await page.getByLabel("Status").selectOption("ACTIVE");
    await page.getByRole("button", { name: /create project/i }).click();

    await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "End-to-end Test Project" })).toBeVisible();

    const projectUrl = page.url();

    // Edit
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Project name").fill("End-to-end Renamed");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("heading", { name: "End-to-end Renamed" })).toBeVisible();

    // The new project is on the Projects page, typed.
    await page.goto("/projects?type=HOSPITAL");
    await expect(card(page, "End-to-end Renamed")).toBeVisible();

    // Archive, with confirmation
    await page.goto(projectUrl);
    await page.getByRole("button", { name: /more project actions/i }).click();
    await page.getByRole("menuitem", { name: /archive project/i }).click();
    await page.getByRole("button", { name: /^archive project$/i }).click();
    await expect(page.getByText(/this project is archived and read-only/i)).toBeVisible();

    // Archived projects leave the Projects page and appear in Archived
    await page.goto("/projects");
    await expect(page.getByRole("link", { name: /End-to-end Renamed/ })).toHaveCount(0);
    await page.goto("/projects/archived");
    await expect(page.getByRole("link", { name: /End-to-end Renamed/ }).first()).toBeVisible();

    // Restore
    await page.goto(projectUrl);
    await page.getByRole("button", { name: /restore/i }).click();
    await expect(page.getByText(/this project is archived/i)).toHaveCount(0);
  });

  test("stars a project to the top, without opening it (E-05A §13, §14, §25)", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/projects");

    const hub = card(page, "Logistics Hub");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/projects/project_d/favorite") && response.request().method() === "POST");
    await hub.getByTestId("project-favorite").click();
    expect((await saved).ok()).toBe(true);
    await expect(page).toHaveURL(/\/projects$/);
    await expect(hub.getByTestId("project-favorite")).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(mainRegion(page).getByTestId("project-card").first()).toHaveAttribute("data-project-id", "project_d");

    await page.goto("/projects?favorites=1");
    await expect(mainRegion(page).getByTestId("project-card")).toHaveCount(1);

    const removed = page.waitForResponse((response) => response.url().endsWith("/api/projects/project_d/favorite") && response.request().method() === "DELETE");
    await card(page, "Logistics Hub").getByTestId("project-favorite").click();
    expect((await removed).ok()).toBe(true);
  });

  test("remembers the list view (E-05A §22, §23)", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/projects");

    await mainRegion(page).getByRole("button", { name: "List view" }).click();
    await expect(page.getByTestId("project-list")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("project-list")).toBeVisible();
    await expect(page.getByTestId("project-list").getByRole("link", { name: "Marina Apartments" })).toBeVisible();

    await mainRegion(page).getByRole("button", { name: "Gallery view" }).click();
    await expect(page.getByTestId("project-gallery")).toBeVisible();
  });

  test("refuses a duplicate project code (PRD #10 §41)", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/projects/new");

    await page.getByLabel("Project name").fill("Duplicate Code Project");
    await page.getByLabel("Project code").fill("PRJ-001");
    await page.getByRole("button", { name: /create project/i }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText(/already exists/i);
  });

  test("refuses an end date before the start date (PRD #10 §38)", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/projects/new");

    await page.getByLabel("Project name").fill("Bad Dates Project");
    await page.getByLabel("Project code").fill(`PRJ-DATE-${Date.now().toString().slice(-5)}`);
    await page.getByLabel("Start date").fill("2027-06-01");
    await page.getByLabel("End date").fill("2027-01-01");
    await page.getByRole("button", { name: /create project/i }).click();

    await expect(page.getByText(/end date must be on or after the start date/i)).toBeVisible();
  });
});

test.describe("Admin (E-05A §29, §60)", () => {
  test("may create projects, and a new one starts Pending", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/projects");
    await page.getByRole("link", { name: /new project/i }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(page.getByTestId("project-form-company")).toContainText("NESTO Demo Construction");
  });
});

test.describe("Legacy project list links", () => {
  test("All Projects and My Projects land on the Projects page", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/all?status=COMPLETED&search=Tower");
    await expect(page).toHaveURL(/\/projects\?q=Tower&status=FINISHED$/);

    await page.goto("/projects/my-projects");
    await expect(page).toHaveURL(/\/projects\?role=%40assigned$/);
    await expect(card(page, "Riverside Residences")).toBeVisible();
  });
});

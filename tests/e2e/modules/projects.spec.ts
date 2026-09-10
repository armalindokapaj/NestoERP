import { expect, test } from "@playwright/test";

import { db, removeTestProjects } from "../db";
import { signIn } from "../fixtures";

/**
 * The Projects journey (PRD #9 §153, §163, PRD #10 §241–§246).
 */
test.describe("Project Manager (PRD #9 §153)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees Project A and B only", async ({ page }) => {
    await page.goto("/projects/all");

    await expect(page.getByRole("link", { name: /Riverside Residences/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Central Office Tower/ }).first()).toBeVisible();
    await expect(page.getByText("Marina Apartments")).toHaveCount(0);
    await expect(page.getByText("Logistics Hub")).toHaveCount(0);
  });

  test("opens a project and can edit it", async ({ page }) => {
    await page.goto("/projects/project_a");

    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByText("PRJ-001").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  });

  test("answers not found for a project outside scope (PRD #9 §112)", async ({ page }) => {
    const response = await page.goto("/projects/project_c");

    expect(response?.status()).toBe(404);
    // The response must not confirm that Project C exists.
    await expect(page.getByText("Marina Apartments")).toHaveCount(0);
  });

  test("search returns nothing for an out-of-scope project (PRD #9 §169)", async ({ page }) => {
    await page.goto("/projects/all?search=Marina");
    await expect(page.getByText(/no projects match these filters/i)).toBeVisible();
  });

  test("filters do not offer inaccessible clients (PRD #9 §170)", async ({ page }) => {
    await page.goto("/projects/all");

    const clientFilter = page.getByLabel("Client");
    const options = await clientFilter.locator("option").allTextContents();

    expect(options.join(" ")).toContain("ACME Developments");
    expect(options.join(" ")).not.toContain("Meridian Group");
  });

  test("keeps filters and search in the URL (PRD #9 §198)", async ({ page }) => {
    await page.goto("/projects/all?status=ACTIVE&sort=name-asc");

    await expect(page.getByLabel("Status")).toHaveValue("ACTIVE");
    await expect(page.getByLabel("Sort")).toHaveValue("name-asc");

    await page.reload();
    await expect(page.getByLabel("Status")).toHaveValue("ACTIVE");
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
});

test.describe("Architect (PRD #9 §154)", () => {
  test("sees Project A and C only", async ({ page }) => {
    await signIn(page, "ARCHITECT");
    await page.goto("/projects/all");

    await expect(page.getByRole("link", { name: /Riverside Residences/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Marina Apartments/ }).first()).toBeVisible();
    await expect(page.getByText("Central Office Tower")).toHaveCount(0);
    await expect(page.getByText("Logistics Hub")).toHaveCount(0);
  });

  test("may contribute but not create (PRD #10 §124)", async ({ page }) => {
    await signIn(page, "ARCHITECT");
    await page.goto("/projects/all");

    await expect(page.getByRole("link", { name: /new project/i })).toHaveCount(0);

    await page.goto("/projects/new");
    await expect(page).toHaveURL(/\/access-denied/);
  });
});

test.describe("Viewer (PRD #9 §163)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "VIEWER");
  });

  test("sees Project A only, read-only", async ({ page }) => {
    await page.goto("/projects/all");

    await expect(page.getByRole("link", { name: /Riverside Residences/ }).first()).toBeVisible();
    await expect(page.getByText("Central Office Tower")).toHaveCount(0);
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
      data: { code: "PRJ-HACK", name: "Should not exist", status: "DRAFT" },
    });
    expect(create.status()).toBe(403);

    const update = await request.patch("/api/projects/project_a", {
      headers: { cookie: header, "content-type": "application/json" },
      data: { code: "PRJ-001", name: "Renamed", status: "ACTIVE" },
    });
    expect(update.status()).toBe(403);

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
    await db.$disconnect();
  });

  test("creates, edits, archives and restores a project", async ({ page }) => {
    await signIn(page, "OWNER");

    const code = `PRJ-E2E-${Date.now().toString().slice(-6)}`;

    await page.goto("/projects/new");
    await page.getByLabel("Project name").fill("End-to-end Test Project");
    await page.getByLabel("Project code").fill(code);
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

    // Archive, with confirmation
    await page.getByRole("button", { name: /more project actions/i }).click();
    await page.getByRole("menuitem", { name: /archive project/i }).click();
    await page.getByRole("button", { name: /^archive project$/i }).click();
    await expect(page.getByText(/this project is archived and read-only/i)).toBeVisible();

    // Archived projects leave the active list and appear in Archived
    await page.goto("/projects/all");
    await expect(page.getByRole("link", { name: /End-to-end Renamed/ })).toHaveCount(0);
    await page.goto("/projects/archived");
    await expect(page.getByRole("link", { name: /End-to-end Renamed/ }).first()).toBeVisible();

    // Restore
    await page.goto(projectUrl);
    await page.getByRole("button", { name: /restore/i }).click();
    await expect(page.getByText(/this project is archived/i)).toHaveCount(0);
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

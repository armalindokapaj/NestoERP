import { expect, test, type Page } from "@playwright/test";

import { db, removeTestProjects } from "../db";
import { mainRegion, signIn, switchCompany } from "../fixtures";

/**
 * The Projects page as a workspace-scoped gallery (Projects Workspace Grid
 * PRD §193-§198, §209, §212).
 *
 * The workspace chooses the companies; the page shows their projects as one
 * grid in one order, with a search and nothing else to choose. The Owner of the
 * five-company demo group sees one project in each company; in a company
 * workspace, that company's only.
 */

const card = (page: Page, name: string | RegExp) =>
  mainRegion(page).getByTestId("project-card").filter({ has: page.getByRole("link", { name }) });

const cards = (page: Page) => mainRegion(page).getByTestId("project-card");

const search = (page: Page) => mainRegion(page).getByRole("searchbox", { name: "Search projects" });

test.describe("the page (§3, §193, §212)", () => {
  test("offers a search and the grid — no company, role, type or place filter, no status pills, sort or view toggle", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto("/projects");
    await expect(cards(page).first()).toBeVisible();

    const main = mainRegion(page);
    await expect(search(page)).toBeVisible();
    await expect(main.getByTestId("project-gallery")).toBeVisible();
    for (const label of ["Company", "My role", "Project type", "Location", "Sort"]) {
      await expect(main.getByLabel(label, { exact: true }), label).toHaveCount(0);
    }
    await expect(main.getByRole("combobox")).toHaveCount(0);
    for (const name of ["All", "Active", "Pending", "Finished", "Favorites", "Recommended", "List view", "Gallery view", "Clear filters"]) {
      await expect(main.getByRole("button", { name, exact: true }), name).toHaveCount(0);
    }
    await expect(main.getByRole("link", { name: /new project/i })).toHaveCount(0);
  });

  test("rewrites a bookmark with a removed filter, sort or view to the page's own address, keeping the search (§183, §184)", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto("/projects?company=company_demo_b&status=FINISHED&sort=name-desc&view=list&favorites=1&q=Marina");
    await expect(page).toHaveURL(/\/projects\?q=Marina$/);
    await expect(card(page, "Marina Apartments")).toBeVisible();

    // A company named in the URL chooses nothing (§108).
    await page.goto("/projects?company=company_demo_b");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(card(page, "Riverside Residences")).toBeVisible();
    await expect(card(page, "Central Office Tower")).toBeVisible();
  });
});

test.describe("the workspace decides (§6, §7, §16, §17, §76-§83, §194)", () => {
  test("the Group workspace counts projects across companies, a company workspace in that company", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto("/projects");
    // Other specs may add projects mid-run, so the words are asserted, not the number.
    await expect(mainRegion(page).getByText(/^\d+ projects across 5 companies$/)).toBeVisible();
    const companies = new Set(await mainRegion(page).getByTestId("project-company").allInnerTexts());
    expect(companies.size).toBe(5);

    await switchCompany(page, "company_demo_a");
    await page.goto("/projects");
    await expect(mainRegion(page).getByText(/^\d+ projects? in Aurelia Construction$/)).toBeVisible();
    // The company line stays on each card in a company workspace too (§60).
    for (const label of await mainRegion(page).getByTestId("project-company").allInnerTexts()) expect(label).toBe("Aurelia Construction");
  });

  test("switching keeps the page and its search, from the group to a company and back (§76-§81)", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP", to: "/projects" });
    await expect(card(page, "Central Office Tower")).toBeVisible();
    const inGroup = await cards(page).count();

    // The switch the workspace control makes: the server validates it and
    // answers with the route the person should see (§76, §78). Projects is
    // valid in both workspaces, so it is kept exactly — search included.
    const move = async (data: Record<string, unknown>) => {
      const response = await page.request.post("/api/workspace", { data: { ...data, currentPathname: "/projects", currentSearch: "?q=a" } });
      expect(response.ok()).toBe(true);
      type Switch = { navigation: { resolution: string; destination: string } };
      const body = (await response.json()) as { data?: Switch } & Switch;
      return (body.data ?? body).navigation;
    };

    expect(await move({ scopeType: "COMPANY", companyId: "company_demo_b" })).toMatchObject({ resolution: "KEEP_EXACT", destination: "/projects?q=a" });
    await page.goto("/projects");
    await expect(card(page, "Central Office Tower")).toBeVisible();
    for (const label of await mainRegion(page).getByTestId("project-company").allInnerTexts()) expect(label).toBe("Meridian Developments");
    await expect(card(page, "Riverside Residences")).toHaveCount(0);

    expect(await move({ scopeType: "GROUP" })).toMatchObject({ resolution: "KEEP_EXACT", destination: "/projects?q=a" });
    await page.goto("/projects");
    await expect(card(page, "Riverside Residences")).toBeVisible();
    expect(await cards(page).count()).toBe(inGroup);
  });
});

test.describe("order (§34-§36, §127-§130)", () => {
  const prefix = "PRJ-E2E-GRID-";

  test.afterAll(async () => {
    await removeTestProjects(prefix);
  });

  test("Active first, then Pending, then Finished, each by name; Archived is not in the gallery", async ({ page }) => {
    const label = `Grid order ${Date.now().toString(36)}`;
    const made: Array<[string, "ACTIVE" | "PENDING" | "FINISHED" | "ARCHIVED"]> = [
      ["Delta", "FINISHED"],
      ["Bravo", "PENDING"],
      ["Charlie", "ACTIVE"],
      ["Alpha", "PENDING"],
      ["Echo", "ACTIVE"],
      ["Foxtrot", "ARCHIVED"],
    ];
    for (const [word, status] of made) {
      await db.project.create({
        data: {
          companyId: "company_demo_a",
          code: `${prefix}${word}-${Date.now().toString(36)}`,
          name: `${label} ${word}`,
          status,
          createdBy: "e2e",
          ...(status === "ARCHIVED" ? { archivedAt: new Date(), preArchiveStatus: "ACTIVE" as const } : {}),
        },
      });
    }

    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto(`/projects?q=${encodeURIComponent(label)}`);
    await expect(cards(page)).toHaveCount(5);
    const names = await mainRegion(page).getByTestId("project-card-link").allInnerTexts();
    expect(names.map((name) => name.replace(`${label} `, ""))).toEqual(["Charlie", "Echo", "Alpha", "Bravo", "Delta"]);
    expect(await mainRegion(page).getByTestId("project-status").allTextContents()).toEqual(["Active", "Active", "Pending", "Pending", "Finished"]);

    // The same order on every load (§36).
    await page.reload();
    expect(await mainRegion(page).getByTestId("project-card-link").allInnerTexts()).toEqual(names);
  });
});

test.describe("search (§21-§25, §70, §148-§150)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto("/projects");
    await expect(cards(page).first()).toBeVisible();
  });

  test("finds by name, company and place inside the workspace, says how many, and clears", async ({ page }) => {
    await search(page).fill("Tower");
    await expect(page).toHaveURL(/\/projects\?q=Tower$/);
    await expect(mainRegion(page).getByTestId("projects-result-count")).toHaveText("1 project found");
    await expect(cards(page)).toHaveCount(1);
    await expect(card(page, "Central Office Tower")).toBeVisible();

    await search(page).fill("Nova Hospitality");
    await expect(card(page, "Adriatic Hotel & Residences")).toBeVisible();
    await expect(cards(page)).toHaveCount(1);

    await search(page).fill("Vlorë");
    await expect(card(page, "Marina Apartments")).toBeVisible();

    await mainRegion(page).getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(search(page)).toBeFocused();
    await expect(card(page, "Riverside Residences")).toBeVisible();
    await expect(mainRegion(page).getByTestId("projects-result-count")).toHaveText("");
  });

  test("says when nothing matches, and Escape clears the search", async ({ page }) => {
    await search(page).fill("zzzz no such project");
    await expect(mainRegion(page).getByText("No projects found.")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    // The header still counts the workspace's projects, not the search (§18).
    await expect(mainRegion(page).getByText(/^\d+ projects across 5 companies$/)).toBeVisible();

    await search(page).press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(cards(page).first()).toBeVisible();
  });

  test("finds nothing outside the workspace (§22, §196)", async ({ page }) => {
    await switchCompany(page, "company_demo_a");
    await page.goto("/projects?q=Tower");
    await expect(mainRegion(page).getByText("No projects found.")).toBeVisible();
  });
});

test.describe("the card (§42-§62, §161-§169, §195)", () => {
  test("is a link, then a star, then a menu of opening, starring and sharing — and nothing that edits", async ({ page }) => {
    await signIn(page, "OWNER", { company: "company_demo_a", to: "/projects" });
    const riverside = card(page, "Riverside Residences");
    await expect(riverside).toBeVisible();
    await expect(riverside.getByTestId("project-location")).toHaveText("Tiranë, Albania");
    await expect(riverside.getByTestId("project-status")).toHaveText("Active");

    // Keyboard order: the project, its star, its menu (§166).
    await riverside.getByTestId("project-card-link").focus();
    await page.keyboard.press("Tab");
    await expect(riverside.getByRole("button", { name: "Add Riverside Residences to favorites" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(riverside.getByRole("button", { name: "Project actions for Riverside Residences" })).toBeFocused();

    await page.keyboard.press("Enter");
    const items = await page.getByRole("menuitem").allInnerTexts();
    expect(items.map((item) => item.trim())).toEqual(["Open project", "Open in new tab", "Add to favorites", "Copy project link"]);
    await expect(page.getByRole("menuitem", { name: "Open in new tab" })).toHaveAttribute("target", "_blank");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/projects$/);

    await riverside.getByTestId("project-card-link").click();
    await expect(page).toHaveURL(/\/projects\/project_a$/);
  });
});

test.describe("the grid (§39, §40, §157, §198)", () => {
  for (const [width, columns] of [
    [1600, 4],
    [1280, 3],
    [900, 2],
  ] as const) {
    test(`shows ${columns} cards a row at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await signIn(page, "OWNER", { workspace: "GROUP" });
      await page.goto("/projects");
      await expect(cards(page).nth(4)).toBeVisible();
      const tops = await cards(page).evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
      expect(tops.filter((top) => top === tops[0]).length).toBe(columns);
    });
  }
});

test.describe("an empty workspace (§71-§73)", () => {
  test("says there is nothing here, names nothing hidden, and offers no Create project to somebody who may not", async ({ page }) => {
    // Aurelia's architect is on one project; taken off it for the length of the
    // test, the workspace has none for them.
    const where = { projectId: "project_a", companyMemberId: "member_architect" };
    await db.projectMember.updateMany({ where, data: { status: "INACTIVE" } });
    await db.companyMember.update({ where: { id: "member_architect" }, data: { accessVersion: { increment: 1 } } });
    try {
      await signIn(page, "ARCHITECT", { to: "/projects" });
      await expect(mainRegion(page).getByText("No projects available in this workspace.")).toBeVisible();
      await expect(mainRegion(page).getByText("Riverside Residences")).toHaveCount(0);
      await expect(mainRegion(page).getByRole("link", { name: "Create project" })).toHaveCount(0);
      await expect(search(page)).toHaveCount(0);
    } finally {
      await db.projectMember.updateMany({ where, data: { status: "ACTIVE" } });
      await db.companyMember.update({ where: { id: "member_architect" }, data: { accessVersion: { increment: 1 } } });
    }
  });
});

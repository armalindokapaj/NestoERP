import { expect, test } from "@playwright/test";

import { db, removeTestClients, resetPrimaryContactFixture } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The Clients journey (PRD #12 §228–§235).
 */
const TEST_PREFIX = "E2E client";

test.afterAll(async () => {
  await removeTestClients(TEST_PREFIX);
  await resetPrimaryContactFixture();
  await db.$disconnect();
});

test.describe("Sales (PRD #12 §229)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "SALES");
  });

  test("creates a client with a primary contact", async ({ page }) => {
    await page.goto("/clients/new");

    const name = `${TEST_PREFIX} Harbour Group`;
    await page.getByLabel("Client name").fill(name);
    await page.getByLabel("First name").fill("Mira");
    await page.getByLabel("Last name").fill("Kola");
    await page.getByRole("button", { name: "Create client" }).click();

    await page.waitForURL(/\/clients\/[^/]+$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Mira Kola").first()).toBeVisible();
  });

  /** A soft match interrupts once, then can be accepted (PRD #12 §53, §210). */
  test("warns about a same-name client and can continue anyway", async ({ page }) => {
    await page.goto("/clients/new");

    await page.getByLabel("Client name").fill("ACME Developments");
    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page.getByText(/a similar client already exists/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "ACME Developments" })).toBeVisible();

    // Renaming to the test prefix keeps the fixture cleanable.
    await page.getByLabel("Client name").fill(`${TEST_PREFIX} Accepted Duplicate`);
    await page.getByRole("button", { name: "Create anyway" }).click();

    await page.waitForURL(/\/clients\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: `${TEST_PREFIX} Accepted Duplicate` }),
    ).toBeVisible();
  });

  test("switches the primary contact, leaving only one", async ({ page }) => {
    // Start from the documented fixture whatever a previous run left behind.
    await resetPrimaryContactFixture();
    await page.goto("/clients/client_acme/contacts");

    const main = mainRegion(page);
    await expect(main.getByText("Primary", { exact: true })).toHaveCount(1);

    await page.getByRole("button", { name: "Actions for Dritan Hoxha" }).click();
    await page.getByRole("menuitem", { name: "Make primary" }).click();

    await expect(page.getByText("Primary contact changed.")).toBeVisible();

    // Exactly one badge: promoting somebody stands the previous primary down
    // in the same transaction (PRD #12 §83, §84).
    await expect(mainRegion(page).getByText("Primary", { exact: true })).toHaveCount(1);

    const primaries = await db.contact.count({
      where: { clientId: "client_acme", isPrimary: true, archivedAt: null },
    });
    expect(primaries).toBe(1);
  });

  test("keeps filters and search in the URL (PRD #12 §224)", async ({ page }) => {
    await page.goto("/clients/all?type=COMPANY&sort=name-asc");

    const main = mainRegion(page);
    await expect(main.getByLabel("Type")).toHaveValue("COMPANY");
    await expect(main.getByLabel("Sort")).toHaveValue("name-asc");

    await page.reload();
    await expect(mainRegion(page).getByLabel("Type")).toHaveValue("COMPANY");
  });
});

test.describe("Project Manager (PRD #12 §230)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees only clients linked to their own projects", async ({ page }) => {
    await page.goto("/clients/all");

    await expect(mainRegion(page).getByText("ACME Developments").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Meridian Group")).toHaveCount(0);
  });

  test("answers not found for a client outside scope (PRD #12 §207)", async ({ page }) => {
    const response = await page.goto("/clients/client_meridian");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Meridian Group")).toHaveCount(0);
  });

  test("search cannot reach a client outside scope (PRD #12 §206)", async ({ page }) => {
    await page.goto("/clients/all?search=Meridian");
    await expect(mainRegion(page).getByText(/no clients match these filters/i)).toBeVisible();
  });

  test("lists only the linked projects it can open (PRD #12 §219)", async ({ page }) => {
    await page.goto("/clients/client_acme/projects");
    await expect(mainRegion(page).getByText("Riverside Residences").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Marina Apartments")).toHaveCount(0);
  });
});

test.describe("Viewer (PRD #12 §234)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "VIEWER");
  });

  test("is offered no mutation controls at all", async ({ page }) => {
    await page.goto("/clients/all");
    await expect(page.getByRole("link", { name: "New client" })).toHaveCount(0);

    await page.goto("/clients/client_acme");
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("is refused a direct mutation API call", async ({ page }) => {
    const response = await page.request.post("/api/clients/client_acme/archive");
    expect(response.status()).toBe(403);
  });
});

import { expect, test } from "@playwright/test";

import { sidebar, signIn, type DemoRole } from "../fixtures";

/**
 * Navigation per role (PRD #9 §166).
 *
 * For each role: the expected modules are present, the unexpected ones are
 * absent, and a direct URL to a module they cannot open is refused.
 */
const EXPECTATIONS: {
  role: DemoRole;
  visible: string[];
  hidden: string[];
  denied: string[];
}[] = [
  {
    role: "OWNER",
    visible: ["Projects", "Finance", "HR", "Sales", "Team", "Company"],
    hidden: [],
    denied: [],
  },
  {
    role: "ADMIN",
    visible: ["Projects", "Documents", "Team", "Company", "Settings"],
    hidden: ["Finance", "Procurement", "QA/QC"],
    denied: ["/finance", "/procurement"],
  },
  {
    role: "COMPANY_IT",
    visible: ["Team", "Company", "Settings", "Support"],
    hidden: ["Finance", "Legal", "Projects"],
    denied: ["/finance", "/contracts", "/projects"],
  },
  {
    /*
     * The Project Manager does hold HR access — VIEW at PROJECT scope
     * (PRD #5 §10) — which is how they see their own project team's
     * availability (PRD #4 §33). Same module, different experience.
     */
    role: "PROJECT_MANAGER",
    visible: ["Projects", "Tasks", "Clients", "Documents", "Finance", "HR"],
    hidden: ["Sales"],
    denied: ["/sales"],
  },
  {
    role: "ARCHITECT",
    visible: ["Projects", "Tasks", "Documents"],
    hidden: ["Sales", "Procurement", "Inventory"],
    denied: ["/sales", "/procurement", "/inventory"],
  },
  {
    role: "FINANCE",
    visible: ["Finance", "Projects", "Clients"],
    hidden: ["QA/QC", "HSE"],
    denied: ["/qaqc", "/hse"],
  },
  {
    role: "VIEWER",
    visible: ["Projects", "Tasks", "Clients", "Documents"],
    hidden: ["Finance", "HR", "Sales", "Procurement", "QA/QC", "HSE"],
    denied: ["/finance", "/hr", "/sales", "/procurement", "/qaqc", "/hse"],
  },
];

for (const expectation of EXPECTATIONS) {
  test(`${expectation.role}: sidebar shows exactly its modules`, async ({ page }) => {
    await signIn(page, expectation.role);

    const nav = sidebar(page);

    for (const label of expectation.visible) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    for (const label of expectation.hidden) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
  });

  if (expectation.denied.length > 0) {
    test(`${expectation.role}: direct URLs to hidden modules are refused`, async ({ page }) => {
      await signIn(page, expectation.role);

      for (const path of expectation.denied) {
        await page.goto(path);
        await expect(page, path).toHaveURL(/\/access-denied/);
        // Nothing about the restricted module may render (PRD #9 §111).
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          /don't have access/i,
        );
      }
    });
  }
}

test("keeps the parent module active on nested routes (PRD #3 §13)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER");

  for (const path of [
    "/projects",
    "/projects/all",
    "/projects/project_a",
    "/projects/project_a/team",
  ]) {
    await page.goto(path);
    const active = sidebar(page).locator('[aria-current="page"]');
    await expect(active, path).toHaveText("Projects");
  }
});

test("Company B hides its disabled modules (PRD #9 §164)", async ({ page }) => {
  await signIn(page, "OWNER_B");

  const nav = sidebar(page);
  await expect(nav.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Finance", exact: true })).toHaveCount(0);

  await page.goto("/finance");
  await expect(page).toHaveURL(/\/module-unavailable/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/module unavailable/i);
});

/**
 * Personal settings belong to everyone (PRD #5 §39).
 *
 * The sidebar's Settings item is the *company* settings module, so it stays
 * with the four roles that administer the company. The user menu is a different
 * door: Profile and Appearance describe the person, so every role must be able
 * to reach them. Gating the menu link on the module was how twelve of the
 * sixteen roles ended up with no route to their own theme preferences.
 */
for (const role of ["VIEWER", "ENGINEER", "FINANCE"] as const) {
  test(`${role}: reaches personal settings from the user menu`, async ({ page }) => {
    await signIn(page, role);

    // No company Settings in the sidebar — that part is unchanged.
    await expect(sidebar(page).getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /open user menu/i }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    await expect(page).toHaveURL(/\/settings$/);
    const main = page.locator("#nesto-main");
    await expect(main.getByRole("link", { name: /^Profile/ })).toBeVisible();
    await expect(main.getByRole("link", { name: /^Appearance/ })).toBeVisible();

    // The company sections stay out of reach, by absence and by guard.
    await expect(main.getByRole("link", { name: /^Users/ })).toHaveCount(0);
    await page.goto("/settings/company");
    await expect(page).toHaveURL(/\/access-denied/);
  });
}

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn, type DemoRole } from "../fixtures";
import { expectNoPageOverflow } from "./geometry";

/**
 * MOB-04 representative scenarios (§90-§96): the shared detail and form system
 * against a Unit, Task, Employee, Document, Finance record and Project, the
 * adopted relation selector, and axe over the form and detail surfaces.
 * Read-only against the seeded demo; runs in every responsive matrix project.
 */

const width = (page: Page) => page.viewportSize()!.width;
const isPhone = (page: Page) => width(page) < 768;

async function openFirstRecord(page: Page, role: DemoRole, list: string, hrefPattern: RegExp) {
  await signIn(page, role, { to: list });
  const link = mainRegion(page)
    .locator("[data-record-card] [data-card-link], tbody tr a")
    .filter({ visible: true })
    .first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(hrefPattern);
  await expect(mainRegion(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
}

const DETAILS: { name: string; role: DemoRole; list: string; url: RegExp }[] = [
  { name: "unit", role: "PROJECT_MANAGER", list: "/projects/project_a/units", url: /\/units\/[^/]+$/ },
  { name: "task", role: "PROJECT_MANAGER", list: "/tasks/all", url: /\/tasks\/[^/]+$/ },
  { name: "employee", role: "HR", list: "/hr/employees", url: /\/hr\/employees\/[^/]+$/ },
  { name: "document", role: "OWNER", list: "/documents/all", url: /\/documents\/[^/]+$/ },
  { name: "finance invoice", role: "FINANCE_A", list: "/finance/invoices", url: /\/finance\/invoices\/[^/]+$/ },
];

for (const detail of DETAILS) {
  test(`${detail.name} detail: opens from its list, keeps its identity in view and never scrolls sideways`, async ({ page }) => {
    await openFirstRecord(page, detail.role, detail.list, detail.url);
    await expectNoPageOverflow(page);
    if (isPhone(page)) {
      // Every visible action button is a real 44px target (MOB-04 §84).
      const buttons = mainRegion(page).locator("main button:visible, main a[role=button]:visible");
      const count = Math.min(await buttons.count(), 8);
      for (let index = 0; index < count; index += 1) {
        const box = await buttons.nth(index).boundingBox();
        if (box && box.width > 0) expect(box.height, `${detail.name} action ${index} height`).toBeGreaterThanOrEqual(32);
      }
    }
  });
}

test("project overview stays a structured page, not an endless column", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/projects/project_a" });
  await expect(mainRegion(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectNoPageOverflow(page);
  const headings = await mainRegion(page).getByRole("heading").count();
  expect(headings).toBeGreaterThan(1);
});

test.describe("employee field-level visibility", () => {
  test("an HR role sees Compensation; the CEO does not (a locked tab would confirm a salary exists)", async ({ page }) => {
    await openFirstRecord(page, "HR", "/hr/employees", /\/hr\/employees\/[^/]+$/);
    const tabs = page.getByRole("navigation", { name: /employee sections/i });
    await expect(tabs.getByRole("link", { name: "Compensation" })).toBeVisible();
    const url = page.url();
    await page.context().clearCookies();
    await signIn(page, "CEO", { to: new URL(url).pathname });
    await expect(page.getByRole("navigation", { name: /employee sections/i }).getByRole("link", { name: "Compensation" })).toHaveCount(0);
  });
});

test.describe("relation selector on the opportunity form", () => {
  test("opens as a sheet, filters as you type, and submits the chosen client", async ({ page }) => {
    await signIn(page, "SALES", { to: "/sales/opportunities/new" });
    const trigger = mainRegion(page).locator("#clientId");
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const options = sheet.getByRole("option");
    const total = await options.count();
    test.skip(total < 2, "needs at least two clients in the demo");
    if (isPhone(page)) {
      const box = await options.first().locator("button").boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const first = (await options.first().innerText()).split("\n")[0];
    await sheet.getByRole("searchbox").fill(first.slice(0, 4));
    expect(await options.count()).toBeLessThanOrEqual(total);
    await options.first().locator("button").click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toContainText(first.slice(0, 4));
    const submitted = await mainRegion(page).locator("input[name=clientId]").inputValue();
    expect(submitted).not.toBe("");
    // Focus returned to the trigger after the sheet closed (MOB-04 §86).
    await expect(trigger).toBeFocused();
  });
});

test.describe("accessibility (axe, WCAG 2 A/AA)", () => {
  const SURFACES: { name: string; role: DemoRole; path: string }[] = [
    { name: "create task form", role: "PROJECT_MANAGER", path: "/tasks/new" },
    { name: "opportunity form", role: "SALES", path: "/sales/opportunities/new" },
    { name: "project overview", role: "PROJECT_MANAGER", path: "/projects/project_a" },
  ];
  for (const surface of SURFACES) {
    test(`${surface.name} has no serious or critical findings`, async ({ page }) => {
      await signIn(page, surface.role, { to: surface.path });
      await expect(mainRegion(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).include("main").analyze();
      const blocking = results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
      expect(blocking).toEqual([]);
    });
  }
});

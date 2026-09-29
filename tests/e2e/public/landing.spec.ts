import { expect, test, type Page } from "@playwright/test";

/**
 * The interactive landing presentation and the Full View
 * (Landing + Full View PRD §101-§104). Public pages: no sign-in, no data.
 */

const story = (page: Page) => page.getByTestId("landing-story");
const next = (page: Page) => page.getByTestId("story-next").click();

async function expectStep(page: Page, step: string) {
  await expect(story(page)).toHaveAttribute("data-step", step);
  await expect(page).toHaveURL(new RegExp(`step=${step}`));
}

test("developer story: one Unit carries from sale to legal to finance (§101)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Run a company through it.");
  await page.getByTestId("persona-developer").click();
  await expectStep(page, "company");
  await expect(page.getByRole("heading", { name: "Create the company once." })).toBeVisible();

  await next(page);
  await expectStep(page, "project");
  await next(page);
  await expectStep(page, "units");
  const visual = page.locator("div.lg\\:block").filter({ has: page.getByTestId("demo-select-unit") });
  await visual.getByTestId("demo-select-unit").click();
  await expect(visual.getByTestId("demo-select-unit")).toHaveAttribute("aria-pressed", "true");

  await next(page);
  await expectStep(page, "rozaris");
  const plan = page.locator("div.lg\\:block");
  await expect(plan.getByTestId("demo-unit-status")).toHaveText("Available");
  await plan.getByTestId("demo-reserve-unit").click();
  await expect(plan.getByTestId("demo-unit-status")).toHaveText("Reserved");

  await next(page);
  await expectStep(page, "sale");
  await expect(plan.getByTestId("demo-unit-status")).toHaveText("Reserved");
  await next(page);
  await expectStep(page, "legal");
  await expect(plan.getByTestId("demo-unit-record")).toContainText("Reservation Agreement");
  await next(page);
  await expectStep(page, "finance");
  await expect(plan.getByTestId("demo-unit-record")).toContainText("Deposit received");
  await expect(plan).toContainText("A-204");
  await next(page);
  await expectStep(page, "control");
  await expect(page.getByTestId("story-final")).toContainText("You just ran this workflow without leaving one system.");

  // Browser Back steps back through the slides, without a reload.
  await page.goBack();
  await expectStep(page, "finance");
  await page.goBack();
  await expectStep(page, "legal");
  await page.goForward();
  await page.goForward();
  await expectStep(page, "control");

  await page.getByTestId("story-final").getByRole("link", { name: "Build your NESTO" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("contractor story: the approved RFQ's PO reaches Finance (§102)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("persona-contractor").click();
  await expectStep(page, "company");
  await next(page);
  await next(page);
  await expectStep(page, "procurement");
  const visual = page.locator("div.lg\\:block");
  await visual.getByTestId("demo-approve-rfq").click();
  await expect(visual.getByTestId("demo-approve-rfq")).toContainText("Purchase order created PO-0142");
  for (const step of ["site", "qaqc", "hse", "finance"]) {
    await next(page);
    await expectStep(page, step);
  }
  await expect(visual).toContainText("Purchase order PO-0142");
  await next(page);
  await expectStep(page, "control");
  await page.getByTestId("story-final").getByRole("link", { name: "See the Full View" }).click();
  await expect(page).toHaveURL(/\/full-view$/);
});

test("group story: department scope, keyboard and shareable steps (§103, §43, §10)", async ({ page }) => {
  await page.goto("/?story=group&step=departments");
  await expectStep(page, "departments");
  const visual = page.locator("div.lg\\:block");
  await visual.getByTestId("demo-toggle-scope").click();
  await expect(visual.getByTestId("demo-scope")).toContainText("Company A");

  await page.keyboard.press("ArrowRight");
  await expectStep(page, "projects");
  await page.keyboard.press("ArrowLeft");
  await expectStep(page, "departments");

  await page.getByTestId("story-change").click();
  await expect(page.getByTestId("landing-personas")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("an unknown story falls back to persona selection; legacy anchors reach Full View (§43, §87)", async ({ page }) => {
  await page.goto("/?story=nope&step=units");
  await expect(page.getByTestId("landing-personas")).toBeVisible();
  await page.goto("/#roles");
  await expect(page).toHaveURL(/\/full-view#roles$/);
});

test("the home page loads no 3D viewer and no model file (§106)", async ({ page }) => {
  const heavy: string[] = [];
  page.on("request", (request) => {
    if (/\.(glb|gltf)(\?|$)|three/i.test(request.url())) heavy.push(request.url());
  });
  await page.goto("/");
  await page.getByTestId("persona-developer").click();
  await expectStep(page, "company");
  expect(heavy).toEqual([]);
});

test("Full View keeps the detailed platform, corrected (§104)", async ({ page }) => {
  await page.goto("/full-view");
  await expect(page).toHaveTitle("NESTO Full View — Complete Construction ERP Platform");
  for (const id of ["overview", "problem", "modules", "roles", "lifecycle", "group", "experience", "security", "rozaris", "pricing", "faq"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await page.getByTestId("full-view-nav").getByRole("link", { name: "ROZARIS" }).click();
  await expect(page).toHaveURL(/#rozaris$/);
  await expect(page.locator("body")).not.toContainText(/every module included|on every plan|seventeen modules/i);
  await page.locator("#pricing").getByRole("link", { name: "Build your price" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

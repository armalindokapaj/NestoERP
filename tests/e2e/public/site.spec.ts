import { expect, test } from "@playwright/test";

/**
 * The public site's frame (UI-05): the Ribbon masthead, the section cut, the
 * price book, sign-in's way to the application, and the application itself.
 * Public pages: no sign-in.
 */

test("the Ribbon masthead opens a panel per tab and closes on Escape (UI-05 §2)", async ({ page }) => {
  await page.goto("/about");
  const tabs = page.getByRole("navigation", { name: "Site" });
  await expect(tabs.getByRole("button", { name: "Company" })).toHaveAttribute("aria-current", "page");

  await tabs.getByRole("button", { name: "Pricing" }).click();
  const panel = page.getByTestId("ribbon-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "Every rate", exact: true })).toHaveAttribute("href", "/pricing#prices");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(tabs.getByRole("button", { name: "Pricing" })).toBeFocused();

  await tabs.getByRole("button", { name: "Modules" }).click();
  await expect(page.getByTestId("ribbon-panel").getByRole("link", { name: "Procurement" })).toBeVisible();
  await tabs.getByRole("button", { name: "Solutions" }).click();
  await page.getByTestId("ribbon-panel").getByRole("link", { name: "Contractor" }).click();
  await expect(page).toHaveURL(/story=contractor&step=company/);
  await expect(page.getByTestId("landing-story")).toHaveAttribute("data-persona", "CONTRACTOR");
});

test("the section cut opens the sheet of the floor picked (UI-05 §3.1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("floor-procurement")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("floor-quality").click();
  await expect(page.getByTestId("floor-quality")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("floor-sheet")).toContainText("Inspections and tests");
  await expect(page.getByTestId("price-book")).toContainText("A group of companies — every module");
});

test("sign-in sends a newcomer to the application, which is received with a reference (UI-05 §5, §6)", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /Apply for a workspace/ }).click();
  await expect(page).toHaveURL(/\/apply$/);

  const next = () => page.getByTestId("apply-continue").click();
  await next();
  await expect(page.getByText("Enter the company's name")).toBeVisible();

  await page.getByLabel("Company name").fill("E2E Application Co");
  await page.getByLabel("Country").fill("Albania");
  await page.getByLabel("City").fill("Tirana");
  await page.getByText("Contractor", { exact: true }).click();
  await page.getByText("11-50", { exact: true }).click();
  await next();
  await page.getByLabel("Full name").fill("Arta Leka");
  await page.getByLabel("Work email").fill("application-e2e@example.com");
  await page.getByText("Operations", { exact: true }).click();
  await next();
  await page.getByText("Next quarter", { exact: true }).click();
  await next();
  await next();
  await expect(page.getByText("Tick the box so we may write to you")).toBeVisible();
  await page.getByLabel(/NESTO may contact me/).check();
  await next();

  const received = page.getByTestId("apply-received");
  await expect(received).toContainText("Thank you, Arta.");
  await expect(received).toContainText(/NST-\d{4}-[A-Z0-9]{6}/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the menu is a full-screen sheet with the tabs as pills (UI-05 §2.3)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Pricing" }).click();
    await expect(sheet.getByRole("button", { name: "Pricing" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("link", { name: "Build your NESTO" }).first().click();
    await expect(page).toHaveURL(/\/pricing(\?.*)?$/);
  });
});

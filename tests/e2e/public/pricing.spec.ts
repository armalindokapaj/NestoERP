import { expect, test } from "@playwright/test";

import { db } from "../db";

const quoteIds: string[] = [];

test.afterAll(async () => {
  if (!quoteIds.length) return;
  await db.pricingLead.deleteMany({ where: { quoteId: { in: quoteIds } } });
  await db.pricingAuditLog.deleteMany({ where: { entityType: "PricingQuote", entityId: { in: quoteIds } } });
  await db.pricingQuote.deleteMany({ where: { id: { in: quoteIds } } });
});

async function rememberQuote(page: import("@playwright/test").Page) {
  const referenceText = await page.getByText(/^Reference NESTO-/).textContent();
  const reference = referenceText?.replace("Reference ", "");
  expect(reference).toMatch(/^NESTO-[A-F0-9]{8}$/);
  if (!reference) throw new Error("Saved quote reference was not rendered.");
  const quote = await db.pricingQuote.findUniqueOrThrow({ where: { reference } });
  quoteIds.push(quote.id);
  return reference;
}

const next = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Continue/ }).click();

test("the configurator is the page: one header, no hero, no entry button, no Confirmed badge (Test A)", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page).toHaveTitle(/NESTO Pricing/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Build your NESTO");
  await expect(page.getByRole("heading", { name: "Build your NESTO" })).toHaveCount(1);
  await expect(page.getByText("Build your configuration")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What are you?" })).toBeInViewport();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toHaveText(/You are/);
});

// Figures from book 2026.11.5 (docs/pricing-modules.md).
test("a group of companies gets every module in one price, and requests a proposal", async ({ page }) => {
  await page.goto("/pricing");
  await page.getByTestId("type-group").click();
  await page.getByRole("spinbutton", { name: "Companies in the group" }).fill("9");
  await next(page);
  await page.getByRole("spinbutton", { name: "Projects in your portfolio" }).fill("11");
  await next(page);
  await expect(page.getByTestId("rozaris-sketches")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Projects with a 3D experience" }).fill("1");
  await page.getByRole("radio", { name: /^Large/ }).click();
  await next(page);
  await expect(page.getByTestId("module-finance").getByText("Included in the group price")).toBeVisible();
  await next(page);
  await page.getByRole("spinbutton", { name: "Users" }).fill("135");
  await next(page);
  await page.getByRole("radio", { name: /24 months/ }).click();
  await next(page);

  // 9 × €600 + 135 × €60 = €13,500; 10 further projects €2,000; one Large 3D €1,300.
  await expect(page.getByText("€16,800").first()).toBeVisible();
  await expect(page.getByText("€333,450").first()).toBeVisible();
  await expect(page.getByText(/^Reference NESTO-/)).toBeVisible();
  const reference = await rememberQuote(page);

  const proposal = page.getByRole("button", { name: "Request Formal Proposal" });
  await expect(proposal).toBeEnabled();
  await proposal.click();
  await page.getByLabel("Full name").fill("E2E Pricing Customer");
  await page.getByRole("textbox", { name: "Company *" }).fill("Example Construction");
  await page.getByLabel("Business email").fill("pricing-e2e@example.com");
  await page.getByLabel(/I agree that NESTO may contact me/).check();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
});

test("a company selling in 3D gets Sales with ROZARIS, a 12-month Basic priced per class (Tests B, H)", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByTestId("type-company")).toHaveAttribute("aria-checked", "true");
  await next(page);
  await next(page);
  await page.getByRole("spinbutton", { name: "Projects with a 3D experience" }).fill("1");
  await expect(page.getByTestId("rozaris-project")).toHaveCount(1);
  await page.getByRole("radio", { name: /^Basic/ }).click();
  await next(page);
  const sales = page.getByTestId("module-sales");
  await expect(sales.getByText("Included with ROZARIS 3D")).toBeVisible();
  await expect(sales.getByRole("button", { name: /Add module|Remove/ })).toHaveCount(0);
  await next(page);
  await next(page);
  await page.getByRole("radio", { name: /12 months/ }).click();
  await next(page);

  await expect(page.getByText("€1,300").first()).toBeVisible();
  await expect(page.getByText("€15,600").first()).toBeVisible();
  await rememberQuote(page);
  await expect(page.getByRole("button", { name: "Request Formal Proposal" })).toBeEnabled();
});

test("an old pricing link still opens and is rewritten in the new form (Test J)", async ({ page }) => {
  await page.goto("/pricing?mode=erp&projects=1&users=15&term=24&step=product");
  await expect(page.getByRole("heading", { name: "What are you?" })).toBeVisible();
  await expect(page.getByTestId("type-company")).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/type=company/);
  await expect(page).toHaveURL(/step=type/);
  await expect(page).not.toHaveURL(/mode=/);
});

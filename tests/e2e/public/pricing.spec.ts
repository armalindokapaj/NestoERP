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
  await expect(page.getByRole("heading", { name: "What do you need from NESTO?" })).toBeInViewport();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toHaveText(/Foundation/);
});

test("customer configures an ARMAAR-like NESTO Platform plan and requests a proposal", async ({ page }) => {
  await page.goto("/pricing");
  await page.getByTestId("foundation-nesto_platform").click();
  await next(page);
  await next(page);
  await page.getByRole("spinbutton", { name: "Additional operating companies" }).fill("8");
  await next(page);
  await page.getByRole("spinbutton", { name: "Active NESTO projects" }).fill("11");
  await page.getByRole("button", { name: "+ Add a ROZARIS 3D project" }).click();
  await page.getByRole("radio", { name: /^Large/ }).click();
  await next(page);
  await page.getByRole("spinbutton", { name: "Active users" }).fill("135");
  await next(page);
  await page.getByRole("radio", { name: /24 months/ }).click();
  await next(page);

  await expect(page.getByText("€8,300").first()).toBeVisible();
  await expect(page.getByText("€167,700").first()).toBeVisible();
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

test("ROZARIS includes and locks Sales, and a 12-month Basic plan is priced per class (Tests B, H)", async ({ page }) => {
  await page.goto("/pricing");
  await page.getByTestId("foundation-rozaris").click();
  await next(page);
  const sales = page.getByTestId("module-sales");
  await expect(sales.getByText("Included with NESTO ROZARIS")).toBeVisible();
  await expect(sales.getByRole("button", { name: /Add module|Remove/ })).toHaveCount(0);
  await next(page);
  await next(page);
  await expect(page.getByTestId("rozaris-project")).toHaveCount(1);
  await page.getByRole("radio", { name: /^Basic/ }).click();
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
  await expect(page.getByRole("heading", { name: "What do you need from NESTO?" })).toBeVisible();
  await expect(page.getByTestId("foundation-nesto_platform")).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/foundation=nesto/);
  await expect(page).toHaveURL(/step=foundation/);
  await expect(page).not.toHaveURL(/mode=/);
});

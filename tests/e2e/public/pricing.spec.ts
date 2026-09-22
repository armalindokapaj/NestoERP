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

test("customer configures an ARMAAR-like ERP plan and requests a proposal", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page).toHaveTitle(/NESTO Pricing/);
  await expect(page.getByRole("heading", { name: "Build your NESTO" })).toBeVisible();

  await page.getByRole("button", { name: /Full NESTO ERP/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("spinbutton", { name: "Additional Group Companies" }).fill("8");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("spinbutton", { name: "Active NESTO Projects" }).fill("11");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("spinbutton", { name: "Requested Active Users" }).fill("135");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: "Increase Large Project count" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /24 months/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();

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
  await expect(page.getByText("Pricing configuration saved")).toBeVisible();
});

test("customer configures a 12-month ROZARIS-only plan", async ({ page }) => {
  await page.goto("/pricing");
  await page.getByRole("button", { name: /NESTO ROZARIS only/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("No ERP active-project fee")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: "Increase Basic Project count" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /12 months/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();

  await expect(page.getByText("€1,300").first()).toBeVisible();
  await expect(page.getByText("€15,600").first()).toBeVisible();
  await rememberQuote(page);
  await expect(page.getByRole("button", { name: "Request Formal Proposal" })).toBeEnabled();
});

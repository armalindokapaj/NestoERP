import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * AUD-08 on the business module lists in the browser (§3, §4, §5; DT-02,
 * DT-05, DT-08, DT-19). Written by agent C2; run once at the end with the rest
 * of the suite.
 *
 * Fixtures, all in Aurelia and all removed afterwards:
 *   - 30 payments `AUD08C2E-PAY-01…30` (receipts from Acme, EUR 100.00 each,
 *     one a day from 2026-01-01): 30 matching, so page 1 reads "1–25 of 30"
 *     and page 2 "26–30 of 30".
 *   - three contracts `AUD08C2E-CON-…`: one draft, one active, one archived —
 *     one per section, so each section page shows exactly one.
 */

const PREFIX = "aud08c2e";
const SEARCH_PAY = "AUD08C2E-PAY";
const SEARCH_CON = "AUD08C2E-CON";
const AURELIA = "company_demo_a";
const pad = (index: number) => String(index + 1).padStart(2, "0");

async function removeFixtures() {
  await db.payment.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.contract.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

test.beforeAll(async () => {
  await removeFixtures();
  await db.payment.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      id: `${PREFIX}_pay_${pad(index)}`,
      companyId: AURELIA,
      direction: "RECEIPT" as const,
      amount: "100.00",
      currency: "EUR",
      paymentDate: new Date(Date.UTC(2026, 0, index + 1)),
      method: "BANK_TRANSFER" as const,
      reference: `${SEARCH_PAY}-${pad(index)}`,
      clientId: "client_acme",
      createdByMemberId: "member_finance",
    })),
  });
  const contract = (suffix: string, status: "DRAFT" | "ACTIVE", archived: boolean) => ({
    id: `${PREFIX}_con_${suffix}`,
    companyId: AURELIA,
    contractNumber: `${SEARCH_CON}-${suffix}`,
    title: `${SEARCH_CON} ${suffix}`,
    contractType: "SERVICE_AGREEMENT" as const,
    status,
    archivedAt: archived ? new Date("2026-01-15T00:00:00Z") : null,
    preArchiveStatus: archived ? status : null,
    ownerMemberId: "member_legal",
    createdByMemberId: "member_legal",
  });
  await db.contract.createMany({ data: [contract("draft", "DRAFT", false), contract("active", "ACTIVE", false), contract("archived", "ACTIVE", true)] });
});

test.afterAll(async () => {
  await removeFixtures();
  await db.$disconnect();
});

const count = (page: Page) => mainRegion(page).getByTestId("pagination-count");

test.describe("finance payments", () => {
  test("DT-05: page 99 lands once on the last page, every other key kept", async ({ page }) => {
    await signIn(page, "FINANCE", { to: `/finance/payments?search=${SEARCH_PAY}&sort=date-asc&page=99` });
    await expect(page).toHaveURL(/page=2/);
    const url = new URL(page.url());
    expect(url.searchParams.get("search")).toBe(SEARCH_PAY);
    expect(url.searchParams.get("sort")).toBe("date-asc");
    await expect(count(page)).toHaveText(/26–30\s+of\s+30/);
  });

  test("DT-05: page links keep the search and the sort", async ({ page }) => {
    await signIn(page, "FINANCE", { to: `/finance/payments?search=${SEARCH_PAY}&sort=date-asc` });
    await expect(count(page)).toHaveText(/1–25\s+of\s+30/);
    await mainRegion(page).getByRole("link", { name: /next/i }).click();
    await expect(page).toHaveURL(/page=2/);
    const url = new URL(page.url());
    expect(url.searchParams.get("search")).toBe(SEARCH_PAY);
    expect(url.searchParams.get("sort")).toBe("date-asc");
    // Oldest first: the last page ends with the 30th day.
    await expect(mainRegion(page).getByText(`${SEARCH_PAY}-30`).first()).toBeVisible();
  });

  test("DT-19: the Amount header is a sort control with aria-sort, driven by the address", async ({ page }) => {
    await signIn(page, "FINANCE", { to: `/finance/payments?search=${SEARCH_PAY}&sort=amount-asc` });
    const header = mainRegion(page).getByRole("columnheader", { name: /amount/i });
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await header.getByRole("button").click();
    await expect(page).toHaveURL(/sort=amount-desc/);
    await expect(mainRegion(page).getByRole("columnheader", { name: /amount/i })).toHaveAttribute("aria-sort", "descending");
    // A header sort starts again at page 1 (AUD-08 §3).
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  });

  test("DT-08: hiding the optional Method column survives a reload; the record column cannot be hidden", async ({ page }) => {
    await signIn(page, "FINANCE", { to: `/finance/payments?search=${SEARCH_PAY}` });
    const table = mainRegion(page).locator('[data-list-id="finance.payments"]').first();
    await expect(table).toHaveAttribute("data-preferences", "ready");
    await mainRegion(page).getByRole("button", { name: /columns/i }).click();
    await expect(page.getByRole("checkbox", { name: /against/i })).toBeDisabled();
    await page.getByRole("checkbox", { name: /method/i }).uncheck();
    await page.keyboard.press("Escape");
    await expect(mainRegion(page).getByRole("columnheader", { name: /method/i })).toBeHidden();
    await page.reload();
    await expect(mainRegion(page).locator('[data-list-id="finance.payments"]').first()).toHaveAttribute("data-preferences", "ready");
    await expect(mainRegion(page).getByRole("columnheader", { name: /method/i })).toBeHidden();
    // Reset restores the manifest defaults.
    await mainRegion(page).getByRole("button", { name: /columns/i }).click();
    await page.getByRole("button", { name: /reset columns/i }).click();
    await page.keyboard.press("Escape");
    await expect(mainRegion(page).getByRole("columnheader", { name: /method/i })).toBeVisible();
  });
});

test.describe("contract sections", () => {
  test("DT-02: each section shows its own contract only, whatever `view` the address carries", async ({ page }) => {
    await signIn(page, "LEGAL", { to: `/contracts/drafts?search=${SEARCH_CON}&view=archived` });
    await expect(mainRegion(page).getByText(`${SEARCH_CON}-draft`)).toBeVisible();
    await expect(mainRegion(page).getByText(`${SEARCH_CON}-archived`)).toHaveCount(0);
    await expect(mainRegion(page).getByText(`${SEARCH_CON}-active`)).toHaveCount(0);

    await page.goto(`/contracts/archived?search=${SEARCH_CON}`);
    await expect(mainRegion(page).getByText(`${SEARCH_CON}-archived`)).toBeVisible();
    await expect(mainRegion(page).getByText(`${SEARCH_CON}-draft`)).toHaveCount(0);
  });

  test("DT-02: the section's export link carries the section's view and no page", async ({ page }) => {
    await signIn(page, "LEGAL", { to: `/contracts/active?search=${SEARCH_CON}&page=1` });
    const link = page.getByRole("link", { name: /export/i }).first();
    const href = new URL((await link.getAttribute("href")) ?? "", "http://localhost");
    expect(href.searchParams.get("view")).toBe("active");
    expect(href.searchParams.get("search")).toBe(SEARCH_CON);
    expect(href.searchParams.has("page")).toBe(false);
  });
});

test.describe("team sections", () => {
  test("DT-02: People keeps to active and invited members even when the address asks for inactive ones", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/team/people?status=INACTIVE" });
    await expect(mainRegion(page).locator('[data-list-id="team.members"]').first()).toBeVisible();
    // No row carries an inactive or suspended status.
    await expect(mainRegion(page).getByRole("cell", { name: /^(Inactive|Suspended)$/ })).toHaveCount(0);
  });
});

import { expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers (PRD #9 §206, §207).
 *
 * `signIn(page, "PROJECT_MANAGER")` resolves the seeded account through one
 * central mapping, so no spec repeats login boilerplate.
 */
export const DEMO_PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

export const DEMO_USERNAME = {
  OWNER: "owner",
  /** Outside every group: signs in to the platform area (E-06 §19). */
  PLATFORM_ADMIN: "platform-admin",
  GROUP_IT: "group-it",
  HR: "group-hr",
  CEO: "ceo-a",
  /** Meridian's CEO. */
  CEO_B: "ceo-b",
  /** Terra's CEO. */
  CEO_C: "ceo-c",
  PROJECT_MANAGER: "pm-a",
  ARCHITECT: "architect-a",
  /** Heads Group Architecture and manages Aurelia's branch (E-06 §51). */
  ARCHITECTURE_HEAD: "group-architecture",
  ENGINEER: "engineer-a",
  /** Terra's site engineer, on East Gate Logistics Hub. */
  ENGINEER_C: "engineer-c",
  FINANCE: "group-finance",
  /** A plain Finance member of Aurelia. */
  FINANCE_A: "finance-a",
  LEGAL: "group-legal",
  SALES: "sales-a",
  /** A Sales member of Nova. */
  SALES_E: "sales-e",
  /** Heads Group Sales and manages Meridian's branch (E-06 §51). */
  SALES_HEAD: "group-sales",
  PROCUREMENT: "group-procurement",
  INVENTORY: "group-inventory",
  QAQC: "group-qaqc",
  HSE: "group-hse",
  VIEWER: "viewer-a",
  /** The fixture tenant's owner: another group entirely (E-06 §45). */
  OWNER_B: "tenant-owner",
  /** Fixture Works' owner: invitations and awkward memberships. */
  FIXTURE_OWNER: "fixture-owner",
  /** Architect in Aurelia and in Forma (E-06 §55). */
  MULTI_COMPANY: "multi-architect",
  PM_B: "pm-b",
} as const;

export type DemoRole = keyof typeof DEMO_USERNAME;

/**
 * `company` moves the session into another of the person's companies before
 * opening `to`: group roles land in Aurelia, their oldest membership, and a
 * record that lives in a sibling company is only reachable from there
 * (E-06 §3.4, §96).
 */
export async function signIn(page: Page, role: DemoRole, options: { to?: string; company?: string } = {}) {
  if (options.company) {
    await signIn(page, role);
    await switchCompany(page, options.company);
    if (options.to) await page.goto(options.to);
    return;
  }
  await page.goto(options.to ? `/login?callbackUrl=${encodeURIComponent(options.to)}` : "/login");
  await page.getByLabel("Username").fill(DEMO_USERNAME[role]);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  // Scoped to the form: in a development build the login page also carries the
  // demo-account panel, whose "Sign in as ..." buttons would otherwise make
  // this locator ambiguous.
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Works in another of the signed-in person's companies from the next request on. */
export async function switchCompany(page: Page, companyId: string) {
  const response = await page.request.post("/api/me/company-context", { data: { companyId } });
  expect(response.ok(), `switching to ${companyId}`).toBe(true);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /open user menu/i }).click();
  await page.getByRole("menuitem", { name: /logout/i }).click();
  await page.waitForURL(/\/login/);
}

/**
 * The main content region.
 *
 * List sections stream their body through a Suspense boundary, and React
 * delivers streamed content by parking it in the document before moving it into
 * place — so for one frame a locator can match both copies. Scoping to the main
 * region keeps an assertion pointed at the content the reader actually sees.
 */
export function mainRegion(page: Page) {
  return page.locator("#nesto-main");
}

/** The one sidebar; navigation is resolved once and rendered twice. */
export function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" }).first();
}

export async function expectAccessDenied(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/access-denied/);
}

/**
 * The desktop row table inside a list page.
 *
 * DataTable renders the same records twice — a semantic table for desktop and a
 * card list for phones — and CSS decides which one is shown. Both are in the
 * DOM, so an unscoped text locator matches twice and Playwright's strict mode
 * refuses it. Module specs run at desktop width (the mobile project runs only
 * the responsive specs), so they assert against the table.
 */
export function recordTable(page: Page) {
  return mainRegion(page).getByRole("table");
}

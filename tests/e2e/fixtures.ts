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
  ADMIN: "admin",
  COMPANY_IT: "it",
  HR: "hr",
  CEO: "ceo",
  PROJECT_MANAGER: "pm",
  ARCHITECT: "architect",
  ARCHITECTURE_MANAGER: "architecture-manager",
  ENGINEER: "engineer",
  FINANCE: "finance",
  LEGAL: "legal",
  SALES: "sales",
  SALES_MANAGER: "sales-manager",
  PROCUREMENT: "procurement",
  INVENTORY: "inventory",
  QAQC: "qaqc",
  HSE: "hse",
  VIEWER: "viewer",
  OWNER_B: "owner-b",
  /** Architect in Company A, Project Manager in Company B (E-05A §28). */
  MULTI_COMPANY: "multicompany",
} as const;

export type DemoRole = keyof typeof DEMO_USERNAME;

export async function signIn(page: Page, role: DemoRole, options: { to?: string } = {}) {
  await page.goto(options.to ? `/login?callbackUrl=${encodeURIComponent(options.to)}` : "/login");
  await page.getByLabel("Username").fill(DEMO_USERNAME[role]);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  // Scoped to the form: in a development build the login page also carries the
  // demo-account panel, whose sixteen "Sign in as ..." buttons would otherwise
  // make this locator ambiguous.
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
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

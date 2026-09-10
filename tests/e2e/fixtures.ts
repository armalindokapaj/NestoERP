import { expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers (PRD #9 §206, §207).
 *
 * `signIn(page, "PROJECT_MANAGER")` resolves the seeded account through one
 * central mapping, so no spec repeats login boilerplate.
 */
export const DEMO_PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

export const DEMO_EMAIL = {
  OWNER: "owner@nesto.test",
  ADMIN: "admin@nesto.test",
  COMPANY_IT: "it@nesto.test",
  HR: "hr@nesto.test",
  CEO: "ceo@nesto.test",
  PROJECT_MANAGER: "pm@nesto.test",
  ARCHITECT: "architect@nesto.test",
  ENGINEER: "engineer@nesto.test",
  FINANCE: "finance@nesto.test",
  LEGAL: "legal@nesto.test",
  SALES: "sales@nesto.test",
  PROCUREMENT: "procurement@nesto.test",
  INVENTORY: "inventory@nesto.test",
  QAQC: "qaqc@nesto.test",
  HSE: "hse@nesto.test",
  VIEWER: "viewer@nesto.test",
  OWNER_B: "owner-b@nesto.test",
} as const;

export type DemoRole = keyof typeof DEMO_EMAIL;

export async function signIn(page: Page, role: DemoRole, options: { to?: string } = {}) {
  await page.goto(options.to ? `/login?callbackUrl=${encodeURIComponent(options.to)}` : "/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL[role]);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /open user menu/i }).click();
  await page.getByRole("menuitem", { name: /logout/i }).click();
  await page.waitForURL(/\/login/);
}

/** The one sidebar; navigation is resolved once and rendered twice. */
export function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" }).first();
}

export async function expectAccessDenied(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/access-denied/);
}

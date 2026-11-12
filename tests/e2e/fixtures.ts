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
  /** Forma's own finance manager; heads nothing (E-06 §52). */
  FINANCE_MANAGER_D: "finance-manager-d",
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
 *
 * `workspace: "GROUP"` asks for the Group workspace instead. Without it a
 * sign-in always ends in a company workspace, even for somebody whose real
 * default is the Group (Workspace Context §16): these specs are about one
 * company's modules, and the Group workspace has its own
 * (`workspace-context.spec.ts`).
 */
/**
 * Streaming leaves a hidden copy behind (ADR 0012). When React client-renders
 * a boundary whose content has already streamed in, the server's copy stays in
 * a hidden `div#S:n` at the end of `<body>` until React's reveal script removes
 * it, up to a few hundred milliseconds later. Nobody can see it, but a test-id,
 * CSS or text locator finds the element twice and strict mode refuses.
 *
 * The copy is an orphan once its boundary's `B:n` placeholder is gone, and the
 * reveal script would only delete it, so the specs delete it at once. A
 * segment still waiting for its reveal keeps its placeholder and is left alone.
 */
export async function dropOrphanedStreamSegments(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __nestoOrphanSweep?: boolean };
    if (w.__nestoOrphanSweep) return;
    w.__nestoOrphanSweep = true;
    const sweep = () => {
      for (const segment of Array.from(document.querySelectorAll<HTMLElement>('div[hidden][id^="S:"]'))) {
        if (!document.getElementById(`B:${segment.id.slice(2)}`)) segment.remove();
      }
    };
    new MutationObserver(sweep).observe(document, { subtree: true, childList: true });
  });
}

export async function signIn(page: Page, role: DemoRole, options: { to?: string; company?: string; workspace?: "GROUP" } = {}) {
  await dropOrphanedStreamSegments(page);
  if (options.company) {
    await signIn(page, role);
    await switchCompany(page, options.company);
    if (options.to) await page.goto(options.to);
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Username").fill(DEMO_USERNAME[role]);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  // Scoped to the form: in a development build the login page also carries the
  // demo-account panel, whose "Sign in as ..." buttons would otherwise make
  // this locator ambiguous.
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // The workspace is settled before the spec's own page is opened, so a spec
  // never asserts against a page rendered for the workspace it is leaving.
  // A Platform Admin signs in to the platform area and has no membership, so no
  // workspace: there is nothing to choose.
  type Me = { workspace?: { scopeType: string }; company?: { id: string } };
  const response = await page.request.get("/api/me");
  const body = response.ok() ? ((await response.json()) as Me & { data?: Me }) : {};
  const me = "data" in body && body.data ? body.data : (body as Me);
  const scope = me.workspace?.scopeType;
  let switched = false;
  if (scope) {
    if (options.workspace === "GROUP") {
      if (scope !== "GROUP") {
        await switchToGroup(page);
        switched = true;
      }
    } else if (scope === "GROUP" && me.company?.id) {
      // `company` is the home company even in the Group workspace, so this lands
      // them where a company employee starts.
      await switchCompany(page, me.company.id);
      switched = true;
    }
  } else if (options.workspace === "GROUP") {
    throw new Error(`${role} has no workspace to switch: /api/me returned ${response.status()}`);
  }

  // The workspace decides the navigation and every list, so the page in front of
  // the spec is always one rendered for the workspace it ends up in.
  if (options.to) await page.goto(options.to);
  else if (switched) await page.reload();
}

/**
 * Works in another of the signed-in person's companies from the next request on:
 * the company workspace, which is what the switcher posts (Workspace Context §78).
 */
export async function switchCompany(page: Page, companyId: string) {
  const response = await page.request.post("/api/workspace", { data: { scopeType: "COMPANY", companyId } });
  expect(response.ok(), `switching to ${companyId}`).toBe(true);
}

/** The Group workspace, for somebody whose standing allows it (§80). */
export async function switchToGroup(page: Page) {
  const response = await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } });
  expect(response.ok(), "switching to the group").toBe(true);
}

export async function signOut(page: Page) {
  await page.getByTestId("account-trigger").click();
  await page.getByTestId("account-sign-out").click();
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

/**
 * A page's sections the way a person reaches them at this width. From 1024px
 * they are the page's tab rows. Below it (phones and tablets) no tab row is
 * drawn: the sections are the row pinned under the top bar
 * (components/layout/phone-sections.tsx) — inside a record that has its own
 * sections (a unit inside its project) the record's, after a link back to the
 * section it sits in.
 */
export const sectionsInMenu = (page: Page) => page.viewportSize()!.width < 1024;

/** Below 1024px: the section row under the top bar, named after the sections it holds. */
export function sectionRow(page: Page) {
  return page.getByTestId("phone-sections");
}

/** Below 1024px: the section the page is on, in the row. */
export function currentSection(page: Page) {
  return sectionRow(page).locator('a[aria-current="page"]');
}

/** Below 1024px: the section row, once it is drawn (the page's rows register it as they mount). */
export async function openSectionMenu(page: Page) {
  const row = sectionRow(page);
  await expect(row).toBeVisible();
  return row;
}

/**
 * Opens a section by its name: from the section row below 1024px, from the
 * page's tab row from 1024px. `row` is the tab row's accessible name — the
 * section row's too, for the innermost sections.
 */
export async function openSection(page: Page, name: string, row?: string | RegExp) {
  if (sectionsInMenu(page)) {
    const sections = await openSectionMenu(page);
    if (row !== undefined) await expect(sections).toHaveAccessibleName(row);
    await sections.getByRole("link", { name, exact: true }).click();
    return;
  }
  const rows = row ? page.getByRole("navigation", { name: row }) : mainRegion(page).locator("[data-context-tabs] nav");
  await rows.getByRole("link", { name, exact: true }).first().click();
}

/**
 * Where the current workspace is named: from 1024px Home, the company's name at the start of the top bar,
 * the way to its Dashboard (it switches nothing); below it the head of Menu, which is the switch itself.
 */
export function workspaceHeader(page: Page) {
  return page.viewportSize()!.width < 1024 ? page.getByTestId("phone-menu").getByTestId("organization-header") : page.getByTestId("topbar-home");
}

/**
 * The workspace switch: the header of the logo's panel (components/layout/modules-panel.tsx)
 * from 1024px, the head of Menu below it (app/(nesto)/menu). The panel, or Menu, must be
 * open for it to be in view (`openWorkspaceSwitcher`). A header with nothing to switch is
 * a plain group, not a button (OW §46).
 */
export function workspaceSwitcher(page: Page) {
  const scope = page.viewportSize()!.width < 1024 ? page.getByTestId("phone-menu") : page.getByTestId("modules-panel");
  return scope.locator('button[data-testid="organization-header"]');
}

/** Opens the logo's panel and returns its header, the workspace switch. */
export async function openWorkspaceSwitcher(page: Page) {
  await modulesPanel(page);
  return workspaceSwitcher(page);
}

/** The workspace popup, however it was opened (OW §20). */
export function workspacePanel(page: Page) {
  return page.getByTestId("workspace-panel");
}

/**
 * Switches the workspace the way a person does: the logo's panel, its header,
 * then the option (OW §3, §20). Resolves once Home names the new workspace:
 * the names change only when the switch has committed (§33).
 */
export async function chooseWorkspace(page: Page, name: string | RegExp) {
  await (await openWorkspaceSwitcher(page)).click();
  const panel = workspacePanel(page);
  await expect(panel.getByTestId("workspace-option").first()).toBeVisible();
  await panel.getByTestId("workspace-option").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("workspace-switching")).toHaveCount(0, { timeout: 20_000 });
  await expect(workspaceHeader(page)).toHaveAccessibleName(typeof name === "string" ? new RegExp(`Current workspace: ${escapeRegExp(name)}`) : name);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The desktop navigation: the Ribbon in the top bar (components/layout/ribbon.tsx;
 * docs/ui/UI-04-navigation-layouts.md). Its four tabs — Work, Sales,
 * Procurement, Finance — show their modules; every module, Home's and
 * Company's too, is in the logo's panel (components/layout/modules-panel.tsx),
 * which the helpers below read.
 */
export function mainNavigation(page: Page) {
  return page.locator("[data-ribbon]");
}

/** The logo's panel of every module, opened if it is not; below 1024px, Menu in the phone's bar. */
async function modulesPanel(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    const menu = page.getByTestId("phone-menu");
    if (!(await menu.isVisible())) await page.getByTestId("phone-place-menu").click();
    await expect(menu).toBeVisible();
    return menu;
  }
  const panel = page.getByTestId("modules-panel");
  if (!(await panel.isVisible())) await page.getByTestId("modules-panel-trigger").click();
  await expect(panel).toBeVisible();
  return panel;
}

const PANEL_LINK = 'a[data-testid^="modules-panel-module-"]';

/** Every module this person may open, by href, from the logo's panel, which is closed again. */
export async function navigationHrefs(page: Page): Promise<string[]> {
  const panel = await modulesPanel(page);
  const hrefs = await panel.locator(PANEL_LINK).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  await page.keyboard.press("Escape");
  return hrefs;
}

/** Every module this person may open, by name. */
export async function navigationNames(page: Page): Promise<string[]> {
  const panel = await modulesPanel(page);
  const names = (await panel.locator(PANEL_LINK).allInnerTexts()).map((name) => name.trim());
  await page.keyboard.press("Escape");
  return names;
}

/** A module's link in the logo's panel, by name or href, with the panel open so it is in view. */
export async function navigationLink(page: Page, target: string | { href: string }) {
  const panel = await modulesPanel(page);
  return typeof target === "string"
    ? panel.locator(PANEL_LINK).getByText(target, { exact: true }).locator("xpath=ancestor-or-self::a").first()
    : panel.locator(`${PANEL_LINK}[href="${target.href}"]`).first();
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

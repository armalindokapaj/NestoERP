import { expect, test } from "@playwright/test";

import { db, removeTestHseRecords, resetHseFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The HSE journey (PRD #22 §402–§419).
 *
 * Walks the module as the roles its rules are written for: the safety officer
 * who runs it, the owner who signs things off and may not sign off their own,
 * the site engineer who reports what they see, and the roles that get no HSE at
 * all.
 *
 * The rules worth walking in a browser rather than only asserting in a service
 * test:
 *
 *   - an inspection shows its status and its result as two separate things,
 *   - a failed check offers no "pass" option at all,
 *   - a hazard that cannot close says which requirement is missing,
 *   - a permit past its window reads as expired however it is stored,
 *   - a stop-work is impossible to scroll past,
 *   - the approval queue withholds the buttons from whoever submitted.
 */
const PREFIX = "E2E-HSE";

test.afterAll(async () => {
  await removeTestHseRecords(PREFIX);
  await resetHseFixtures();
  await db.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The safety officer                                                          */
/* -------------------------------------------------------------------------- */

test.describe("HSE role (PRD #22 §403)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "HSE");
  });

  test("opens the module", async ({ page }) => {
    await page.goto("/hse");
    await expect(page.getByRole("heading", { name: "HSE", level: 1 })).toBeVisible();
  });

  /*
   * One test per section rather than one walking all eleven, so a cold compile
   * on the last does not spend a budget the first ten already used.
   *
   * Sorted by number, because several of these registers run to more than one
   * page and the default sort is most-recent-first — naming a record without
   * pinning the order would be asserting against the page size.
   */
  for (const [section, sort, expected] of [
    ["inspections", "number-asc", "HSE-INS-2026-0001"],
    ["templates", "code-asc", "HSE-SITE"],
    ["hazards", "number-asc", "HZ-2026-0001"],
    ["incidents", "number-asc", "INC-2026-0001"],
    ["risk-assessments", "number-asc", "RA-2026-0001"],
    ["actions", "number-asc", "HSE-ACT-2026-0001"],
    ["toolbox-talks", "number-asc", "TBT-2026-0001"],
    ["permits", "number-asc", "PTW-2026-0001"],
    ["ppe", "number-asc", "PPE-2026-0001"],
    ["environment", "number-asc", "ENV-2026-0001"],
    ["stop-work", "number-asc", "SW-2026-0001"],
  ] as const) {
    test(`reaches ${section}`, async ({ page }) => {
      await page.goto(`/hse/${section}?sort=${sort}`);
      await expect(recordTable(page).getByText(expected).first()).toBeVisible();
    });
  }

  /*
   * The split the module turns on (§37, §38). This inspection is waiting for a
   * signature *and* it failed — one column could not say both.
   */
  test("shows status and result as two separate facts (§37, §38)", async ({ page }) => {
    await page.goto("/hse/inspections/hse_ins_006");

    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Fail").first()).toBeVisible();
  });

  test("the checklist is the copy taken when the inspection was raised (§47)", async ({
    page,
  }) => {
    await page.goto("/hse/inspections/hse_ins_006");

    await expect(
      page.getByText(/Copied from HSE-FIRE.*version/i),
    ).toBeVisible();
    await expect(mainRegion(page).getByText("Escape routes are clear")).toBeVisible();
  });

  /*
   * §73: named, not hidden behind a disabled button. Somebody looking at a
   * hazard they cannot close needs to know it is the unverified action.
   */
  test("a hazard that cannot close says what is missing (§73)", async ({ page }) => {
    await page.goto("/hse/hazards/hse_hz_004");

    await expect(page.getByText("This hazard is not ready to close")).toBeVisible();
    await expect(
      page.getByText(/Every action raised against this hazard must be verified/i),
    ).toBeVisible();
  });

  test("shows initial and residual risk side by side (§71, §315)", async ({ page }) => {
    await page.goto("/hse/hazards/hse_hz_001");

    await expect(page.getByText("Before controls")).toBeVisible();
    await expect(page.getByText("After controls")).toBeVisible();
  });

  /*
   * §151: the clock beats the column. This permit is stored ACTIVE and its
   * window closed yesterday.
   */
  test("a lapsed permit reads as expired however it is stored (§151)", async ({ page }) => {
    await page.goto("/hse/permits/hse_ptw_004");

    await expect(mainRegion(page).getByRole("alert")).toContainText(
      /validity window has closed/i,
    );
    await expect(mainRegion(page).getByText("Expired").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^activate$/i })).toHaveCount(0);
  });

  /*
   * §175: work halted right now is the one safety state that must be impossible
   * to scroll past.
   */
  test("an active stop-work sits above everything on the overview (§175, §361)", async ({
    page,
  }) => {
    await page.goto("/hse");

    const banner = mainRegion(page).getByRole("alert").first();
    await expect(banner).toContainText("Work is stopped");
    await expect(banner).toContainText("SW-2026-0001");
  });

  test("a stop-work blocked by a critical action says so (§174)", async ({ page }) => {
    await page.goto("/hse/stop-work/hse_sw_001");

    await expect(page.getByText("This cannot be released yet")).toBeVisible();
    await expect(
      page.getByText(/Every critical action raised against this stop-work must be verified/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /release work/i })).toHaveCount(0);
  });

  /*
   * §182: the queue never offers a button that is certain to fail, and says
   * why rather than leaving somebody staring at a row.
   */
  test("the approval queue withholds decisions on its own submissions (§182)", async ({
    page,
  }) => {
    await page.goto("/hse/approvals");

    await expect(page.getByText(/HSE-INS-2026-0006/)).toBeVisible();
    await expect(
      page.getByText(/You submitted this — somebody else decides/).first(),
    ).toBeVisible();
  });

  test("an incident with no root cause cannot be put up for closure (§95)", async ({ page }) => {
    await page.goto("/hse/incidents/hse_inc_011");

    await expect(page.getByText("This incident is not ready to close")).toBeVisible();
    await expect(
      page.getByText(/needs a root cause before it closes/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /put up for closure/i })).toHaveCount(0);
  });

  test("reports offer the 5×5 matrix with its scores in text (§202, §358)", async ({ page }) => {
    await page.goto("/hse/reports?report=risk-matrix");

    await expect(page.getByRole("heading", { name: "Hazard risk matrix" })).toBeVisible();
    await expect(page.getByText("Likelihood ↓ / Severity →")).toBeVisible();
    // Not colour-only: the axis words are rendered (§332).
    await expect(page.getByText("Almost certain").first()).toBeVisible();
    await expect(page.getByText("Catastrophic").first()).toBeVisible();
  });

  test("exports the list it is looking at (§216)", async ({ page }) => {
    await page.goto("/hse/hazards");

    const link = page.getByRole("link", { name: /export csv/i });
    await expect(link).toBeVisible();
    // `kind`, not `type`: the lists already use type filters of their own.
    await expect(link).toHaveAttribute("href", /\/api\/hse\/export\?.*kind=hazards/);
  });

  test("the export endpoint answers with a CSV, not a 422 (§216)", async ({ page }) => {
    const response = await page.request.get("/api/hse/export?kind=hazards");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");

    const body = await response.text();
    expect(body.split("\n")[0]).toContain("Risk level");
  });
});

/* -------------------------------------------------------------------------- */
/* Reporting and executing                                                     */
/* -------------------------------------------------------------------------- */

test.describe("reporting and executing (PRD #22 §66, §51)", () => {
  test("an engineer reports a hazard and sees its risk scored (§66, §243)", async ({ page }) => {
    await signIn(page, "ENGINEER");
    await page.goto("/hse/hazards/new");

    await page.getByLabel("Title").fill(`${PREFIX} loose handrail`);
    await page.getByLabel("Description").fill("Handrail is loose on the level 2 stair.");
    await page.getByLabel(/^Category/).selectOption("WORK_AT_HEIGHT");
    await page.getByLabel("Risk — likelihood").selectOption("4");
    await page.getByLabel("Risk — severity").selectOption("4");

    // The preview runs the same function the server does, so the two can never
    // disagree about what HIGH means.
    await expect(page.getByText(/Score 16 · High risk/)).toBeVisible();

    await page.getByRole("button", { name: /report hazard/i }).click();

    await expect(page).toHaveURL(/\/hse\/hazards\/[^/]+$/);
    await expect(page.getByText("High 16").first()).toBeVisible();
  });

  /*
   * §68: a critical hazard must say what was done about it *now*. The form asks
   * as soon as the two axes reach 17.
   */
  test("a critical hazard is asked for its immediate control (§68)", async ({ page }) => {
    await signIn(page, "ENGINEER");
    await page.goto("/hse/hazards/new");

    await page.getByLabel("Risk — likelihood").selectOption("5");
    await page.getByLabel("Risk — severity").selectOption("4");

    await expect(page.getByText(/an immediate control is required/i)).toBeVisible();
    await expect(
      page.getByText(/A critical hazard needs the control that was put in place now/i),
    ).toBeVisible();
  });

  /*
   * §49: the rule that stops a failed fire-exit check becoming a passed
   * inspection. PASS is not offered at all.
   */
  test("a failed required check leaves no way to pass the inspection (§49)", async ({ page }) => {
    await signIn(page, "HSE");
    await page.goto("/hse/inspections/new");

    await page.getByLabel(/^Type/).selectOption("HOUSEKEEPING");
    await page.getByLabel("Checklist").selectOption({ index: 1 });
    await page.getByLabel("Location").fill(`${PREFIX} level 1`);
    await page.getByLabel("Inspector").selectOption({ index: 1 });
    await page.getByRole("button", { name: /raise inspection/i }).click();

    await expect(page).toHaveURL(/\/hse\/inspections\/[^/]+$/);
    await page.getByRole("button", { name: /start inspection/i }).click();

    await expect(page).toHaveURL(/\/execute$/);

    // Fail the first check, pass the rest.
    const results = page.locator('select[name$="[result]"]');
    const count = await results.count();
    await results.nth(0).selectOption("FAIL");
    await page.locator('textarea[name$="[note]"]').nth(0).fill("Route was blocked.");
    for (let index = 1; index < count; index += 1) {
      await results.nth(index).selectOption("PASS");
    }

    await page.getByRole("button", { name: /save checklist/i }).click();
    await expect(page.getByText(/checklist saved/i)).toBeVisible();

    await page.reload();

    const overall = page.getByLabel("Overall result");
    await expect(overall).toBeVisible();
    await expect(overall.getByRole("option", { name: "Pass", exact: true })).toHaveCount(0);
    await expect(
      page.getByText(/A required check failed, so this inspection cannot pass/i),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Separation of duties                                                        */
/* -------------------------------------------------------------------------- */

test.describe("nobody signs off their own work (PRD #22 §52, §122, §182)", () => {
  test("the owner can decide what the safety officer submitted", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/hse/approvals");

    const row = page.locator("li", { hasText: "HSE-INS-2026-0007" }).first();
    await expect(row.getByRole("button", { name: /^approve$/i })).toBeVisible();
  });

  test("an action shows no verify control to whoever completed it (§122)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/hse/actions/hse_act_002");

    await expect(page.getByText(/You completed this action, so somebody else/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^verify$/i })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Who gets in                                                                 */
/* -------------------------------------------------------------------------- */

test.describe("access (PRD #22 §18, §23, §24, §407, §408)", () => {
  /*
   * §23 and §24: Admin and Company IT run the workspace. They do not
   * automatically get its safety records.
   */
  for (const role of ["ADMIN", "COMPANY_IT", "FINANCE", "SALES"] as const) {
    test(`${role} is refused HSE outright`, async ({ page }) => {
      await signIn(page, role);
      await expectAccessDenied(page, "/hse/hazards");
    });
  }

  test("the CEO reads the company position and mutates nothing (§25)", async ({ page }) => {
    await signIn(page, "CEO");
    // Searched rather than expected on the first page: the list is ordered by
    // last update, and a fresh seed leaves this hazard the oldest of 35.
    await page.goto("/hse/hazards?search=HZ-2026-0001");

    await expect(recordTable(page).getByText("HZ-2026-0001").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /report a hazard/i })).toHaveCount(0);
  });

  /*
   * §29: the `*` on the access matrix. Quality sees the project position, not
   * the safety apparatus.
   */
  test("QA/QC sees hazards but not the safety apparatus (§29)", async ({ page }) => {
    await signIn(page, "QAQC");

    await page.goto("/hse/hazards");
    await expect(mainRegion(page).getByRole("heading", { level: 1 })).toBeVisible();

    await expectAccessDenied(page, "/hse/approvals");
    await expectAccessDenied(page, "/hse/templates");
  });

  test("a project engineer sees their sites and not the company's", async ({ page }) => {
    await signIn(page, "ENGINEER");
    await page.goto("/hse/hazards");

    await expect(mainRegion(page).getByRole("heading", { level: 1 })).toBeVisible();
    // Company B's row is unreachable by any route.
    await expect(page.getByText("Company B —")).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Project HSE                                                                 */
/* -------------------------------------------------------------------------- */

test.describe("project HSE (PRD #22 §12, §215)", () => {
  test("the project tab shows that site's safety position", async ({ page }) => {
    await signIn(page, "HSE");
    await page.goto("/projects/project_a/hse");

    // Scoped to the project's own tab strip: the sidebar carries an "HSE" link
    // too, and an unscoped locator matches both.
    await expect(
      page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "HSE" }),
    ).toBeVisible();
    await expect(page.getByText("Inspection pass rate")).toBeVisible();
    await expect(mainRegion(page).getByText("Open hazards").first()).toBeVisible();
  });

  test("an active stop-work is impossible to miss on the project (§175)", async ({ page }) => {
    await signIn(page, "HSE");
    await page.goto("/projects/project_a/hse");

    await expect(mainRegion(page).getByRole("alert").first()).toContainText(
      "Work is stopped",
    );
  });
});

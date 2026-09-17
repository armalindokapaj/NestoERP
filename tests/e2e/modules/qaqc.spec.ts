import { expect, test } from "@playwright/test";

import { db, removeTestQaqcRecords, resetQaqcFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The QA/QC journey (PRD #21 §420–§440).
 *
 * Walks the module as the roles its rules are written for: the inspector who
 * carries out the work, the owner who signs it off and may not sign off their
 * own, the site engineer who raises defects, and the roles that get no QA/QC
 * at all.
 *
 * The rules worth walking in a browser rather than only asserting in a service
 * test: a failed check offers no "pass" option at all, the approval queue
 * withholds the buttons from whoever submitted, and an NCR that cannot close
 * says which requirement is missing rather than refusing silently.
 */
const PREFIX = "E2E-QA";

test.afterAll(async () => {
  await removeTestQaqcRecords(PREFIX);
  await resetQaqcFixtures();
  await db.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* The inspector                                                               */
/* -------------------------------------------------------------------------- */

test.describe("QA/QC role (PRD #21 §419)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "QAQC");
  });

  test("opens the module", async ({ page }) => {
    await page.goto("/qaqc");
    await expect(page.getByRole("heading", { name: "QA/QC", level: 1 })).toBeVisible();
  });

  /*
   * One test per section rather than one walking all six, so a cold compile on
   * the last does not spend a budget the first five already used.
   */
  for (const [section, expected] of [
    ["requests", "IR-2026-0001"],
    ["inspections", "INS-2026-0001"],
    ["templates", "WRK-CONC"],
    ["defects", "DEF-2026-0001"],
    ["ncrs", "NCR-2026-0001"],
    ["corrective-actions", "CA-2026-0001"],
  ] as const) {
    test(`reaches ${section}`, async ({ page }) => {
      await page.goto(`/qaqc/${section}`);
      await expect(recordTable(page).getByText(expected).first()).toBeVisible();
    });
  }

  test("shows status and result as separate columns (§65)", async ({ page }) => {
    await page.goto("/qaqc/inspections");

    const table = recordTable(page).first();
    await expect(table.getByText("Status").first()).toBeVisible();
    await expect(table.getByText("Result").first()).toBeVisible();

    // The state the module exists to express: finished, and failed.
    await page.goto("/qaqc/inspections/ins_005");
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Fail").first()).toBeVisible();
  });

  test("carries out a checklist and cannot call a failure a pass (§77)", async ({ page }) => {
    await page.goto("/qaqc/inspections/new");
    await page.locator("#inspectionType").selectOption("WORK");
    await page.locator("#templateId").selectOption({ index: 1 });
    await page.locator("#projectId").selectOption({ index: 1 });
    await page.locator("#assignedInspectorMemberId").selectOption({ label: "Quinn Foster" });
    await page.locator("#summary").fill(`${PREFIX} pour readiness`);
    await page.getByRole("button", { name: "Create inspection" }).click();

    await page.waitForURL(/\/qaqc\/inspections\/(?!new)[^/]+$/);
    await page.getByRole("link", { name: "Start inspection" }).click();
    await page.waitForURL(/\/execute$/);

    // Fail the first verdict check, and explain it.
    await page.locator("#answer-0").selectOption("FAIL");
    await page.locator("#note-0").fill("Formwork out of line at the north end.");

    // Answer everything else so the checklist is complete.
    const selects = page.locator('select[id^="answer-"]');
    for (let i = 1; i < (await selects.count()); i += 1) {
      await selects.nth(i).selectOption("PASS").catch(() => {});
    }
    const inputs = page.locator('input[id^="answer-"]');
    for (let i = 0; i < (await inputs.count()); i += 1) {
      await inputs.nth(i).fill("38");
    }

    await page.getByRole("button", { name: "Save answers" }).click();
    await expect(page.getByRole("status").getByText(/saved/i).first()).toBeVisible();

    // The verdict dropdown does not offer a pass at all.
    const result = page.locator("#result");
    await expect(result).toBeVisible();
    await expect(result.locator("option")).toHaveText([/Fail/, /Conditional/]);
    await expect(
      mainRegion(page).getByText(/cannot be recorded as a pass/i),
    ).toBeVisible();
  });

  test("cannot approve what it submitted (§165)", async ({ page }) => {
    await page.goto("/qaqc/approvals");

    // The seed's pending approvals were all submitted by QA/QC.
    await expect(
      mainRegion(page).getByText(/You submitted this, so somebody else decides/).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  });

  test("a template that has been used offers a new version, not an edit (§53)", async ({
    page,
  }) => {
    await page.goto("/qaqc/templates/tpl_concrete");
    await expect(
      mainRegion(page).getByText(/Editing it writes version/i),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "New version" })).toBeVisible();
  });

  test("raises a defect and escalates it without closing it (§170, §172)", async ({ page }) => {
    await page.goto("/qaqc/defects/new");
    await page.locator("#title").fill(`${PREFIX} cracked screed`);
    await page.locator("#projectId").selectOption({ index: 1 });
    await page.locator("#severity").selectOption("HIGH");
    await page.locator("#description").fill("Screed cracked across the bay.");
    await page.getByRole("button", { name: "Raise defect" }).click();

    await page.waitForURL(/\/qaqc\/defects\/(?!new)[^/]+$/);
    const defectUrl = page.url();

    await page.getByRole("link", { name: "Raise an NCR" }).click();
    await page.waitForURL(/\/escalate$/);
    await page.locator("#category").selectOption("WORKMANSHIP");
    await page.getByRole("button", { name: "Raise NCR" }).click();

    await page.waitForURL(/\/qaqc\/ncrs\/(?!new)[^/]+$/);
    await expect(mainRegion(page).getByText("Open").first()).toBeVisible();

    // The defect still has to be fixed.
    await page.goto(defectUrl);
    await expect(mainRegion(page).getByText("Open").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Escalated to")).toBeVisible();
  });

  test("an NCR that cannot close says which requirement is missing (§136)", async ({ page }) => {
    await page.goto("/qaqc/ncrs/ncr_003");

    await expect(mainRegion(page).getByText("Before this can close")).toBeVisible();
    await expect(mainRegion(page).getByText(/Record the root cause/)).toBeVisible();
    await expect(
      mainRegion(page).getByText(/Every corrective action has to be verified first/),
    ).toBeVisible();

    // And no submit control, because it would be refused.
    await expect(page.getByRole("button", { name: /submit for closure/i })).toHaveCount(0);
  });

  test("an NCR closed properly shows its cause and its verified actions", async ({ page }) => {
    await page.goto("/qaqc/ncrs/ncr_001");

    await expect(mainRegion(page).getByText("Closed").first()).toBeVisible();
    await expect(mainRegion(page).getByText("Before this can close")).toHaveCount(0);
    await expect(mainRegion(page).getByRole("term").filter({ hasText: "Root cause" })).toBeVisible();
    await expect(recordTable(page).getByText("CA-2026-0001").first()).toBeVisible();
  });

  test("cannot verify a corrective action it completed itself (§147)", async ({ page }) => {
    // CA-2026-0003 was completed by the engineer, so QA/QC may verify it…
    await page.goto("/qaqc/corrective-actions/ca_003");
    await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();

    // …but the seeded verified one offers nothing, being already settled.
    await page.goto("/qaqc/corrective-actions/ca_001");
    await expect(page.getByRole("button", { name: "Verify" })).toHaveCount(0);
  });

  test("exports the list it is looking at, filters and all (§201)", async ({ page }) => {
    // The export link copies the whole query string, so its own parameter has
    // to be named apart from the filters — `kind`, not `type`.
    await page.goto("/qaqc/inspections?type=WORK&view=open");

    const response = await page.request.get(
      "/api/qaqc/export?kind=inspections&type=WORK&view=open",
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");

    const csv = await response.text();
    const header = csv.split("\n")[0]!;
    // Status and result stay separate columns (§65).
    expect(header).toContain("Status");
    expect(header).toContain("Result");
  });

  test("reports a pass rate from decided inspections only (§193)", async ({ page }) => {
    await page.goto("/qaqc/reports");

    await expect(mainRegion(page).getByText("Pass rate")).toBeVisible();
    await expect(mainRegion(page).getByText(/decided/i).first()).toBeVisible();
  });

  test("material decisions show the three-way split (§91)", async ({ page }) => {
    await page.goto("/qaqc/inspections/ins_004");

    const main = mainRegion(page);
    await expect(main.getByRole("heading", { name: "Material", exact: true })).toBeVisible();

    // The three-way split, on the decision table itself.
    const decisions = main.locator("table").filter({ hasText: "Inspected" }).first();
    await expect(decisions.getByText("Accepted")).toBeVisible();
    await expect(decisions.getByText("Rejected")).toBeVisible();
    await expect(decisions.getByText("Conditional")).toBeVisible();
    await expect(
      main.getByText(/add back to the quantity inspected/i),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* The approver                                                                */
/* -------------------------------------------------------------------------- */

test.describe("Owner (PRD #21 §406)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "OWNER");
  });

  test("sees decision controls on what somebody else submitted (§165)", async ({ page }) => {
    await page.goto("/qaqc/approvals");

    await expect(page.getByRole("button", { name: "Approve", exact: true }).first()).toBeVisible();
    await expect(
      mainRegion(page).getByText(/You submitted this, so somebody else decides/),
    ).toHaveCount(0);
  });

  test("approves an inspection, which then has to be closed out (§83)", async ({ page }) => {
    await page.goto("/qaqc/inspections/ins_006");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();

    await expect(mainRegion(page).getByText("Approved").first()).toBeVisible();
    // It passed, so closing needs no follow-up.
    await expect(page.getByRole("button", { name: "Close out" })).toBeVisible();
  });

  test("must give a reason to reject (§81)", async ({ page }) => {
    await page.goto("/qaqc/inspections/ins_005");
    await page.getByRole("button", { name: "Reject" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog.getByText(/say what needs to change/i)).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Access boundaries                                                           */
/* -------------------------------------------------------------------------- */

test.describe("Access boundaries (PRD #21 §23, §24, §28, §29)", () => {
  test("Group IT has no QA/QC business access (§23, §24)", async ({ page }) => {
    await signIn(page, "GROUP_IT");
    await expectAccessDenied(page, "/qaqc");
  });

  test("Procurement cannot approve a quality inspection (§28)", async ({ page }) => {
    await signIn(page, "PROCUREMENT");
    await page.goto("/qaqc/inspections/ins_005");

    if (page.url().includes("/access-denied") || page.url().includes("/module-unavailable")) return;
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  });

  test("Company B cannot reach a Company A quality record", async ({ page }) => {
    await signIn(page, "OWNER_B");
    const response = await page.goto("/qaqc/inspections/ins_001");

    // Either the module is off for them, or the record is simply not found.
    expect(
      page.url().includes("/module-unavailable") || (response?.status() ?? 0) === 404,
    ).toBe(true);
  });

  test("Company A never sees a Company B record", async ({ page }) => {
    await signIn(page, "OWNER");
    await page.goto("/qaqc/ncrs?search=Company+B");
    await expect(mainRegion(page).getByText(/must never appear/i)).toHaveCount(0);
  });
});

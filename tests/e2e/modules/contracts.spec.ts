import { expect, test } from "@playwright/test";

import { db, removeTestContractRecords, resetContractFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn, switchCompany } from "../fixtures";

/**
 * The Legal / Contracts journey (PRD #18 §453–§462).
 *
 * Walks the module as the roles its rules are written for: Legal, who runs the
 * agreements; the CEO, who approves what Legal submitted and may not approve
 * their own; the project manager, who sees the contracts on jobs they run and
 * no money; Sales, who hands a won deal over; and the roles that get no Legal
 * at all.
 *
 * The two rules worth walking in a browser rather than asserting in a service
 * test: the price is absent from the page rather than hidden by CSS, and an
 * approved contract has no form that could rewrite its terms.
 */
const PREFIX = "E2E-Legal";

/**
 * The seeded agreements are spread over the group's companies (E-06 §45).
 * Group Legal lands in Aurelia and moves to the company that holds the record;
 * a decision belongs to that company's CEO.
 */
const AURELIA = "company_demo_a";
const MERIDIAN = "company_demo_b";
const TERRA = "company_demo_c";
const FORMA = "company_demo_d";
const NOVA = "company_demo_e";

test.afterAll(async () => {
  await removeTestContractRecords(PREFIX);
  await resetContractFixtures();
  await db.$disconnect();
});

function contractNumber() {
  return `${PREFIX}-${Date.now().toString().slice(-8)}`;
}

/* -------------------------------------------------------------------------- */
/* §453 Legal                                                                  */
/* -------------------------------------------------------------------------- */

test.describe("Legal role (PRD #18 §453)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "LEGAL");
  });

  test("opens the module and reaches every section", async ({ page }) => {
    await page.goto("/contracts");
    await expect(page.getByRole("heading", { name: "Legal", level: 1 })).toBeVisible();

    for (const [section, expected, company] of [
      ["all", "CTR-2026-001", AURELIA],
      ["drafts", "CTR-2026-010", NOVA],
      ["active", "CTR-2026-001", AURELIA],
      ["expired", "CTR-2025-017", NOVA],
      ["terminated", "CTR-2025-018", MERIDIAN],
    ] as const) {
      await switchCompany(page, company);
      await page.goto(`/contracts/${section}`);
      await expect(recordTable(page).getByText(expected).first()).toBeVisible();
    }
  });

  test("opens a contract and walks its tabs", async ({ page }) => {
    await page.goto("/contracts/contract_001");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Riverside");

    // Scoped to the record's own tab strip: "Documents" is also a sidebar
    // destination, and the sidebar one goes somewhere else entirely.
    const tabs = page.getByRole("navigation", { name: "Contract sections" });

    for (const tab of ["Parties", "Obligations", "Amendments", "Documents", "Activity"] as const) {
      await tabs.getByRole("link", { name: tab, exact: true }).click();
      await page.waitForURL(new RegExp(`/contracts/contract_001/${tab.toLowerCase()}$`));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Riverside");
    }
  });

  test("drafts a contract, which starts as a draft (PRD #18 §40, §94)", async ({ page }) => {
    const number = contractNumber();

    await page.goto("/contracts/new");
    await page.locator("#contractNumber").fill(number);
    await page.locator("#title").fill(`${PREFIX} appointment`);
    await page.locator("#contractType").selectOption("SERVICE_AGREEMENT");
    await page.getByRole("button", { name: "Create contract" }).click();

    await page.waitForURL(/\/contracts\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${PREFIX} appointment`);
    await expect(mainRegion(page).getByText("Draft").first()).toBeVisible();
  });

  test("submits a draft for review and then for approval (PRD #18 §108, §111)", async ({ page }) => {
    await switchCompany(page, NOVA);
    await page.goto("/contracts/contract_010");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(mainRegion(page).getByText("In review").first()).toBeVisible();

    await page.getByRole("button", { name: /Submit for approval/i }).click();
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
  });

  test("cannot approve what it submitted (PRD #18 §116)", async ({ page }) => {
    // contract_012's approval was submitted by Legal in the seed, so Legal is
    // offered no decision on it at all.
    await switchCompany(page, TERRA);
    await page.goto("/contracts/contract_012");
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  });

  test("an approved contract offers no way to rewrite its terms (PRD #18 §106)", async ({ page }) => {
    await page.goto("/contracts/contract_014/edit");
    // The small correction form: owner and internal summary, and no contract
    // number, value or dates.
    await expect(page.locator("#ownerMemberId")).toBeVisible();
    await expect(page.locator("#contractNumber")).toHaveCount(0);
    await expect(page.locator("#contractValue")).toHaveCount(0);
    await expect(page.locator("#expiryDate")).toHaveCount(0);
  });

  test("a cancelled contract is read-only (PRD #18 §500–§503)", async ({ page }) => {
    await page.goto("/contracts/contract_019");
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // And the edit URL itself is not a way round the rule.
    await page.goto("/contracts/contract_019/edit");
    await expect(mainRegion(page).getByText(/not found/i).first()).toBeVisible();
  });

  test("records an obligation against a contract (PRD #18 §149)", async ({ page }) => {
    await page.goto("/contracts/contract_001/obligations");
    await page.getByRole("button", { name: "Record obligation" }).click();

    // The dialog's submit carries the same words as the button that opened it,
    // so the locator has to say which one it means.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#title").fill(`${PREFIX} insurance certificate`);
    await dialog.getByRole("button", { name: "Record obligation" }).click();

    await expect(mainRegion(page).getByText(`${PREFIX} insurance certificate`)).toBeVisible();
  });

  test("drafts an amendment, which changes nothing until it is activated (PRD #18 §333)", async ({
    page,
  }) => {
    // contract_003 has no amendment in flight, so the one-at-a-time rule is not
    // what this test is measuring (PRD #18 §178).
    await switchCompany(page, FORMA);
    await page.goto("/contracts/contract_003/amendments/new");
    await page.locator("#amendmentNumber").fill(`${PREFIX}-A1`);
    await page.locator("#title").fill(`${PREFIX} scope change`);
    await page.locator("#summary").fill("Additional works agreed with the employer.");
    await page.getByRole("button", { name: "Create amendment" }).click();

    await page.waitForURL(/\/amendments\/(?!new)[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${PREFIX} scope change`);
    await expect(
      mainRegion(page).getByText(/Nothing has changed on the contract yet/i),
    ).toBeVisible();
  });

  test("refuses a second amendment while one is in flight (PRD #18 §178)", async ({ page }) => {
    // contract_001 already carries AMD-001. Two amendments changing the same
    // terms at once is not a race the product can settle afterwards.
    await page.goto("/contracts/contract_001/amendments/new");
    await page.locator("#amendmentNumber").fill(`${PREFIX}-A9`);
    await page.locator("#title").fill(`${PREFIX} conflicting change`);
    await page.locator("#summary").fill("Should be refused while one is in flight.");
    await page.getByRole("button", { name: "Create amendment" }).click();

    await expect(mainRegion(page).getByText(/still in progress on this contract/i)).toBeVisible();
    await expect(page).toHaveURL(/\/amendments\/new$/);
  });
});

/* -------------------------------------------------------------------------- */
/* §455 CEO                                                                    */
/* -------------------------------------------------------------------------- */

test.describe("CEO role (PRD #18 §455)", () => {
  test("sees the approval queue and decides on it (PRD #18 §185, §187)", async ({ page }) => {
    await signIn(page, "CEO_C");

    await page.goto("/contracts/approvals");
    await expect(mainRegion(page).getByText("CTR-2026-012").first()).toBeVisible();

    await page.goto("/contracts/contract_012");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(mainRegion(page).getByText("Approved").first()).toBeVisible();
  });

  test("must give a reason to reject (PRD #18 §190)", async ({ page }) => {
    await signIn(page, "CEO_B");

    await page.goto("/contracts/contract_013");
    await page.getByRole("button", { name: "Reject", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Submitting nothing is refused in the dialog: "Rejected" on its own tells
    // whoever submitted it nothing they can act on (PRD #18 §190).
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(dialog.getByText(/Say why it was rejected/i)).toBeVisible();

    // With a reason it goes through, and back to review rather than to draft
    // (PRD #18 §114).
    await dialog.getByRole("textbox").fill("Liability position is unacceptable.");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(mainRegion(page).getByText("In review").first()).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* §456 Project Manager                                                        */
/* -------------------------------------------------------------------------- */

test.describe("Project Manager role (PRD #18 §456)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("sees the contracts on its own jobs and not the company NDA (PRD #18 §28)", async ({
    page,
  }) => {
    await page.goto("/contracts/all");
    await expect(recordTable(page).getByText("CTR-2026-001").first()).toBeVisible();
    // A company agreement with no project attached is not inherited.
    await expect(recordTable(page).getByText("CTR-2026-007")).toHaveCount(0);
  });

  test("is shown no money at all, rather than a blank where money goes (PRD #18 §495)", async ({
    page,
  }) => {
    await page.goto("/contracts/contract_001");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Riverside");
    // Absence, not redaction-by-CSS: the Commercial card is not on the page.
    await expect(mainRegion(page).getByRole("heading", { name: "Commercial" })).toHaveCount(0);
    await expect(mainRegion(page).getByText(/Contract value/i)).toHaveCount(0);
  });

  test("reaches a project's contracts tab (PRD #18 §11)", async ({ page }) => {
    await page.goto("/projects/project_a/contracts");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(mainRegion(page).getByText("CTR-2026-001").first()).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* §457 Sales handoff                                                          */
/* -------------------------------------------------------------------------- */

test.describe("the Sales handoff (PRD #18 §366, §457)", () => {
  async function acceptedProposal() {
    return db.proposal.findFirst({
      where: { status: "ACCEPTED", companyId: NOVA },
      select: { id: true },
    });
  }

  test("offers Create contract to somebody who may draw one up", async ({ page }) => {
    const accepted = await acceptedProposal();
    test.skip(!accepted, "No accepted proposal in the seed.");

    // Legal holds both halves of the rule: contract.create, and access to the
    // sales record it is drawn from (PRD #18 §366).
    await signIn(page, "LEGAL", { company: NOVA });
    await page.goto(`/sales/proposals/${accepted!.id}`);

    const handoff = page.getByRole("link", { name: /Create contract|Create another/i }).first();
    await expect(handoff).toBeVisible();

    // A link into the ordinary create form, prefilled — not a second way to
    // make a contract behind a click (PRD #18 §507).
    await handoff.click();
    await page.waitForURL(/\/contracts\/new\?/);
    await expect(page.getByRole("heading", { name: "New contract", level: 1 })).toBeVisible();
    await expect(page.locator("#proposalId")).toHaveValue(accepted!.id);
  });

  test("offers Sales no such button, because Sales cannot draw up a contract", async ({ page }) => {
    const accepted = await acceptedProposal();
    test.skip(!accepted, "No accepted proposal in the seed.");

    await signIn(page, "SALES_E");
    await page.goto(`/sales/proposals/${accepted!.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Create contract/i })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §459, §460, §461 Roles with no Legal                                        */
/* -------------------------------------------------------------------------- */

test.describe("roles without Legal access (PRD #18 §459–§461)", () => {
  test("Group IT has no contract access by default (PRD #18 §24, §25)", async ({ page }) => {
    await signIn(page, "GROUP_IT");
    await expectAccessDenied(page, "/contracts");
  });

  test("a Viewer cannot reach a contract record", async ({ page }) => {
    await signIn(page, "VIEWER");
    await expectAccessDenied(page, "/contracts");
  });

  test("a client record shows no Contracts tab without legal access (PRD #18 §10)", async ({
    page,
  }) => {
    // An Architect reads clients and holds no Legal access at all.
    await signIn(page, "ARCHITECT");
    await page.goto("/clients/client_acme");
    await expect(page.getByRole("link", { name: "Contracts", exact: true })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §8 Legal alias                                                              */
/* -------------------------------------------------------------------------- */

test("the /legal alias resolves to the contracts module (PRD #18 §8)", async ({ page }) => {
  await signIn(page, "LEGAL");
  await page.goto("/legal");
  await expect(page).toHaveURL(/\/contracts$/);
  await expect(page.getByRole("heading", { name: "Legal", level: 1 })).toBeVisible();
});

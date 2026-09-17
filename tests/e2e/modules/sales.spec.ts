import { expect, test } from "@playwright/test";

import { db, removeTestSalesRecords, resetSalesFixtures } from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The Sales journey (PRD #17 §348–§357).
 *
 * Walks the module as the roles the commercial rules are written for: the sales
 * desk that runs the pipeline, the CEO who approves a price without working the
 * leads, the project manager who receives a won deal, Finance reading value
 * without the pipeline, and the roles that get no Sales at all.
 */
const PREFIX = "E2E-Sales";

test.afterAll(async () => {
  await removeTestSalesRecords(PREFIX);
  await resetSalesFixtures();
  await db.$disconnect();
});

/** A number nothing else in the demo uses, so a rerun never clashes. */
function proposalNumber() {
  return `${PREFIX}-${Date.now().toString().slice(-8)}`;
}

test.describe("Sales role (PRD #17 §349)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "SALES");
  });

  test("opens the module and sees the company pipeline", async ({ page }) => {
    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible();
    await expect(mainRegion(page).getByText("Open pipeline").first()).toBeVisible();

    await page.goto("/sales/opportunities");
    await expect(recordTable(page).getByText("Riverside phase 2")).toBeVisible();
  });

  test("walks a lead from capture to a qualified opportunity", async ({ page }) => {
    const name = `${PREFIX} Prospect`;

    await page.goto("/sales/leads/new");
    await page.locator("#name").fill(name);
    await page.locator("#companyName").fill(`${PREFIX} Holdings`);
    await page.locator("#email").fill("e2e.sales@example.test");
    await page.locator("#estimatedValue").fill("180000");
    await page.getByRole("button", { name: "Create lead" }).click();

    await page.waitForURL(/\/sales\/leads\/[^/]+$/);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

    // NEW → CONTACTED → QUALIFIED (PRD #17 §48, §49).
    await page.getByRole("button", { name: "Mark contacted" }).click();
    await expect(mainRegion(page).getByText("Contacted").first()).toBeVisible();

    await page.getByRole("button", { name: "Qualify", exact: true }).click();
    await expect(mainRegion(page).getByText("Qualified", { exact: true }).first()).toBeVisible();

    // Convert, creating the canonical client through the Clients service.
    await page.getByRole("link", { name: "Convert" }).click();
    await page.waitForURL(/\/convert$/);

    await page.locator("#opportunityName").fill(`${PREFIX} Opportunity`);
    await page.locator("#clientMode").selectOption("NEW");
    await page.locator("#newClientName").fill(`${PREFIX} Client`);
    await page.getByRole("button", { name: "Convert to opportunity" }).click();

    await page.waitForURL(/\/sales\/opportunities\/[^/]+$/);
    await expect(page.getByRole("heading", { name: `${PREFIX} Opportunity`, level: 1 })).toBeVisible();
    await expect(mainRegion(page).getByText(`${PREFIX} Client`).first()).toBeVisible();

    // The client is the canonical one, reachable in the Clients module
    // (PRD #17 §319).
    await page.goto(`/clients/all?search=${encodeURIComponent(PREFIX)}`);
    await expect(recordTable(page).getByText(`${PREFIX} Client`)).toBeVisible();
  });

  test("cannot close a deal by moving a stage (PRD #17 §82)", async ({ page }) => {
    await page.goto("/sales/pipeline");

    const card = mainRegion(page).getByRole("article").filter({
      hasText: "Riverside phase 2",
    });
    const options = await card.getByLabel(/Move Riverside phase 2/).locator("option").allInnerTexts();

    expect(options).not.toContain("Won");
    expect(options).not.toContain("Lost");
  });

  test("raises a proposal, submits it, and cannot approve its own price", async ({ page }) => {
    const number = proposalNumber();

    await page.goto("/sales/proposals/new");
    await page.locator("#proposalNumber").fill(number);
    await page.locator("#title").fill(`${PREFIX} offer`);
    await page.locator("#opportunityId").selectOption({ index: 1 });
    await page.locator("#line-0-description").fill("Main works");
    await page.locator("#line-0-unitPrice").fill("100000");
    await page.getByRole("button", { name: "Create proposal" }).click();

    await page.waitForURL(/\/sales\/proposals\/[^/]+$/);
    // Server-calculated: 100,000 at 20% is 120,000 (PRD #17 §111, §224).
    await expect(mainRegion(page).getByText("€120,000.00").first()).toBeVisible();

    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();

    // The desk that quotes the price never signs it off (PRD #17 §19).
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("marks a deal won and hands it to a project", async ({ page }) => {
    await page.goto("/sales/opportunities/new");
    await page.locator("#name").fill(`${PREFIX} Won deal`);
    await page.locator("#ownerMemberId").selectOption({ index: 1 });
    await page.locator("#clientId").selectOption("client_acme");
    await page.locator("#estimatedValue").fill("500000");
    await page.getByRole("button", { name: "Create opportunity" }).click();

    await page.waitForURL(/\/sales\/opportunities\/[^/]+$/);
    await page.getByRole("link", { name: "Mark won" }).click();
    await page.waitForURL(/\/won$/);

    await page.locator("#finalValue").fill("520000");

    // The sales desk holds Projects at VIEW, so creating one is not offered —
    // the shell never advertises what the server would refuse (PRD #17 §396).
    const projectModes = await page.locator("#projectMode").locator("option").allInnerTexts();
    expect(projectModes).not.toContain("Create a new project");

    await page.locator("#projectMode").selectOption("EXISTING");
    await page.locator("#projectId").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Mark won" }).click();

    await page.waitForURL(/\/sales\/opportunities\/[^/]+$/);
    await expect(mainRegion(page).getByText("Won", { exact: true }).first()).toBeVisible();

    // A won deal is historical: no edit, no archive (PRD #17 §97, §233).
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
  });

  test("sales tasks are the canonical tasks (PRD #17 §333)", async ({ page }) => {
    await page.goto("/sales/tasks");
    await expect(recordTable(page).getByText("Agree retention terms with ACME")).toBeVisible();

    // The same task, with the same id, in the Tasks module.
    await page.goto("/tasks/all?search=Agree%20retention");
    await expect(recordTable(page).getByText("Agree retention terms with ACME")).toBeVisible();
  });
});

/**
 * The same desk in Nova, where the converted lead, the late-stage deal and the
 * lost deals are (E-06 §45).
 */
test.describe("Sales role in Nova (PRD #17 §349)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "SALES_E");
  });

  test("a converted lead is read-only (PRD #17 §234)", async ({ page }) => {
    await page.goto("/sales/leads/lead_020");
    await expect(mainRegion(page).getByText("Converted").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("moves an opportunity along the pipeline from the board", async ({ page }) => {
    await page.goto("/sales/pipeline");
    await expect(mainRegion(page).getByText("Open pipeline").first()).toBeVisible();

    // The non-drag alternative every keyboard user needs (PRD #17 §297).
    const card = mainRegion(page).getByRole("article").filter({
      hasText: "Urban Core annex",
    });
    await card.getByLabel(/Move Urban Core annex/).selectOption("PROPOSAL");

    await expect(page.getByText("Stage updated.").first()).toBeVisible();
  });

  test("must give a reason to lose a deal (PRD #17 §93)", async ({ page }) => {
    await page.goto("/sales/opportunities/opportunity_022/lost");

    await page.locator("#lostReason").selectOption("OTHER");
    await page.getByRole("button", { name: "Mark lost" }).click();

    // OTHER without a note is refused by the server (PRD #17 §95).
    await expect(mainRegion(page).getByText(/review the highlighted fields/i)).toBeVisible();

    await page.locator("#lostNote").fill("Procurement was cancelled.");
    await page.getByRole("button", { name: "Mark lost" }).click();

    await page.waitForURL(/\/sales\/opportunities\/opportunity_022$/);
    await expect(mainRegion(page).getByText("Lost — Other")).toBeVisible();
  });

  // Nova has lost deals to give reasons for; Aurelia has none yet.
  test("runs the reports its permissions reach", async ({ page }) => {
    await page.goto("/sales/reports");
    await expect(mainRegion(page).getByRole("heading", { name: "Pipeline by stage" })).toBeVisible();

    await page.getByRole("link", { name: "Lead conversion" }).click();
    await expect(mainRegion(page).getByText("Converted ÷ created", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Lost reasons" }).click();
    await expect(mainRegion(page).getByRole("heading", { name: "Lost reasons" })).toBeVisible();
  });
});

test.describe("CEO (PRD #17 §351)", () => {
  test("approves a proposal without working the pipeline", async ({ page }) => {
    await signIn(page, "CEO");
    await page.goto("/sales/proposals/proposal_004");
    await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();

    await mainRegion(page).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Proposal approved.").first()).toBeVisible();
  });

  test("must say why when rejecting (PRD #17 §118, §419)", async ({ page }) => {
    // The proposal is Meridian's, so Meridian's CEO decides it.
    await signIn(page, "CEO_B");
    await page.goto("/sales/proposals/proposal_005");
    await mainRegion(page).getByRole("button", { name: "Reject", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(dialog.getByText(/say why it was rejected/i)).toBeVisible();

    await dialog.locator("#reject-reason").fill("Reprice against the client's stated budget.");
    await dialog.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByText("Proposal rejected.").first()).toBeVisible();
  });

  test("is not offered the sales desk's operational controls", async ({ page }) => {
    await signIn(page, "CEO");
    await page.goto("/sales/opportunities/opportunity_001");
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // No Leads tab at all: the CEO holds `sales.lead.view` but not the create
    // or edit grants, so the list is read-only rather than absent.
    await page.goto("/sales/leads");
    await expect(page.getByRole("link", { name: "New lead" })).toHaveCount(0);
  });

  test("sees the pipeline grouped by currency, never summed (PRD #17 §31)", async ({ page }) => {
    // Terra quotes its US distribution hub in dollars beside its euro deals.
    await signIn(page, "CEO_C");
    await page.goto("/sales/pipeline");

    const total = mainRegion(page).getByText(/€.*·.*\$|\$.*·.*€/).first();
    await expect(total).toBeVisible();
  });
});

test.describe("restricted roles (PRD #17 §352–§356)", () => {
  test("Finance reads commercial value but not the leads", async ({ page }) => {
    await signIn(page, "FINANCE");

    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible();

    const tabs = page.getByRole("navigation", { name: /sections/i });
    await expect(tabs.getByRole("link", { name: "Opportunities" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Leads" })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "Pipeline" })).toHaveCount(0);

    await expectAccessDenied(page, "/sales/leads");
  });

  test("a project manager receives the won deal, not the pipeline", async ({ page }) => {
    // Central Office Tower was won by Meridian's sales desk and is run by
    // Meridian's project manager (E-06 §45).
    await signIn(page, "PM_B");

    await page.goto("/sales/opportunities");
    await expect(recordTable(page).getByText("Central Office Tower fit-out")).toBeVisible();
    // Somebody else's open pipeline stays invisible (PRD #17 §354).
    await expect(recordTable(page).getByText("Beta head office refurb")).toHaveCount(0);

    // And an out-of-scope deal is not found, never forbidden (PRD #17 §226).
    await page.goto("/sales/opportunities/opportunity_002");
    await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();
    await expect(page).not.toHaveURL(/\/access-denied/);
  });

  test("the project carries a link back to the deal it came from (PRD #17 §267)", async ({ page }) => {
    await signIn(page, "PM_B");

    await page.goto("/projects/project_b");
    await expect(mainRegion(page).getByText("From opportunity")).toBeVisible();
    await expect(
      mainRegion(page).getByRole("link", { name: "Central Office Tower fit-out" }),
    ).toBeVisible();
  });

  for (const role of ["GROUP_IT", "ENGINEER"] as const) {
    test(`${role} gets no Sales at all`, async ({ page }) => {
      await signIn(page, role);
      await expectAccessDenied(page, "/sales");
      await expectAccessDenied(page, "/sales/leads");
    });
  }

  test("an Architect cannot reach a proposal document through Documents", async ({ page }) => {
    await signIn(page, "ARCHITECT");

    await page.goto("/documents/all?search=Commercial%20Proposal");
    await expect(mainRegion(page).getByText("Commercial Proposal.pdf")).toHaveCount(0);
  });
});

test.describe("client and cross-module integration (PRD #17 §266, §334)", () => {
  test("a client's Sales tab shows its commercial history", async ({ page }) => {
    await signIn(page, "SALES");

    await page.goto("/clients/client_acme");
    await page
      .getByRole("navigation", { name: "Client sections" })
      .getByRole("link", { name: "Sales", exact: true })
      .click();

    await page.waitForURL(/\/clients\/client_acme\/sales$/);
    await expect(mainRegion(page).getByText("Open pipeline")).toBeVisible();
    await expect(recordTable(page).getByText("Riverside phase 2").first()).toBeVisible();
  });

  test("the client Sales tab is absent without Sales access", async ({ page }) => {
    await signIn(page, "ARCHITECT");

    await page.goto("/clients/client_acme");
    const tabs = page.getByRole("navigation", { name: "Client sections" });
    await expect(tabs.getByRole("link", { name: "Sales", exact: true })).toHaveCount(0);
  });

  test("a project manager's client Sales tab shows only their own deals", async ({ page }) => {
    await signIn(page, "PM_B");

    // The PM holds Sales at PROJECT scope, so the tab is there — and it shows
    // the won deal behind their project, not Beta's open pipeline
    // (PRD #17 §414).
    await page.goto("/clients/client_beta/sales");
    await expect(recordTable(page).getByText("Central Office Tower fit-out")).toBeVisible();

    // The same client's open pipeline stays invisible: the PM reaches the deals
    // that became their projects, not the ones still being fought for.
    await expect(recordTable(page).getByText("Beta head office refurb")).toHaveCount(0);
    await expect(mainRegion(page).getByRole("heading", { name: "In play" })).toHaveCount(0);
  });

  test("a proposal document appears in Documents with the same id", async ({ page }) => {
    await signIn(page, "SALES");

    await page.goto("/sales/proposals/proposal_001/documents");
    await expect(mainRegion(page).getByText("Commercial Proposal.pdf").first()).toBeVisible();

    await page.goto("/documents/all?search=Commercial%20Proposal");
    await expect(recordTable(page).getByText("Commercial Proposal.pdf")).toBeVisible();
  });
});

test("a filtered list that matches nothing offers to clear the filters (PRD #17 §291)", async ({
  page,
}) => {
  await signIn(page, "SALES");

  await page.goto("/sales/opportunities?search=nothingmatchesthisatall");
  await expect(mainRegion(page).getByText("No Sales records match these filters.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
});

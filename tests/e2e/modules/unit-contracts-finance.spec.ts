import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { createSpareProject, removeSpareProject } from "../structure-fixtures";
import { mainRegion, signIn, signOut } from "../fixtures";

/**
 * A unit's contract and collection, desktop (E-05F §12, §39, §45-§50, §104,
 * §122-§130): Sales asks Legal for the contract of a reserved unit; Legal drafts
 * it from its queue with the parking on the same deal and sends it for review;
 * with the contract signed, Finance puts a schedule in force and records a
 * payment across it, and the unit shows what is paid, outstanding and overdue;
 * the project's Finance units count the contract once; Sales cannot mark the unit
 * Sold before the signature the company's rule asks for; an Architect sees
 * neither the contract nor the money.
 *
 * Built on a building of its own on a spare Aurelia project, with units reserved
 * directly in the database for a deal of its own, and removed again afterwards
 * with every contract, schedule, payment and trail the run created.
 */

const COMPANY = "company_demo_a";
/** A bare Aurelia project of the spec's own (see createSpareProject). */
const PROJECT = "project_e2e_harbour_05f";
const BUILDING = "bld_e05f_e2e";
const FLOOR = "flr_e05f_e2e_1";
const HOME = "unit_e05f_e2e_101";
const PARKING = "unit_e05f_e2e_p01";
const UNITS = [HOME, PARKING];
const DEAL = "opportunity_e05f_e2e";
const NUMBER = "CTR-E2E-05F-1";

test.describe.configure({ mode: "serial" });

async function clear() {
  const contracts = (await db.contractUnit.findMany({ where: { unitId: { in: UNITS } }, select: { contractId: true } })).map((row) => row.contractId);
  const payments = (await db.payment.findMany({ where: { contractId: { in: contracts } }, select: { id: true } })).map((row) => row.id);
  const invoices = (await db.invoice.findMany({ where: { contractId: { in: contracts } }, select: { id: true } })).map((row) => row.id);
  await db.paymentAllocation.deleteMany({ where: { OR: [{ contractId: { in: contracts } }, { paymentId: { in: payments } }] } });
  await db.payment.deleteMany({ where: { id: { in: payments } } });
  await db.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
  await db.invoice.deleteMany({ where: { id: { in: invoices } } });
  await db.paymentInstallment.deleteMany({ where: { contractId: { in: contracts } } });
  await db.paymentSchedule.deleteMany({ where: { contractId: { in: contracts } } });
  await db.unitContractRequest.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.contractUnit.deleteMany({ where: { contractId: { in: contracts } } });
  await db.contractApproval.deleteMany({ where: { recordId: { in: contracts } } });
  await db.contract.deleteMany({ where: { id: { in: contracts } } });
  await db.unitSaleApproval.deleteMany({ where: { recordId: { in: UNITS } } });
  await db.unitReservation.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.opportunityUnit.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: UNITS } } });
  await db.unitCommercialProfile.deleteMany({ where: { unitId: { in: UNITS } } });
  const trail = [...UNITS, ...contracts, ...payments, ...invoices, BUILDING, FLOOR, DEAL];
  await db.notification.deleteMany({ where: { entityId: { in: trail } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await db.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
  await db.activity.deleteMany({ where: { entityId: { in: trail } } });
  await db.auditEvent.deleteMany({ where: { entityId: { in: trail } } });
  await db.opportunity.deleteMany({ where: { id: DEAL } });
  await db.projectUnit.deleteMany({ where: { id: { in: UNITS } } });
  await db.projectFloor.deleteMany({ where: { id: FLOOR } });
  await db.projectBuilding.deleteMany({ where: { id: BUILDING } });
}

let soldRule: "RESERVATION" | "SIGNED_CONTRACT" | "DEPOSIT_RECEIVED" | "SIGNED_CONTRACT_AND_DEPOSIT" | "MANUAL_APPROVAL" = "SIGNED_CONTRACT";

test.beforeAll(async () => {
  await createSpareProject(PROJECT, "A-E2E-05F", "Harbour Residences 05F");
  soldRule = (await db.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY }, select: { unitSoldRule: true } })).unitSoldRule;
  await db.companySettings.update({ where: { companyId: COMPANY }, data: { unitSoldRule: "SIGNED_CONTRACT" } });
  await clear();
  const types = new Map((await db.projectUnitType.findMany({ where: { companyId: COMPANY, code: { in: ["APARTMENT", "PARKING"] } }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));
  await db.projectBuilding.create({ data: { id: BUILDING, companyId: COMPANY, projectId: PROJECT, name: "E05F Harbour", nameKey: "E05F HARBOUR", sortOrder: 97, createdBy: "seed" } });
  await db.projectFloor.create({ data: { id: FLOOR, companyId: COMPANY, projectId: PROJECT, buildingId: BUILDING, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "seed" } });
  await db.projectUnit.createMany({
    data: [
      { id: HOME, companyId: COMPANY, projectId: PROJECT, floorId: FLOOR, unitCode: "H-101", unitCodeKey: "H-101", unitTypeId: types.get("APARTMENT")!, sortOrder: 1, createdBy: "seed", saleableArea: "110.00", publicationStatus: "PUBLISHED" },
      { id: PARKING, companyId: COMPANY, projectId: PROJECT, floorId: FLOOR, unitCode: "H-P01", unitCodeKey: "H-P01", unitTypeId: types.get("PARKING") ?? types.get("APARTMENT")!, sortOrder: 2, createdBy: "seed", publicationStatus: "PUBLISHED" },
    ],
  });
  await db.opportunity.create({ data: { id: DEAL, companyId: COMPANY, name: "E05F harbour apartment", clientId: "client_acme", ownerMemberId: "member_sales", stage: "NEGOTIATION", estimatedValue: "300000", currency: "EUR", createdByMemberId: "member_sales" } });
  for (const [unitId, price] of [[HOME, "280000.00"], [PARKING, "20000.00"]] as const) {
    await db.unitCommercialProfile.create({ data: { companyId: COMPANY, projectId: PROJECT, unitId, status: "RESERVED", askingPrice: price, currency: "EUR", statusChangedAt: new Date() } });
    await db.unitReservation.create({ data: { companyId: COMPANY, projectId: PROJECT, unitId, clientId: "client_acme", opportunityId: DEAL, reservedAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() + 10 * 86_400_000), agreedPrice: price, currency: "EUR", createdByMemberId: "member_sales" } });
    await db.opportunityUnit.create({ data: { companyId: COMPANY, projectId: PROJECT, opportunityId: DEAL, unitId, agreedPrice: price, currency: "EUR", createdByMemberId: "member_sales" } });
  }
});

test.afterAll(async () => {
  await db.companySettings.update({ where: { companyId: COMPANY }, data: { unitSoldRule: soldRule } });
  await clear();
  await removeSpareProject(PROJECT);
  await db.$disconnect();
});

const unitUrl = (unitId: string, section: string) => `/projects/${PROJECT}/units/${unitId}/${section}`;
const day = (offset: number) => {
  const date = new Date(Date.now() + offset * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const contractStatus = (page: Page) => mainRegion(page).getByTestId("unit-contract").getByTestId("contract-status");

test("Sales asks for the contract, and Legal drafts it from its queue with the parking and sends it for review", async ({ page }) => {
  await signIn(page, "SALES", { to: unitUrl(HOME, "legal") });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("H-101");
  await mainRegion(page).getByTestId("unit-legal-actions").getByRole("button", { name: "Request contract" }).click();
  const request = page.getByTestId("request-contract-dialog");
  await request.getByLabel("Notes for Legal").fill("Buyer takes the parking space too.");
  await request.getByRole("button", { name: "Request contract" }).click();
  await expect(mainRegion(page).getByTestId("contract-request")).toContainText("asked Legal for this unit's contract");
  await expect(mainRegion(page).getByTestId("contract-request-history")).toContainText("Waiting for Legal");

  // Sales cannot sell before the signature the company's rule asks for (§42, §122).
  await page.goto(unitUrl(HOME, "sales"));
  await expect(mainRegion(page).getByTestId("sale-conditions")).toContainText("Signed contract");
  await mainRegion(page).getByTestId("unit-sales-actions").getByRole("button", { name: "Mark Sold" }).click();
  await expect(page.getByTestId("not-sellable-dialog")).toContainText("A signed contract");
  await page.getByTestId("not-sellable-dialog").getByRole("button", { name: "Close", exact: true }).first().click();

  await signOut(page);
  await signIn(page, "LEGAL", { to: "/contracts/requests" });
  const row = mainRegion(page).getByTestId("contract-request-row").and(page.locator('[data-unit-code="H-101"]'));
  await expect(row).toContainText("ACME Developments");
  await expect(row).toContainText("Buyer takes the parking space too.");
  await row.getByRole("link", { name: "Draft contract" }).click();
  const create = page.getByTestId("create-contract-dialog");
  await expect(create).toBeVisible();
  await create.getByLabel("Contract number").fill(NUMBER);
  await create.getByLabel("H-P01").check();
  await expect(create.getByTestId("contract-total")).toHaveText("Contract value €300,000.00");
  await create.getByRole("button", { name: "Draft contract" }).click();

  await expect(contractStatus(page)).toHaveText("Draft");
  await expect(mainRegion(page).getByTestId("contract-number")).toHaveText(NUMBER);
  await expect(mainRegion(page).getByTestId("contract-value")).toHaveText("€300,000.00");
  await expect(mainRegion(page).getByTestId("contract-units")).toContainText("H-P01");
  await mainRegion(page).getByTestId("unit-contract-actions").getByRole("button", { name: "Send for review" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send for review" }).click();
  await expect(contractStatus(page)).toHaveText("Under review");

  // The parking's page shows the same contract (§88).
  await page.goto(unitUrl(PARKING, "legal"));
  await expect(mainRegion(page).getByTestId("contract-number")).toHaveText(NUMBER);
});

test("Finance puts a schedule in force on the signed contract, records a payment and sees the unit overdue", async ({ page }) => {
  // Signed through Legal's workflow, which its own suite walks (tests/e2e/modules/contracts).
  await db.contract.updateMany({ where: { contractNumber: NUMBER, companyId: COMPANY }, data: { status: "ACTIVE", signedDate: new Date(), effectiveDate: new Date() } });

  await signIn(page, "FINANCE", { to: unitUrl(HOME, "finance") });
  await expect(mainRegion(page).getByTestId("unit-finance-summary").getByTestId("financial-status")).toHaveText("Payment pending");
  await expect(mainRegion(page).getByTestId("finance-contract-value")).toHaveText("€300,000.00");

  await page.getByRole("button", { name: "Create schedule" }).click();
  const schedule = page.getByTestId("schedule-dialog");
  const rows = schedule.getByTestId("schedule-row");
  await rows.nth(0).getByLabel("Amount").fill("30000");
  await rows.nth(0).getByLabel("Due").fill(day(-3));
  await rows.nth(1).getByLabel("Amount").fill("270000");
  await rows.nth(1).getByLabel("Due").fill(day(90));
  await expect(schedule.getByTestId("schedule-total")).toContainText("€300,000.00 of €300,000.00 needed");
  await schedule.getByRole("button", { name: "Save as draft" }).click();
  await expect(mainRegion(page).getByTestId("schedule-draft")).toBeVisible();
  await mainRegion(page).getByTestId("schedule-draft").getByRole("button", { name: "Activate" }).click();
  await page.getByTestId("activate-schedule-dialog").getByRole("button", { name: "Activate" }).click();
  // The draft had the same two rows, so wait for it to be gone: until the
  // active schedule is on the page, a payment has nothing to be allocated to.
  await expect(mainRegion(page).getByTestId("schedule-draft")).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("payment-schedule").getByTestId("installment-row")).toHaveCount(2);

  await mainRegion(page).getByTestId("unit-finance-actions").getByRole("button", { name: "Record payment" }).click();
  const payment = page.getByTestId("record-payment-dialog");
  await payment.getByLabel("Amount").fill("10000");
  await payment.getByLabel("Reference").fill("TR-E2E-05F");
  await expect(payment.getByTestId("payment-unallocated")).toHaveText("Unallocated €0.00");
  await payment.getByRole("button", { name: "Record payment" }).click();

  await expect(mainRegion(page).getByTestId("finance-paid")).toHaveText("€10,000.00");
  await expect(mainRegion(page).getByTestId("finance-outstanding")).toHaveText("€290,000.00");
  // The deposit fell due three days ago and is only part paid (§37, §85).
  await expect(mainRegion(page).getByTestId("finance-overdue")).toHaveText("€20,000.00");
  await expect(mainRegion(page).getByTestId("unit-finance-summary").getByTestId("financial-status")).toHaveText("Overdue");
  await expect(mainRegion(page).getByTestId("payment-schedule").getByTestId("installment-row").first().getByTestId("installment-status")).toHaveText("Overdue");
  await expect(mainRegion(page).getByTestId("unit-payments")).toContainText("TR-E2E-05F");
  await expect(mainRegion(page).getByTestId("finance-progress")).toHaveText("3.3%");
});

test("the project's Finance units count the contract once and filter what is overdue", async ({ page }) => {
  await signIn(page, "FINANCE", { to: `/projects/${PROJECT}/finance/units?q=H-` });
  const rows = mainRegion(page).getByTestId("finance-table").getByTestId("finance-row");
  await expect(rows).toHaveCount(2);
  await expect(mainRegion(page).getByTestId("finance-total-contracted")).toHaveText("€300,000.00");
  await expect(mainRegion(page).getByTestId("finance-total-overdue")).toHaveText("€20,000.00");
  await mainRegion(page).getByTestId("finance-quick-filter").and(page.locator('[data-status="OVERDUE"]')).click();
  await expect(rows).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get("financialStatus")).toBe("OVERDUE");
  await page.getByRole("searchbox", { name: "Search units" }).fill("TR-E2E-05F");
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole("link", { name: "H-101" }).click();
  await expect(mainRegion(page).getByTestId("unit-finance-summary")).toBeVisible();
});

test("an Architect sees neither the unit's contract nor its money", async ({ page }) => {
  await signIn(page, "ARCHITECT", { to: `/projects/${PROJECT}/units/${HOME}` });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("H-101");
  const sections = page.getByRole("navigation", { name: "H-101 sections" });
  await expect(sections.getByRole("link", { name: "Legal", exact: true })).toHaveCount(0);
  await expect(sections.getByRole("link", { name: "Finance", exact: true })).toHaveCount(0);
  await expect(mainRegion(page)).not.toContainText("€300,000");
  await page.goto(unitUrl(HOME, "finance"));
  await expect(page).toHaveURL(/\/access-denied/);
  await page.goto(unitUrl(HOME, "legal"));
  await expect(page).toHaveURL(/\/access-denied/);
});

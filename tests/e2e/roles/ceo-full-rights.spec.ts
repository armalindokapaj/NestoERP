import { expect, test, type Locator, type Page } from "@playwright/test";

import { db, removeRecordTrail, removeTestClients, removeTestFinanceRecords, removeTestProcurementRecords } from "../db";
import { DEMO_PASSWORD, mainRegion } from "../fixtures";
import { createSpareProject, removeSpareProject } from "../structure-fixtures";

/**
 * The CEO does everything (2026-11-09, the user's decision): a CEO, and a member
 * given CEO access on top of their own role, raise a client, a deal, an invoice,
 * an expense and a purchase request, and reserve a unit for a new client and
 * deal. Neither decides their own request while somebody else in the company
 * could; a CEO alone in the company decides it, and the record says it was
 * self-approved (lib/core/approvals/self-approval.ts).
 */

test.describe.configure({ mode: "serial" });

const PREFIX = "CEO E2E";
const AURELIA = "company_demo_a";
const PROJECT = "project_e2e_ceo_rights";
const BUILDING = "bld_ceo_e2e";
const FLOOR = "flr_ceo_e2e_1";
/** One unit on sale for each of the two people who reserve. */
const UNITS = { CEO: "unit_ceo_e2e_101", HOLDER: "unit_ceo_e2e_102" } as const;

/** Solo Studio, a tenant of one company: its Owner is suspended while its CEO is the only one who can decide. */
const SOLO = "company_fixture_solo";
const SOLO_OWNER_MEMBER = "member_solo_owner";
const SOLO_CEO = { user: "user_e2e_solo_ceo", person: "person_e2e_solo_ceo", member: "member_e2e_solo_ceo", username: "e2e-solo-ceo" };

const raisedInvoices: string[] = [];
let holderMember = "";

async function clearUnits() {
  const ids = Object.values(UNITS);
  const reservations = await db.unitReservation.findMany({ where: { unitId: { in: ids } }, select: { id: true } });
  await db.unitReservationExtension.deleteMany({ where: { reservationId: { in: reservations.map((row) => row.id) } } });
  await db.unitReservation.deleteMany({ where: { unitId: { in: ids } } });
  await db.opportunityUnit.deleteMany({ where: { unitId: { in: ids } } });
  await db.unitPriceHistory.deleteMany({ where: { unitId: { in: ids } } });
  await db.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: ids } } });
  await db.unitCommercialProfile.deleteMany({ where: { unitId: { in: ids } } });
  await db.activity.deleteMany({ where: { entityId: { in: ids } } });
  await db.unitPublication.deleteMany({ where: { unitId: { in: ids } } });
  await db.projectUnit.deleteMany({ where: { id: { in: ids } } });
  await db.projectFloor.deleteMany({ where: { id: FLOOR } });
  await db.projectBuilding.deleteMany({ where: { id: BUILDING } });
}

async function clearRecords() {
  // Deals, the reservation's included: "<unit> — <client>" carries the prefix inside the name.
  const deals = (await db.opportunity.findMany({ where: { name: { contains: PREFIX } }, select: { id: true } })).map((row) => row.id);
  await db.opportunityUnit.deleteMany({ where: { opportunityId: { in: deals } } });
  await removeRecordTrail("opportunity", deals);
  await db.activity.deleteMany({ where: { entityId: { in: deals } } });
  await db.opportunity.deleteMany({ where: { id: { in: deals } } });

  const invoices = [
    ...raisedInvoices,
    ...(await db.invoice.findMany({ where: { lineItems: { some: { description: { startsWith: PREFIX } } } }, select: { id: true } })).map((row) => row.id),
  ];
  await removeRecordTrail("invoice", invoices);
  await db.auditEvent.deleteMany({ where: { entityId: { in: invoices } } });
  await db.activity.deleteMany({ where: { entityId: { in: invoices } } });
  await db.financeApproval.deleteMany({ where: { recordId: { in: invoices } } });
  await db.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
  await db.invoice.deleteMany({ where: { id: { in: invoices } } });

  const expenses = (await db.expense.findMany({ where: { description: { startsWith: PREFIX } }, select: { id: true } })).map((row) => row.id);
  await removeRecordTrail("expense", expenses);
  await removeTestFinanceRecords(PREFIX);
  await removeTestProcurementRecords(PREFIX);
  await removeTestClients(PREFIX);
}

/** Solo Studio's Owner back at work. */
async function restoreSoloOwner() {
  await db.companyMember.update({ where: { id: SOLO_OWNER_MEMBER }, data: { status: "ACTIVE" } });
}

/** The CEO the spec added to Solo Studio, once their records are gone (clearRecords). */
async function removeSoloCeo() {
  await db.activity.deleteMany({ where: { actorMemberId: SOLO_CEO.member } });
  await db.session.deleteMany({ where: { userId: SOLO_CEO.user } });
  await db.authEvent.deleteMany({ where: { userId: SOLO_CEO.user } });
  await db.companyMember.deleteMany({ where: { id: SOLO_CEO.member } });
  await db.user.deleteMany({ where: { id: SOLO_CEO.user } });
  await db.personProfile.deleteMany({ where: { id: SOLO_CEO.person } });
}

test.beforeAll(async () => {
  // Reservations name their deals: the units' trail goes first.
  await clearUnits();
  await clearRecords();
  await removeSoloCeo();
  await restoreSoloOwner();

  // A unit on sale, priced, for each reservation.
  await createSpareProject(PROJECT, "A-E2E-CEO", "CEO Rights Residences");
  const apartment = await db.projectUnitType.findFirstOrThrow({ where: { companyId: AURELIA, code: "APARTMENT" }, select: { id: true } });
  await db.projectBuilding.create({ data: { id: BUILDING, companyId: AURELIA, projectId: PROJECT, name: "CEO Quay", nameKey: "CEO QUAY", sortOrder: 97, createdBy: "seed" } });
  await db.projectFloor.create({ data: { id: FLOOR, companyId: AURELIA, projectId: PROJECT, buildingId: BUILDING, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "seed" } });
  const unit = (id: string, code: string, sortOrder: number) => ({ id, companyId: AURELIA, projectId: PROJECT, floorId: FLOOR, unitCode: code, unitCodeKey: code, unitTypeId: apartment.id, sortOrder, createdBy: "seed", saleableArea: "100.00", internalArea: "90.00", grossArea: "100.00", bedrooms: 2, bathrooms: 1, publicationStatus: "PUBLISHED" as const });
  await db.projectUnit.createMany({ data: [unit(UNITS.CEO, "C-101", 1), unit(UNITS.HOLDER, "C-102", 2)] });
  for (const unitId of Object.values(UNITS)) {
    await db.unitCommercialProfile.create({ data: { companyId: AURELIA, projectId: PROJECT, unitId, status: "FOR_SALE", askingPrice: "150000.00", currency: "EUR", statusChangedAt: new Date() } });
  }

  // An Architect of Aurelia holds CEO access on top of their own role.
  const architect = await db.user.findFirstOrThrow({ where: { username: "architect-a" }, select: { id: true } });
  const membership = await db.companyMember.findFirstOrThrow({ where: { companyId: AURELIA, userId: architect.id }, select: { id: true } });
  holderMember = membership.id;
  await db.companyMember.update({ where: { id: holderMember }, data: { ceoAccess: true, ceoAccessGrantedAt: new Date(), accessVersion: { increment: 1 } } });
});

test.afterAll(async () => {
  // The people first, so a failed clean-up never leaves an Architect with CEO access or Solo Studio without its Owner.
  if (holderMember) await db.companyMember.update({ where: { id: holderMember }, data: { ceoAccess: false, ceoAccessGrantedAt: null, ceoAccessGrantedByMemberId: null, accessVersion: { increment: 1 } } });
  await restoreSoloOwner();
  await clearUnits();
  await clearRecords();
  await removeSoloCeo();
  await removeSpareProject(PROJECT);
  await db.$disconnect();
});

/** Picks an option from a native select or from a Nesto dropdown (a combobox with a listbox), whichever the form draws. */
async function choose(page: Page, field: Locator, option: { label?: string | RegExp; index?: number }) {
  if ((await field.evaluate((element) => element.tagName)) === "SELECT") {
    if (option.label !== undefined && typeof option.label === "string") await field.selectOption({ label: option.label });
    else await field.selectOption({ index: option.index ?? 1 });
    return;
  }
  await field.click();
  const options = page.getByRole("listbox").last().getByRole("option");
  if (option.label !== undefined) await options.filter({ hasText: option.label }).first().click();
  else await options.nth(option.index ?? 0).click();
}

async function signInAs(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createClient(page: Page, name: string) {
  await page.goto("/clients/new");
  const main = mainRegion(page);
  await main.getByLabel("Client name").fill(name);
  await main.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/(?!new$)[^/]+$/);
  expect(await db.client.count({ where: { name } })).toBe(1);
}

async function createDeal(page: Page, name: string) {
  await page.goto("/sales/opportunities/new");
  await page.locator("#name").fill(name);
  await choose(page, page.locator("#ownerMemberId"), { index: 1 });
  // The client is a searchable relation sheet, not a native dropdown (MOB-04 §31).
  await page.locator("#clientId").click();
  await page.getByRole("dialog").getByRole("option", { name: /Acme/i }).locator("button").click();
  await page.locator("#estimatedValue").fill("250000");
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await page.waitForURL(/\/sales\/opportunities\/(?!new$)[^/]+$/);
  expect(await db.opportunity.count({ where: { name } })).toBe(1);
}

/** Raises an invoice for `client` and submits it; returns its id. */
async function raiseAndSubmitInvoice(page: Page, client: string, line: string): Promise<string> {
  await page.goto("/finance/invoices/new");
  // A company without automatic numbering (Solo Studio) asks for the number.
  const number = page.locator("#invoiceNumber");
  if (await number.isVisible()) await number.fill(`${PREFIX.replace(/\s+/g, "-")}-${Date.now().toString(36)}`);
  await choose(page, page.locator("#clientId"), { label: client });
  await page.locator('input[name="lineItems.0.description"]').fill(line);
  await page.locator('input[name="lineItems.0.quantity"]').fill("1");
  await page.locator('input[name="lineItems.0.unitPrice"]').fill("1200");
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.waitForURL(/\/finance\/invoices\/(?!new$)[^/]+$/);
  const invoiceId = page.url().split("/").pop()!;
  raisedInvoices.push(invoiceId);
  await mainRegion(page).getByRole("button", { name: "Submit for approval" }).click();
  await expect.poll(async () => (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } })).status).toBe("PENDING_APPROVAL");
  return invoiceId;
}

async function createExpense(page: Page, description: string) {
  await page.goto("/finance/expenses/new");
  const main = mainRegion(page);
  await main.getByLabel("Description").fill(description);
  await choose(page, page.locator("#category"), { label: "Materials" });
  await choose(page, page.locator("#projectId"), { index: 1 });
  await page.locator("#netAmount").fill("480");
  await page.locator("#taxAmount").fill("96");
  await main.getByRole("button", { name: "Create expense" }).click();
  await page.waitForURL(/\/finance\/expenses\/(?!new$)[^/]+$/);
  expect(await db.expense.count({ where: { description } })).toBe(1);
}

async function createPurchaseRequest(page: Page, title: string) {
  await page.goto("/procurement/requests/new");
  await page.locator("#title").fill(title);
  await page.locator('input[name="items.0.description"]').fill(`${title} — gloves`);
  await page.locator('input[name="items.0.quantity"]').fill("10");
  await page.locator('input[name="items.0.unit"]').fill("pair");
  await page.locator('input[name="items.0.estimatedUnitPrice"]').fill("12.50");
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/procurement\/requests\/(?!new)[^/]+$/);
  expect(await db.purchaseRequest.count({ where: { title } })).toBe(1);
}

/** Reserves the unit for a client and deal that do not exist yet, created in the Reserve dialog. */
async function reserveForNewClient(page: Page, unitId: string, client: string) {
  await page.goto(`/projects/${PROJECT}/units/${unitId}/sales`);
  const status = mainRegion(page).getByTestId("unit-sales-summary").getByTestId("commercial-status");
  await expect(status).toHaveText("For Sale");
  await page.getByTestId("unit-sales-actions").getByRole("button", { name: "Reserve" }).click();
  const reserve = page.getByTestId("reserve-dialog");
  await reserve.getByRole("button", { name: "New client" }).click();
  await reserve.getByLabel("Client name").fill(client);
  await reserve.getByLabel("Agreed price").fill("148000");
  await reserve.getByRole("button", { name: "Reserve", exact: true }).click();
  await expect(status).toHaveText("Reserved");
  await expect(page.getByTestId("reservation-client")).toHaveText(client);
  expect(await db.opportunity.count({ where: { name: { contains: client } } })).toBe(1);
}

/** Their own invoice, while somebody else in the company could decide it: no Approve, and the server refuses it. */
async function expectOwnApprovalRefused(page: Page, invoiceId: string) {
  await page.goto(`/finance/invoices/${invoiceId}`);
  await expect(mainRegion(page).getByText("Pending approval").first()).toBeVisible();
  await expect(mainRegion(page).getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  // The cycle the request decides, as the page names it (AUD-10 §4).
  const approval = await db.financeApproval.findFirstOrThrow({ where: { recordId: invoiceId, status: "PENDING" }, select: { id: true } });
  const response = await page.request.post(`/api/finance/invoices/${invoiceId}/approve`, { data: { approvalId: approval.id } });
  expect(response.status()).toBe(403);
  expect(await response.text()).toContain("somebody else has to decide it");
  expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } })).status).toBe("PENDING_APPROVAL");
}

for (const who of [
  { label: "the CEO", username: "ceo-a", unit: UNITS.CEO, tag: "CEO" },
  { label: "an Architect with CEO access", username: "architect-a", unit: UNITS.HOLDER, tag: "Holder" },
] as const) {
  test(`${who.label} raises a client, a deal, an invoice, an expense and a purchase request, and reserves a unit for a new client and deal`, async ({ page }) => {
    test.setTimeout(240_000);
    await signInAs(page, who.username);
    await createClient(page, `${PREFIX} ${who.tag} client`);
    await createDeal(page, `${PREFIX} ${who.tag} deal`);
    const invoiceId = await raiseAndSubmitInvoice(page, "ACME Developments", `${PREFIX} ${who.tag} valuation`);
    await createExpense(page, `${PREFIX} ${who.tag} fuel`);
    await createPurchaseRequest(page, `${PREFIX} ${who.tag} consumables`);
    await reserveForNewClient(page, who.unit, `${PREFIX} ${who.tag} buyer`);
    await expectOwnApprovalRefused(page, invoiceId);
  });
}

test("a CEO alone in a one-company tenant approves their own invoice, and the record says it was self-approved", async ({ page }) => {
  test.setTimeout(180_000);
  // The CEO joins Solo Studio, and its Owner is suspended: nobody else there could decide the invoice.
  const template = await db.user.findFirstOrThrow({ where: { username: "solo-owner" }, select: { passwordHash: true } });
  const ceoRole = await db.role.findUniqueOrThrow({ where: { key: "CEO" }, select: { id: true } });
  await db.personProfile.create({ data: { id: SOLO_CEO.person, parentGroupId: "group_fixture_solo", firstName: "Solo", lastName: "Chief", workEmail: "e2e-solo-ceo@nesto.test", lifecycleStatus: "EMPLOYEE", createdByUserId: "user_solo_owner" } });
  await db.user.create({ data: { id: SOLO_CEO.user, username: SOLO_CEO.username, email: "e2e-solo-ceo@nesto.test", firstName: "Solo", lastName: "Chief", passwordHash: template.passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, status: "ACTIVE", personProfileId: SOLO_CEO.person } });
  await db.companyMember.create({ data: { id: SOLO_CEO.member, companyId: SOLO, userId: SOLO_CEO.user, roleId: ceoRole.id, status: "ACTIVE", joinedAt: new Date() } });
  await db.companyMember.update({ where: { id: SOLO_OWNER_MEMBER }, data: { status: "SUSPENDED" } });

  await signInAs(page, SOLO_CEO.username);
  const client = `${PREFIX} Solo client`;
  await createClient(page, client);
  const invoiceId = await raiseAndSubmitInvoice(page, client, `${PREFIX} Solo valuation`);

  await page.goto(`/finance/invoices/${invoiceId}`);
  await mainRegion(page).getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } })).status).toBe("APPROVED");
  const audit = await db.auditEvent.findFirst({ where: { entityId: invoiceId, actionKey: "APPROVAL_SELF_APPROVED" }, select: { actorMemberId: true } });
  expect(audit?.actorMemberId).toBe(SOLO_CEO.member);
  expect(await db.activity.count({ where: { entityId: invoiceId, action: "APPROVAL_SELF_APPROVED" } })).toBe(1);
});

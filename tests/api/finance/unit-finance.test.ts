import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { getInvoice, markInvoiceSent, submitInvoice, approveInvoice } from "@/lib/modules/finance/invoices/invoice.service";
import { createPaymentSchema } from "@/lib/modules/finance/payments/payment.schema";
import { recordPayment, voidPayment } from "@/lib/modules/finance/payments/payment.service";
import { listFinanceInventory } from "@/lib/modules/finance/units/unit-finance.inventory";
import {
  activateScheduleSchema,
  allocatePaymentSchema,
  createScheduleSchema,
  parseFinanceInventoryQuery,
  recordContractPaymentSchema,
  updateScheduleSchema,
} from "@/lib/modules/finance/units/unit-finance.schema";
import {
  activatePaymentSchedule,
  allocateContractPayment,
  createPaymentSchedule,
  getUnitFinance,
  getUnitFinanceSummary,
  issueInstallmentInvoice,
  recordContractPayment,
  reverseContractAllocation,
  updatePaymentSchedule,
} from "@/lib/modules/finance/units/unit-finance.service";
import { approveUnitSale, rejectUnitSale, requestSaleApproval } from "@/lib/modules/sales/units/unit-sale-approval.service";
import { getUnitSales, markUnitSold } from "@/lib/modules/sales/units/unit-sales.service";
import { updateSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { cleanupSessions, prisma } from "../../helpers";
import { COMPANY_A, isoDay, loginRoles, refused, RIVERSIDE, SaleFixture, type Roles } from "./unit-sale-fixture";
import { shownCycle } from "../approvals/aud10-cycles";

/**
 * Collecting a unit's sale against the real database (E-05F §18-§41, §76-§85,
 * §118-§123): schedules and their versions, payments allocated across
 * installments, the ceilings on both, corrections, invoices for installments,
 * the derived financial status, the project inventory, the Sold rule, and who
 * may see and do each.
 */

const T = "E05FF";
let roles: Roles;
let soldRule: string;
let reservationDays: number;
const fixture = new SaleFixture(T, () => roles);

beforeAll(async () => {
  roles = await loginRoles();
  const settings = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: COMPANY_A }, select: { unitSoldRule: true, unitReservationDays: true } });
  soldRule = settings.unitSoldRule;
  reservationDays = settings.unitReservationDays;
  await fixture.cleanup();
});
beforeEach(() => fixture.setUp());
afterEach(() => fixture.cleanup());
afterAll(async () => {
  await prisma.companySettings.update({ where: { companyId: COMPANY_A }, data: { unitSoldRule: soldRule as never, unitReservationDays: reservationDays } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const pay = (contractId: string, input: Record<string, unknown>) => recordContractPayment(roles.finance, contractId, recordContractPaymentSchema.parse({ method: "BANK_TRANSFER", paymentDate: isoDay(0), ...input }));

/** A signed, active contract on a reserved unit with the given schedule. */
async function collecting(installments: Array<{ label: string; type?: string; amount: string; due: number }>, value = "300000.00") {
  const unit = await fixture.reserved(value);
  const { contractId, contractNumber } = await fixture.contract(unit.id);
  await fixture.sign(contractId, { activate: true });
  const schedule = await fixture.schedule(contractId, installments);
  return { unit, contractId, contractNumber, ...schedule };
}

describe("payment schedules (§18-§25, §76, §84, §118, §125)", () => {
  it("drafts, validates the total, activates once signed, and supersedes keeping paid history", async () => {
    const unit = await fixture.reserved("300000.00");
    const { contractId } = await fixture.contract(unit.id);
    const draft = await createPaymentSchedule(roles.finance, contractId, createScheduleSchema.parse({ installments: [{ label: "Deposit", type: "DEPOSIT", amount: "30000", dueDate: isoDay(5) }, { label: "Balance", type: "BALANCE", amount: "260000", dueDate: isoDay(90) }] }));
    await refused(createPaymentSchedule(roles.finance, contractId, createScheduleSchema.parse({ installments: [{ label: "X", amount: "1", dueDate: isoDay(1) }] })), "CONFLICT", "SCHEDULE_DRAFT_EXISTS");
    await refused(activatePaymentSchedule(roles.finance, draft.scheduleId, activateScheduleSchema.parse({})), "CONFLICT", "CONTRACT_NOT_SIGNED");
    await fixture.sign(contractId, { activate: true });

    const mismatch = await refused(activatePaymentSchedule(roles.finance, draft.scheduleId, activateScheduleSchema.parse({})), "VALIDATION_ERROR", "SCHEDULE_TOTAL_MISMATCH");
    expect(mismatch.message).toMatch(/^Payment schedule total does not match the Contract value\./);
    // An exception needs the correction grant and a reason (§24).
    await refused(activatePaymentSchedule(roles.sales, draft.scheduleId, activateScheduleSchema.parse({ exceptionReason: "x" })), "FORBIDDEN");

    const { version } = await updatePaymentSchedule(roles.finance, draft.scheduleId, updateScheduleSchema.parse({ installments: [{ label: "Deposit", type: "DEPOSIT", amount: "30000", dueDate: isoDay(5) }, { label: "Installment", amount: "120000", dueDate: isoDay(60) }, { label: "Balance", type: "BALANCE", amount: "150000", dueDate: isoDay(120) }], expectedVersion: 1 }));
    await refused(updatePaymentSchedule(roles.finance, draft.scheduleId, updateScheduleSchema.parse({ installments: [{ label: "A", amount: "1", dueDate: isoDay(1) }], expectedVersion: 1 })), "CONFLICT", "SCHEDULE_STALE");
    await activatePaymentSchedule(roles.finance, draft.scheduleId, activateScheduleSchema.parse({ expectedVersion: version }));
    await refused(updatePaymentSchedule(roles.finance, draft.scheduleId, updateScheduleSchema.parse({ installments: [{ label: "A", amount: "1", dueDate: isoDay(1) }] })), "CONFLICT", "SCHEDULE_NOT_DRAFT");

    const deposit = await prisma.paymentInstallment.findFirstOrThrow({ where: { scheduleId: draft.scheduleId, sequence: 1 } });
    await pay(contractId, { amount: "30000", allocations: [{ installmentId: deposit.id, amount: "30000" }] });

    // Version 2 covers what is left: the value less what version 1 collected (§84).
    const revision = await createPaymentSchedule(roles.finance, contractId, createScheduleSchema.parse({ installments: [{ label: "Installment", amount: "100000", dueDate: isoDay(45) }, { label: "Balance", type: "BALANCE", amount: "100000", dueDate: isoDay(100) }] }));
    await refused(activatePaymentSchedule(roles.finance, revision.scheduleId, activateScheduleSchema.parse({})), "VALIDATION_ERROR", "SCHEDULE_TOTAL_MISMATCH");
    await updatePaymentSchedule(roles.finance, revision.scheduleId, updateScheduleSchema.parse({ installments: [{ label: "Installment", amount: "120000", dueDate: isoDay(45) }, { label: "Balance", type: "BALANCE", amount: "150000", dueDate: isoDay(100) }] }));
    const { supersededScheduleId } = await activatePaymentSchedule(roles.finance, revision.scheduleId, activateScheduleSchema.parse({}));
    expect(supersededScheduleId).toBe(draft.scheduleId);

    const view = await getUnitFinance(roles.finance, unit.id);
    expect(view.schedules.map((row) => [row.versionNumber, row.status])).toEqual([[2, "ACTIVE"], [1, "SUPERSEDED"]]);
    expect(view.schedules[1]!.installments.map((row) => [row.label, row.status, row.paidAmount])).toEqual([["Deposit", "PAID", "30000.00"], ["Installment", "CANCELLED", "0.00"], ["Balance", "CANCELLED", "0.00"]]);
    expect(view.summary).toMatchObject({ paidAmount: "30000.00", outstandingAmount: "270000.00", financialStatus: "PARTIALLY_PAID" });
    expect(await prisma.auditEvent.count({ where: { entityId: contractId, actionKey: { in: ["PAYMENT_SCHEDULE_CREATED", "PAYMENT_SCHEDULE_ACTIVATED", "PAYMENT_SCHEDULE_SUPERSEDED"] } } })).toBe(5);
  });
});

describe("payments and allocations (§29-§36, §77-§81, §119, §126)", () => {
  it("allocates across installments, several payments to one, never beyond the payment or the installment", async () => {
    const sale = await collecting([
      { label: "Deposit", type: "DEPOSIT", amount: "50000.00", due: 3 },
      { label: "Installment", amount: "100000.00", due: 40 },
      { label: "Balance", type: "BALANCE", amount: "150000.00", due: 80 },
    ]);
    const [deposit, installment, balance] = sale.installments;

    await refused(pay(sale.contractId, { amount: "10000", allocations: [{ installmentId: deposit!.id, amount: "20000" }] }), "VALIDATION_ERROR", "ALLOCATION_EXCEEDS_PAYMENT");
    await refused(pay(sale.contractId, { amount: "70000", allocations: [{ installmentId: deposit!.id, amount: "60000" }] }), "VALIDATION_ERROR", "ALLOCATION_EXCEEDS_OUTSTANDING");

    // A partial payment (§33), then one transfer across two installments with money left over (§31, §34).
    await pay(sale.contractId, { amount: "20000", reference: "TR-1", allocations: [{ installmentId: deposit!.id, amount: "20000" }] });
    let summary = await getUnitFinanceSummary(roles.finance, sale.unit.id);
    expect(summary).toMatchObject({ paidAmount: "20000.00", outstandingAmount: "280000.00", financialStatus: "PARTIALLY_PAID", nextDue: { label: "Deposit", amount: "30000.00" } });

    const second = await pay(sale.contractId, { amount: "90000", reference: "TR-2", allocations: [{ installmentId: deposit!.id, amount: "30000" }, { installmentId: installment!.id, amount: "50000" }] });
    expect(second.unallocated).toBe("10000.00");
    summary = await getUnitFinanceSummary(roles.finance, sale.unit.id);
    expect(summary).toMatchObject({ paidAmount: "100000.00", unallocatedAmount: "10000.00", progressPercent: "33.3", nextDue: { label: "Installment", amount: "50000.00" } });

    await refused(allocateContractPayment(roles.finance, second.paymentId, allocatePaymentSchema.parse({ allocations: [{ installmentId: installment!.id, amount: "20000" }] })), "VALIDATION_ERROR", "ALLOCATION_EXCEEDS_PAYMENT");
    await allocateContractPayment(roles.finance, second.paymentId, allocatePaymentSchema.parse({ allocations: [{ installmentId: balance!.id, amount: "10000" }] }));
    await refused(allocateContractPayment(roles.finance, second.paymentId, allocatePaymentSchema.parse({ allocations: [{ installmentId: balance!.id, amount: "1" }] })), "CONFLICT", "PAYMENT_FULLY_ALLOCATED");

    // The same money on the same day is offered back before it is recorded twice (§78).
    const duplicate = await refused(pay(sale.contractId, { amount: "20000", reference: "TR-1" }), "CONFLICT", "DUPLICATE_PAYMENT");
    expect((duplicate.details as { matches: unknown[] }).matches).toHaveLength(1);
    await pay(sale.contractId, { amount: "20000", reference: "TR-1", acceptDuplicate: true, allocations: [{ installmentId: installment!.id, amount: "20000" }] });

    const view = await getUnitFinance(roles.finance, sale.unit.id);
    expect(view.schedules[0]!.installments.map((row) => [row.label, row.paidAmount, row.status])).toEqual([
      ["Deposit", "50000.00", "PAID"],
      ["Installment", "70000.00", "PARTIALLY_PAID"],
      ["Balance", "10000.00", "PARTIALLY_PAID"],
    ]);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PAYMENT_ALLOCATED", entityId: second.paymentId } })).toBe(3);
  });

  it("reverses an allocation and voids a payment with the correction grant, recomputing the status", async () => {
    const sale = await collecting([{ label: "Deposit", type: "DEPOSIT", amount: "300000.00", due: 10 }]);
    const [deposit] = sale.installments;
    const full = await pay(sale.contractId, { amount: "300000", allocations: [{ installmentId: deposit!.id, amount: "300000" }] });
    expect((await getUnitFinanceSummary(roles.finance, sale.unit.id)).financialStatus).toBe("FINANCIALLY_COMPLETE");
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: sale.unit.id, eventType: "UNIT_FINANCIALLY_COMPLETE" } })).toBe(1);

    const allocation = await prisma.paymentAllocation.findFirstOrThrow({ where: { paymentId: full.paymentId } });
    await refused(reverseContractAllocation(roles.legal, allocation.id, { reason: "Wrong" }), "FORBIDDEN");
    await reverseContractAllocation(roles.finance, allocation.id, { reason: "Allocated to the wrong installment" });
    expect(await getUnitFinanceSummary(roles.finance, sale.unit.id)).toMatchObject({ paidAmount: "0.00", unallocatedAmount: "300000.00", financialStatus: "PAYMENT_PENDING" });
    expect(await prisma.paymentAllocation.count({ where: { paymentId: full.paymentId } })).toBe(1);

    await voidPayment(roles.finance, full.paymentId, "Bounced transfer");
    expect(await getUnitFinanceSummary(roles.finance, sale.unit.id)).toMatchObject({ paidAmount: "0.00", unallocatedAmount: "0.00", financialStatus: "PAYMENT_PENDING" });
    const statuses = await prisma.auditEvent.findMany({ where: { entityId: sale.contractId, actionKey: "UNIT_FINANCIAL_STATUS_CHANGED" }, orderBy: { occurredAt: "asc" }, select: { afterJson: true } });
    expect(statuses.map((row) => (row.afterJson as { financialStatus: string }).financialStatus)).toEqual(["FINANCIALLY_COMPLETE", "PAYMENT_PENDING"]);

    // Money received again replaces the voided payment, by reference (§81).
    const replacement = await pay(sale.contractId, { amount: "300000", replacesPaymentId: full.paymentId, allocations: [{ installmentId: deposit!.id, amount: "300000" }] });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: replacement.paymentId } })).replacesPaymentId).toBe(full.paymentId);
    await contracts.completeContract(roles.legal, sale.contractId);
    expect((await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: sale.scheduleId } })).status).toBe("COMPLETED");
  });

  it("derives every financial status in the PRD's order (§40, §85, §121)", async () => {
    const unit = await fixture.reserved();
    expect((await getUnitFinanceSummary(roles.finance, unit.id)).financialStatus).toBe("NO_CONTRACT");
    const { contractId } = await fixture.contract(unit.id);
    expect((await getUnitFinanceSummary(roles.finance, unit.id)).financialStatus).toBe("CONTRACT_PENDING");
    await fixture.sign(contractId, { activate: true });
    expect((await getUnitFinanceSummary(roles.finance, unit.id)).financialStatus).toBe("PAYMENT_PENDING");
    const { scheduleId, installments } = await fixture.schedule(contractId, [{ label: "Deposit", type: "DEPOSIT", amount: "100000.00", due: 2 }, { label: "Balance", amount: "200000.00", due: 30 }]);
    await pay(contractId, { amount: "40000", allocations: [{ installmentId: installments[0]!.id, amount: "40000" }] });
    expect((await getUnitFinanceSummary(roles.finance, unit.id)).financialStatus).toBe("PARTIALLY_PAID");

    // The deposit falls past due: overdue is the unpaid part, from its due date (§37).
    await prisma.paymentInstallment.update({ where: { id: installments[0]!.id }, data: { dueDate: new Date(Date.now() - 3 * 86_400_000) } });
    expect(await getUnitFinanceSummary(roles.finance, unit.id)).toMatchObject({ financialStatus: "OVERDUE", overdueAmount: "60000.00" });

    // Paid in full but with money unallocated: paid, not yet complete (§41).
    await pay(contractId, { amount: "270000", allocations: [{ installmentId: installments[0]!.id, amount: "60000" }, { installmentId: installments[1]!.id, amount: "200000" }] });
    expect(await getUnitFinanceSummary(roles.finance, unit.id)).toMatchObject({ financialStatus: "PAID", outstandingAmount: "0.00", unallocatedAmount: "10000.00", progressPercent: "100.0" });
    await refused(contracts.completeContract(roles.legal, contractId), "CONFLICT", "CONTRACT_NOT_FINANCIALLY_COMPLETE");
    expect((await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).status).toBe("ACTIVE");
  });
});

describe("invoices for installments (§26, §27, §86)", () => {
  it("raises the installment's invoice once, settles it by the installment's allocations, and pays it from Finance", async () => {
    const sale = await collecting([{ label: "Deposit", type: "DEPOSIT", amount: "50000.00", due: 5 }, { label: "Balance", amount: "250000.00", due: 60 }]);
    const [deposit, balance] = sale.installments;
    await pay(sale.contractId, { amount: "20000", allocations: [{ installmentId: deposit!.id, amount: "20000" }] });

    await refused(issueInstallmentInvoice(roles.sales, deposit!.id, {}), "FORBIDDEN");
    const { invoiceId } = await issueInstallmentInvoice(roles.finance, deposit!.id, {});
    await refused(issueInstallmentInvoice(roles.finance, deposit!.id, {}), "CONFLICT", "INSTALLMENT_ALREADY_INVOICED");
    let invoice = await getInvoice(roles.finance, invoiceId);
    expect(invoice).toMatchObject({ totalAmount: "50000.00", paidAmount: "20000.00", outstandingAmount: "30000.00", status: "DRAFT" });

    await submitInvoice(roles.finance, invoiceId);
    await approveInvoice(roles.owner, invoiceId, null, await shownCycle("finance", invoiceId));
    await markInvoiceSent(roles.finance, invoiceId);
    // Recorded through the Finance module against the invoice, it still settles the installment (§31).
    await recordPayment(roles.finance, createPaymentSchema.parse({ invoiceId, amount: "30000", paymentDate: isoDay(0), method: "BANK_TRANSFER" }));
    invoice = await getInvoice(roles.finance, invoiceId);
    expect(invoice).toMatchObject({ paidAmount: "50000.00", outstandingAmount: "0.00", settlementStatus: "PAID" });
    const view = await getUnitFinance(roles.finance, sale.unit.id);
    expect(view.schedules[0]!.installments[0]).toMatchObject({ status: "PAID", invoice: { id: invoiceId } });
    expect(view.invoices).toMatchObject([{ id: invoiceId, paidAmount: "50000.00", installmentLabel: "Deposit" }]);
    expect(await prisma.payment.count({ where: { contractId: sale.contractId } })).toBe(2);
    void balance;
  });
});

describe("the Sold rule (§42-§44, §122, §128)", () => {
  it("unlocks Mark Sold only once each rule is met, and never sells on its own", async () => {
    const sale = await collecting([{ label: "Deposit", type: "DEPOSIT", amount: "30000.00", due: 5 }, { label: "Balance", amount: "270000.00", due: 90 }]);
    const unsigned = await fixture.reserved();
    await fixture.contract(unsigned.id);

    await updateSalesSettings(roles.owner, { unitReservationDays: reservationDays, unitSoldRule: "SIGNED_CONTRACT" });
    expect((await getUnitSales(roles.sales, unsigned.id)).soldCheck).toMatchObject({ allowed: false, rule: "SIGNED_CONTRACT", missing: ["A signed contract"] });
    await refused(markUnitSold(roles.sales, unsigned.id, {}), "VALIDATION_ERROR", "UNIT_NOT_SELLABLE_YET");
    // Signing unlocks the button; the unit is still Reserved until Sales sells it (§44).
    expect((await getUnitSales(roles.sales, sale.unit.id)).status).toBe("RESERVED");
    expect((await getUnitSales(roles.sales, sale.unit.id)).soldCheck.allowed).toBe(true);

    await updateSalesSettings(roles.owner, { unitReservationDays: reservationDays, unitSoldRule: "SIGNED_CONTRACT_AND_DEPOSIT" });
    expect((await getUnitSales(roles.sales, sale.unit.id)).soldCheck.missing).toEqual(["The deposit paid in full"]);
    await pay(sale.contractId, { amount: "10000", allocations: [{ installmentId: sale.installments[0]!.id, amount: "10000" }] });
    await refused(markUnitSold(roles.sales, sale.unit.id, {}), "VALIDATION_ERROR", "UNIT_NOT_SELLABLE_YET");
    await pay(sale.contractId, { amount: "20000", allocations: [{ installmentId: sale.installments[0]!.id, amount: "20000" }] });

    await updateSalesSettings(roles.owner, { unitReservationDays: reservationDays, unitSoldRule: "DEPOSIT_RECEIVED" });
    expect((await getUnitSales(roles.sales, unsigned.id)).soldCheck.missing).toEqual(["A deposit in the active payment schedule"]);
    await markUnitSold(roles.sales, sale.unit.id, {});
    expect((await getUnitSales(roles.sales, sale.unit.id)).status).toBe("SOLD");

    await updateSalesSettings(roles.owner, { unitReservationDays: reservationDays, unitSoldRule: "RESERVATION" });
    expect((await getUnitSales(roles.sales, unsigned.id)).soldCheck).toMatchObject({ allowed: true, missing: [] });
  });

  it("asks for approval under Manual approval, and only the approval of this reservation unlocks it", async () => {
    await updateSalesSettings(roles.owner, { unitReservationDays: reservationDays, unitSoldRule: "MANUAL_APPROVAL" });
    const unit = await fixture.reserved();
    expect((await getUnitSales(roles.sales, unit.id))).toMatchObject({ canRequestSaleApproval: true, soldCheck: { missing: ["An approved sale"] } });
    await requestSaleApproval(roles.sales, unit.id, { note: "Buyer signed the offer" });
    await refused(requestSaleApproval(roles.sales, unit.id, { note: null }), "CONFLICT", "SALE_APPROVAL_PENDING");
    expect((await getUnitSales(roles.sales, unit.id)).soldCheck.missing).toEqual(["An approved sale (waiting for a decision)"]);
    await refused(approveUnitSale(roles.sales, unit.id, null), "FORBIDDEN");
    await refused(rejectUnitSale(roles.manager, unit.id, ""), "VALIDATION_ERROR");
    await approveUnitSale(roles.manager, unit.id, "Price within policy");
    expect((await getUnitSales(roles.sales, unit.id)).soldCheck.allowed).toBe(true);
    await markUnitSold(roles.sales, unit.id, {});
    expect(await prisma.auditEvent.count({ where: { entityId: unit.id, actionKey: { in: ["UNIT_SALE_APPROVAL_REQUESTED", "UNIT_SALE_APPROVAL_DECIDED"] } } })).toBe(2);
  });
});

describe("who sees and does what (§54-§56, §99-§104, §123, §130)", () => {
  it("keeps finance from Architecture and other companies, payments from Sales, and posting from Legal and Sales", async () => {
    const sale = await collecting([{ label: "Deposit", type: "DEPOSIT", amount: "300000.00", due: 10 }]);
    await pay(sale.contractId, { amount: "1000", reference: "SEC-1", allocations: [{ installmentId: sale.installments[0]!.id, amount: "1000" }] });

    await refused(getUnitFinance(roles.architect, sale.unit.id), "FORBIDDEN");
    await refused(getUnitFinance(roles.ownerB, sale.unit.id), "NOT_FOUND");
    await refused(recordContractPayment(roles.sales, sale.contractId, recordContractPaymentSchema.parse({ amount: "1", paymentDate: isoDay(0), method: "CASH" })), "FORBIDDEN");
    await refused(recordContractPayment(roles.legal, sale.contractId, recordContractPaymentSchema.parse({ amount: "1", paymentDate: isoDay(0), method: "CASH" })), "FORBIDDEN");
    // Another company's contract is not found, not refused: nothing about it is confirmed (§105).
    await refused(recordContractPayment(roles.ownerB, sale.contractId, recordContractPaymentSchema.parse({ amount: "1", paymentDate: isoDay(0), method: "CASH" })), "NOT_FOUND");

    const salesView = await getUnitFinance(roles.sales, sale.unit.id);
    expect(salesView.summary.financialStatus).toBe("PARTIALLY_PAID");
    expect(salesView.capabilities).toMatchObject({ canSeePayments: false, canRecordPayment: false, canManageSchedule: false });
    expect(salesView.payments).toEqual([]);
    const legalView = await getUnitFinance(roles.legal, sale.unit.id);
    expect(legalView.capabilities).toMatchObject({ canRecordPayment: false, canManageSchedule: false });
    expect((await getUnitFinance(roles.finance, sale.unit.id)).payments.map((row) => row.reference)).toContain("SEC-1");
    // The Viewer reads the unit's finance where it can open the project, and records nothing.
    const viewer = await getUnitFinance(roles.viewer, sale.unit.id).catch(() => null);
    if (viewer) expect(viewer.capabilities).toMatchObject({ canRecordPayment: false, canManageSchedule: false, canCorrect: false });
  });
});

describe("the project's Finance inventory (§45-§48, §65, §92, §127)", () => {
  it("filters, counts and totals by contract, once per contract however many units it sells", async () => {
    const apartment = await fixture.reserved("250000.00");
    const parking = await fixture.reserved("50000.00", { clientId: apartment.clientId, opportunityId: apartment.opportunityId });
    const { contractId, contractNumber } = await fixture.contract(apartment.id, { additionalUnitIds: [parking.id] });
    await fixture.sign(contractId, { activate: true });
    const { installments } = await fixture.schedule(contractId, [{ label: "Deposit", type: "DEPOSIT", amount: "300000.00", due: -2 }].map((row) => ({ ...row, due: 5 })));
    await pay(contractId, { amount: "100000", reference: "INV-SEARCH", allocations: [{ installmentId: installments[0]!.id, amount: "100000" }] });
    await prisma.paymentInstallment.update({ where: { id: installments[0]!.id }, data: { dueDate: new Date(Date.now() - 2 * 86_400_000) } });
    const pending = await fixture.reserved();
    await fixture.contract(pending.id);

    const all = await listFinanceInventory(roles.finance, RIVERSIDE, parseFinanceInventoryQuery({ q: T }));
    const byCode = new Map(all.items.map((row) => [row.unitCode, row]));
    expect(byCode.get(apartment.unitCode)).toMatchObject({ contract: { number: contractNumber }, contractValue: "300000.00", paidAmount: "100000.00", outstandingAmount: "200000.00", overdueAmount: "200000.00", financialStatus: "OVERDUE" });
    expect(byCode.get(parking.unitCode)?.financialStatus).toBe("OVERDUE");
    expect(byCode.get(pending.unitCode)?.financialStatus).toBe("CONTRACT_PENDING");
    expect(all.counts).toMatchObject({ OVERDUE: 2, CONTRACT_PENDING: 1 });
    expect(all.totals.find((row) => row.currency === "EUR")).toMatchObject({ contracted: "300000.00", collected: "100000.00", outstanding: "200000.00", overdue: "200000.00" });

    const overdue = await listFinanceInventory(roles.finance, RIVERSIDE, parseFinanceInventoryQuery({ q: T, financialStatus: "OVERDUE" }));
    expect(overdue.items.map((row) => row.unitCode).sort()).toEqual([apartment.unitCode, parking.unitCode].sort());
    expect((await listFinanceInventory(roles.finance, RIVERSIDE, parseFinanceInventoryQuery({ q: contractNumber }))).items).toHaveLength(2);
    expect((await listFinanceInventory(roles.finance, RIVERSIDE, parseFinanceInventoryQuery({ q: "INV-SEARCH" }))).items).toHaveLength(2);
    expect((await listFinanceInventory(roles.sales, RIVERSIDE, parseFinanceInventoryQuery({ q: "INV-SEARCH" }))).items).toHaveLength(0);
    await refused(listFinanceInventory(roles.architect, RIVERSIDE, parseFinanceInventoryQuery({})), "FORBIDDEN");
  });
});

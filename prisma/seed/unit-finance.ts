import { Prisma, type PrismaClient } from "@prisma/client";

import { STRUCTURE_SEED } from "./structure";

/**
 * A unit's contract and its collection (E-05F §7-§41, §88).
 *
 * Built on the units E-05E sells, so every screen has something to show and
 * isolation has something to hold on both sides:
 *
 * - A-201, sold to Nova Living, under sale contract CTR-2026-041 — signed
 *   and active at €176,000. Schedule v1 has a deposit paid by bank transfer and
 *   invoiced, an installment part paid and now overdue, and two to come.
 * - A-102, reserved for ACME Developments: Sales has asked Legal for its
 *   contract, which waits in Legal's queue; A-203, on the same deal, is offered
 *   to go on the same contract.
 * - Company B's OF-001: sale contract CTR-B-2026-011, signed, its deposit paid.
 *
 * Re-running replaces all of it.
 */

const COMPANY_A = "company_demo_a";
const FIXTURE_TENANT = "company_fixture_tenant";
const EUR = "EUR";
const DAY = 86_400_000;
const days = (offset: number) => new Date(Date.now() + offset * DAY);
/** A business date at midday UTC, as finance stores them (PRD #15 §257). */
const businessDay = (offset: number) => {
  const date = days(offset);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
};
const dec = (value: string) => new Prisma.Decimal(value);

type Member = (userId: string) => string;

/** Clears what this seed writes, before the structure seed replaces the units under it. */
export async function clearUnitFinance(prisma: PrismaClient, projectIds: string[]) {
  const units = await prisma.projectUnit.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
  const unitIds = units.map((row) => row.id);
  const contracts = await prisma.contractUnit.findMany({ where: { unitId: { in: unitIds } }, select: { contractId: true } });
  const contractIds = [...new Set(contracts.map((row) => row.contractId))];
  const payments = await prisma.payment.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } });
  const invoices = await prisma.invoice.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } });
  await prisma.paymentAllocation.deleteMany({ where: { OR: [{ contractId: { in: contractIds } }, { paymentId: { in: payments.map((row) => row.id) } }] } });
  await prisma.payment.updateMany({ where: { id: { in: payments.map((row) => row.id) } }, data: { replacesPaymentId: null } });
  await prisma.payment.deleteMany({ where: { id: { in: payments.map((row) => row.id) } } });
  await prisma.financeApproval.deleteMany({ where: { recordId: { in: invoices.map((row) => row.id) } } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices.map((row) => row.id) } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoices.map((row) => row.id) } } });
  await prisma.paymentInstallment.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.paymentSchedule.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.unitContractRequest.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.contractUnit.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractApproval.deleteMany({ where: { recordId: { in: contractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.unitSaleApproval.deleteMany({ where: { recordId: { in: unitIds } } });
  await prisma.activity.deleteMany({ where: { module: { in: ["contracts", "finance"] }, entityType: "ProjectUnit", entityId: { in: unitIds } } });
}

export async function seedUnitFinanceRecords(prisma: PrismaClient, memberId: Member) {
  const sales = memberId("user_sales");
  const legal = memberId("user_legal");
  const finance = memberId("user_finance");
  const ownerB = memberId("user_owner_b");
  const riverside = STRUCTURE_SEED.riverside;
  const munich = STRUCTURE_SEED.companyBProject;

  const codes = await prisma.projectUnit.findMany({ where: { projectId: riverside, unitCode: { in: ["A-102", "A-201"] } }, select: { id: true, unitCode: true } });
  const unit = new Map(codes.map((row) => [row.unitCode, row.id]));
  const users = await prisma.companyMember.findMany({ where: { id: { in: [sales, legal, finance, ownerB] } }, select: { id: true, userId: true } });
  const userOf = new Map(users.map((row) => [row.id, row.userId]));

  const trail = async (companyId: string, projectId: string, unitId: string, module: string, action: string, message: string, by: string, at: number) => {
    await prisma.activity.create({ data: { companyId, module, entityType: "ProjectUnit", entityId: unitId, action, message, actorMemberId: by, actorUserId: userOf.get(by)!, metadata: { projectId }, createdAt: days(at) } });
  };

  /** A signed, active sale contract for one unit, from its converted or active reservation. */
  const saleContract = async (input: { id: string; companyId: string; projectId: string; unitId: string; code: string; number: string; value: string; clientId: string; clientName: string; opportunityId: string; owner: string; signedAt: number; status: "ACTIVE" | "SIGNED" }) => {
    await prisma.contract.create({
      data: {
        id: input.id,
        companyId: input.companyId,
        contractNumber: input.number,
        title: `Sale agreement — ${input.code}`,
        contractType: "SALE_AGREEMENT",
        clientId: input.clientId,
        projectId: input.projectId,
        opportunityId: input.opportunityId,
        ownerMemberId: input.owner,
        status: input.status,
        counterpartyName: input.clientName,
        currency: EUR,
        contractValue: dec(input.value),
        sentAt: days(input.signedAt - 2),
        signedDate: businessDay(input.signedAt),
        effectiveDate: input.status === "ACTIVE" ? businessDay(input.signedAt + 1) : null,
        summary: `The sale of unit ${input.code}.`,
        createdByMemberId: input.owner,
        createdAt: days(input.signedAt - 6),
      },
    });
    await prisma.contractUnit.create({ data: { companyId: input.companyId, projectId: input.projectId, contractId: input.id, unitId: input.unitId, value: dec(input.value), currency: EUR, createdByMemberId: input.owner, createdAt: days(input.signedAt - 6) } });
  };

  const schedule = async (input: { id: string; companyId: string; contractId: string; by: string; at: number; installments: Array<{ id: string; label: string; type: "DEPOSIT" | "INSTALLMENT" | "BALANCE"; amount: string; due: number }> }) => {
    await prisma.paymentSchedule.create({ data: { id: input.id, companyId: input.companyId, contractId: input.contractId, versionNumber: 1, status: "ACTIVE", currency: EUR, activatedAt: days(input.at), activatedByMemberId: input.by, createdByMemberId: input.by, createdAt: days(input.at) } });
    for (const [index, row] of input.installments.entries()) {
      await prisma.paymentInstallment.create({ data: { id: row.id, companyId: input.companyId, contractId: input.contractId, scheduleId: input.id, sequence: index + 1, label: row.label, type: row.type, amount: dec(row.amount), currency: EUR, dueDate: businessDay(row.due) } });
    }
  };

  const pay = async (input: { id: string; companyId: string; projectId: string; contractId: string; clientId: string; by: string; amount: string; at: number; reference: string; installmentId: string; invoiceId?: string }) => {
    await prisma.payment.create({ data: { id: input.id, companyId: input.companyId, direction: "RECEIPT", clientId: input.clientId, contractId: input.contractId, projectId: input.projectId, amount: dec(input.amount), currency: EUR, paymentDate: businessDay(input.at), method: "BANK_TRANSFER", reference: input.reference, status: "RECORDED", createdByMemberId: input.by, createdAt: days(input.at) } });
    await prisma.paymentAllocation.create({ data: { id: `alloc_${input.id}`, companyId: input.companyId, paymentId: input.id, contractId: input.contractId, installmentId: input.installmentId, invoiceId: input.invoiceId ?? null, amount: dec(input.amount), createdByMemberId: input.by, createdAt: days(input.at) } });
  };

  /* A-201: sold to Nova Living, contract active, deposit paid, an installment overdue ------------------ */
  const a201 = unit.get("A-201")!;
  await saleContract({ id: "contract_sale_a201", companyId: COMPANY_A, projectId: riverside, unitId: a201, code: "A-201", number: "CTR-2026-041", value: "176000", clientId: "client_nova", clientName: "Nova Living", opportunityId: "opportunity_006", owner: legal, signedAt: -8, status: "ACTIVE" });
  await trail(COMPANY_A, riverside, a201, "contracts", "UNIT_CONTRACT_MARK_SIGNED", "recorded sale contract CTR-2026-041 as signed", legal, -8);
  await schedule({
    id: "schedule_sale_a201_v1",
    companyId: COMPANY_A,
    contractId: "contract_sale_a201",
    by: finance,
    at: -7,
    installments: [
      { id: "installment_a201_1", label: "Deposit", type: "DEPOSIT", amount: "17600", due: -5 },
      { id: "installment_a201_2", label: "Installment 1", type: "INSTALLMENT", amount: "52800", due: -1 },
      { id: "installment_a201_3", label: "Installment 2", type: "INSTALLMENT", amount: "52800", due: 60 },
      { id: "installment_a201_4", label: "Balance", type: "BALANCE", amount: "52800", due: 120 },
    ],
  });
  await trail(COMPANY_A, riverside, a201, "finance", "PAYMENT_SCHEDULE_ACTIVATED", "activated payment schedule v1 for contract CTR-2026-041", finance, -7);

  // The deposit was invoiced, sent and paid in full.
  await prisma.invoice.create({
    data: {
      id: "invoice_sale_a201_deposit",
      companyId: COMPANY_A,
      invoiceNumber: "INV-SA-2026-001",
      clientId: "client_nova",
      projectId: riverside,
      contractId: "contract_sale_a201",
      installmentId: "installment_a201_1",
      issueDate: businessDay(-7),
      dueDate: businessDay(-5),
      currency: EUR,
      subtotal: dec("17600"),
      taxAmount: dec("0"),
      totalAmount: dec("17600"),
      status: "SENT",
      sentAt: days(-7),
      notes: "Installment 1 of payment schedule v1, contract CTR-2026-041.",
      createdByMemberId: finance,
      lineItems: { create: [{ description: "Deposit — contract CTR-2026-041", quantity: dec("1"), unitPrice: dec("17600"), taxRate: dec("0"), subtotal: dec("17600"), taxAmount: dec("0"), totalAmount: dec("17600"), sortOrder: 0 }] },
    },
  });
  await pay({ id: "payment_sale_a201_1", companyId: COMPANY_A, projectId: riverside, contractId: "contract_sale_a201", clientId: "client_nova", by: finance, amount: "17600", at: -5, reference: "TR-A201-DEP", installmentId: "installment_a201_1", invoiceId: "invoice_sale_a201_deposit" });
  await trail(COMPANY_A, riverside, a201, "finance", "PAYMENT_RECORDED", "recorded a payment of EUR 17,600.00 against contract CTR-2026-041", finance, -5);
  // Part of the first installment, before it fell due: the rest is now overdue.
  await pay({ id: "payment_sale_a201_2", companyId: COMPANY_A, projectId: riverside, contractId: "contract_sale_a201", clientId: "client_nova", by: finance, amount: "20000", at: -2, reference: "TR-A201-I1A", installmentId: "installment_a201_2" });
  await trail(COMPANY_A, riverside, a201, "finance", "PAYMENT_RECORDED", "recorded a payment of EUR 20,000.00 against contract CTR-2026-041", finance, -2);

  /* A-102: reserved for ACME, a contract requested and waiting for Legal ------------------------------ */
  const a102 = unit.get("A-102")!;
  const a102Reservation = await prisma.unitReservation.findFirstOrThrow({ where: { unitId: a102, status: "ACTIVE" }, select: { id: true, clientId: true, opportunityId: true } });
  await prisma.unitContractRequest.create({
    data: { id: "contract_request_a102", companyId: COMPANY_A, projectId: riverside, unitId: a102, reservationId: a102Reservation.id, clientId: a102Reservation.clientId, opportunityId: a102Reservation.opportunityId, notes: "ACME signs for A-102 and A-203 together; parking to follow.", requestedByMemberId: sales, requestedAt: days(-1) },
  });
  await trail(COMPANY_A, riverside, a102, "contracts", "UNIT_CONTRACT_REQUESTED", "asked Legal for a contract for A-102", sales, -1);

  /* Company B: OF-001, contract signed, deposit paid ------------------------------------------------- */
  const of001 = STRUCTURE_SEED.units.munichOffice1;
  const of001Reservation = await prisma.unitReservation.findFirstOrThrow({ where: { unitId: of001, status: "ACTIVE" }, select: { id: true } });
  await saleContract({ id: "contract_sale_b_of001", companyId: FIXTURE_TENANT, projectId: munich, unitId: of001, code: "OF-001", number: "CTR-B-2026-011", value: "612000", clientId: "client_b_muc", clientName: "Isarwerk Holding", opportunityId: "opportunity_b_001", owner: ownerB, signedAt: -1, status: "SIGNED" });
  await prisma.unitContractRequest.create({
    data: { id: "contract_request_b_of001", companyId: FIXTURE_TENANT, projectId: munich, unitId: of001, reservationId: of001Reservation.id, clientId: "client_b_muc", opportunityId: "opportunity_b_001", status: "FULFILLED", requestedByMemberId: ownerB, requestedAt: days(-3), contractId: "contract_sale_b_of001", closedByMemberId: ownerB, closedAt: days(-2) },
  });
  await schedule({
    id: "schedule_sale_b_of001_v1",
    companyId: FIXTURE_TENANT,
    contractId: "contract_sale_b_of001",
    by: ownerB,
    at: -1,
    installments: [
      { id: "installment_b_of001_1", label: "Anzahlung", type: "DEPOSIT", amount: "61200", due: -1 },
      { id: "installment_b_of001_2", label: "Restzahlung", type: "BALANCE", amount: "550800", due: 45 },
    ],
  });
  await pay({ id: "payment_sale_b_of001_1", companyId: FIXTURE_TENANT, projectId: munich, contractId: "contract_sale_b_of001", clientId: "client_b_muc", by: ownerB, amount: "61200", at: -1, reference: "SEPA-OF001-ANZ", installmentId: "installment_b_of001_1" });

  return {
    contracts: await prisma.contractUnit.count({ where: { releasedAt: null, contract: { contractType: "SALE_AGREEMENT" } } }),
    schedules: await prisma.paymentSchedule.count({ where: { status: "ACTIVE" } }),
    payments: await prisma.payment.count({ where: { contractId: { not: null } } }),
    requests: await prisma.unitContractRequest.count({ where: { status: "OPEN" } }),
  };
}

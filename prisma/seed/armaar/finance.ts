/**
 * ARMAAR's money beyond the sale schedules (D-02 §20, §67, §76).
 *
 * D-01 set every project's approved budget, three Tirana Lake expenses, and
 * the buyers' payments allocated to their installments. D-02 adds the rest of
 * the canonical finance record — never a second payment engine:
 *
 *   invoices      one per installment falling due around the seed day, raised
 *                 the way the unit's Finance section raises one (one line, no
 *                 tax, the installment's amount): the paid ones carry the
 *                 buyer's payment through its allocation (Invoice → Payment →
 *                 Allocation, §67), two missed ones are overdue, and of those
 *                 still to come one waits for approval and one is a draft
 *   expenses      site costs, fees and studies across the working companies,
 *                 approved, waiting, draft and one sent back — the approved
 *                 ones paid by a disbursement allocated to the expense
 *   commitments   two undertakings entered by hand, beside the ones the
 *                 approved purchase orders opened (supply.ts)
 *
 * Invoices depend on the installments' dates, which are relative to the day
 * the first seed ran; they are written once, on that run, like E-04's
 * attendance. Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import { Prisma, type ExpenseStatus, type FinanceCostCategory, type PrismaClient } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { memberId } from "./access";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const EUR = "EUR";
const TAX = 0.2;
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

/** Who keeps each company's books, and who approves in it. */
const FINANCE: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.finance-specialist", ARLIS_NDERTIM: "arlis.accountant", IDEAL_CONSTRUCTION: "ideal.finance", UNICO_CONSTRUCTION: "unico.finance", SARANDA_MARINA_INVEST: "smi.finance", ARSOL_ENERGY: "arsol.finance" };
const APPROVER: Partial<Record<CompanyCode, string>> = { [BCI]: "bci.finance", ARLIS_NDERTIM: "arlis.finance", IDEAL_CONSTRUCTION: "ideal.director", UNICO_CONSTRUCTION: "unico.director", SARANDA_MARINA_INVEST: "smi.director", ARSOL_ENERGY: "arsol.director" };

const EXPENSES: Array<{ key: string; company: CompanyCode; project: ProjectCode | null; number: string; description: string; payee: string; category: FinanceCostCategory; net: number; status: ExpenseStatus; day: number; paid?: number; rejected?: string }> = [
  { key: "tl_security", company: BCI, project: "TIRANA_LAKE", number: "EXP-2026-0124", description: "Site security — September", payee: "Demo Security Services sh.p.k.", category: "SERVICES", net: 9_800, status: "APPROVED", day: -12, paid: -5 },
  { key: "tl_survey", company: BCI, project: "TIRANA_LAKE", number: "EXP-2026-0126", description: "Surveyor's setting-out — Tower B levels 5 to 8", payee: "Demo Survey Partners sh.p.k.", category: "SERVICES", net: 4_200, status: "APPROVED", day: -8, paid: -2 },
  { key: "tl_photography", company: BCI, project: "TIRANA_LAKE", number: "EXP-2026-0129", description: "Show apartment photography and video", payee: "Demo Studio sh.p.k.", category: "OTHER", net: 1_600, status: "PENDING_APPROVAL", day: -2 },
  { key: "tl_generator", company: BCI, project: "TIRANA_LAKE", number: "EXP-2026-0122", description: "Temporary power — generator hire, August", payee: "AlbaBuild sh.p.k.", category: "EQUIPMENT", net: 6_300, status: "REJECTED", day: -15, rejected: "Charge it to the electrical contractor under WP-TL-03." },
  { key: "ut_permits", company: "UNICO_CONSTRUCTION", project: "UNITED_TOWERS", number: "EXP-2026-0131", description: "Planning permit fees — United Towers", payee: "Tirana Municipality", category: "ADMINISTRATION", net: 12_500, status: "DRAFT", day: -1 },
  { key: "tc_skips", company: "ARLIS_NDERTIM", project: "THE_COURTYARD", number: "EXP-2026-0047", description: "Skip hire — block 3 strip-out", payee: "Demo Waste Services sh.p.k.", category: "SERVICES", net: 2_400, status: "APPROVED", day: -20, paid: -14 },
  { key: "fr_lab", company: "ARLIS_NDERTIM", project: "FARKA_RESIDENCE", number: "EXP-2026-0033", description: "Concrete testing laboratory — September", payee: "Demo Materials Laboratory sh.p.k.", category: "SERVICES", net: 3_100, status: "APPROVED", day: -6 },
  { key: "gm_design", company: "SARANDA_MARINA_INVEST", project: "GRAN_MELIA", number: "EXP-2026-0012", description: "Design fees — villas concept stage", payee: "UNICO CONSTRUCTION", category: "SERVICES", net: 48_000, status: "PENDING_APPROVAL", day: -4 },
  { key: "as_grid", company: "ARSOL_ENERGY", project: null, number: "EXP-2026-0021", description: "Grid connection study — rooftop programme, batch 2", payee: "Demo Grid Consultants sh.p.k.", category: "SERVICES", net: 7_500, status: "APPROVED", day: -25, paid: -18 },
];

/** D-01's approved Tirana Lake expenses, paid to their suppliers. */
const D01_PAID: Array<{ expense: string; day: number }> = [
  { expense: "armaar_exp_tl_001", day: -3 },
  { expense: "armaar_exp_tl_003", day: -22 },
];

export async function seedArmaarFinance(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);

  /* Invoices on the installments around the seed day (§20, §67) --------------- */
  if ((await prisma.invoice.count({ where: { id: { startsWith: "armaar_inv_" } } })) === 0) {
    const installments = await prisma.paymentInstallment.findMany({
      where: { id: { startsWith: "armaar_inst_" }, schedule: { status: "ACTIVE" }, dueDate: { gte: day(-60), lte: day(30) } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      select: { id: true, companyId: true, contractId: true, amount: true, currency: true, dueDate: true, label: true, sequence: true, allocations: { where: { reversedAt: null }, select: { id: true } } },
    });
    const contracts = new Map((await prisma.contract.findMany({ where: { id: { in: installments.map((row) => row.contractId) } }, select: { id: true, contractNumber: true, clientId: true, projectId: true } })).map((row) => [row.id, row]));
    const upcoming = installments.filter((row) => row.dueDate > new Date());
    // Each company's own series, and its own bookkeeper: Tirana Lake's buyers are invoiced by BCI, Square 21's by ARLIS - NDERTIM.
    const series = new Map<string, number>();
    const bookkeepers = new Map((await prisma.companyMember.findMany({ where: { id: { in: Object.entries(FINANCE).map(([code, username]) => memberId(username!, code as CompanyCode)) } }, select: { id: true, companyId: true } })).map((row) => [row.companyId, row.id]));
    for (const installment of installments) {
      const contract = contracts.get(installment.contractId)!;
      const id = `armaar_inv_${installment.id.replace(/^armaar_inst_/, "")}`;
      const issued = new Date(installment.dueDate.getTime() - 14 * 86_400_000);
      const index = series.get(installment.companyId) ?? 0;
      series.set(installment.companyId, index + 1);
      const bookkeeper = bookkeepers.get(installment.companyId)!;
      // Of those still to come, the last is a draft and the one before it waits for approval.
      const position = upcoming.indexOf(installment);
      const status = position === upcoming.length - 1 ? "DRAFT" : position === upcoming.length - 2 ? "PENDING_APPROVAL" : "SENT";
      const description = `${installment.label} — contract ${contract.contractNumber}`;
      await prisma.invoice.create({
        data: {
          id,
          companyId: installment.companyId,
          invoiceNumber: `INV-2026-${String(index + 101).padStart(4, "0")}`,
          clientId: contract.clientId!,
          projectId: contract.projectId,
          contractId: installment.contractId,
          installmentId: installment.id,
          issueDate: issued,
          dueDate: installment.dueDate,
          currency: installment.currency,
          subtotal: installment.amount,
          taxAmount: money(0),
          totalAmount: installment.amount,
          status,
          sentAt: status === "SENT" ? issued : null,
          notes: `Installment ${installment.sequence} of payment schedule v1, contract ${contract.contractNumber}.`,
          createdByMemberId: bookkeeper,
          createdAt: issued,
          lineItems: { create: [{ description, quantity: new Prisma.Decimal(1), unitPrice: installment.amount, taxRate: new Prisma.Decimal(0), subtotal: installment.amount, taxAmount: money(0), totalAmount: installment.amount, sortOrder: 0 }] },
        },
      });
      // The buyer's payment settles the invoice through the allocation that already settles the installment.
      for (const allocation of installment.allocations) await prisma.paymentAllocation.update({ where: { id: allocation.id }, data: { invoiceId: id } });
      if (status === "PENDING_APPROVAL") {
        await prisma.financeApproval.create({ data: { id: `${id}_approval`, companyId: installment.companyId, recordType: "INVOICE", recordId: id, status: "PENDING", submittedByMemberId: bookkeeper, submittedAt: at(-1, 9) } });
      }
    }
  }

  /* Expenses and what paid them (§20) ------------------------------------------ */
  for (const expense of EXPENSES) {
    const code = expense.company;
    const id = `armaar_exp_${expense.key}`;
    const keeper = memberId(FINANCE[code]!, code);
    const approver = memberId(APPROVER[code]!, code);
    await prisma.expense.upsert({
      where: { id },
      update: {},
      create: { id, companyId: companyId(code), expenseNumber: expense.number, projectId: expense.project ? projectId(expense.project) : null, expenseDate: day(expense.day), category: expense.category, description: expense.description, payeeName: expense.payee, currency: EUR, netAmount: money(expense.net), taxAmount: money(expense.net * TAX), totalAmount: money(expense.net * (1 + TAX)), status: expense.status, createdByMemberId: keeper, createdAt: at(expense.day, 11) },
    });
    if (expense.status !== "DRAFT") {
      const decision = expense.status === "PENDING_APPROVAL" ? "PENDING" : expense.status === "REJECTED" ? "REJECTED" : "APPROVED";
      await prisma.financeApproval.upsert({
        where: { id: `${id}_approval` },
        update: {},
        create: { id: `${id}_approval`, companyId: companyId(code), recordType: "EXPENSE", recordId: id, status: decision, submittedByMemberId: keeper, submittedAt: at(expense.day, 12), decidedByMemberId: decision === "PENDING" ? null : approver, decidedAt: decision === "PENDING" ? null : at(expense.day + 1, 10), decisionNote: expense.rejected ?? null },
      });
    }
  }
  const disbursements = [
    ...EXPENSES.filter((expense) => expense.paid !== undefined).map((expense) => ({ expense: `armaar_exp_${expense.key}`, day: expense.paid! })),
    ...D01_PAID,
  ];
  for (const payment of disbursements) {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: payment.expense }, select: { id: true, companyId: true, projectId: true, totalAmount: true, currency: true, expenseNumber: true, payeeName: true, createdByMemberId: true } });
    const id = `armaar_pay_${payment.expense.replace(/^armaar_/, "")}`;
    await prisma.payment.upsert({
      where: { id },
      update: {},
      create: { id, companyId: expense.companyId, direction: "DISBURSEMENT", projectId: expense.projectId, amount: expense.totalAmount, currency: expense.currency, paymentDate: day(payment.day), method: "BANK_TRANSFER", reference: `OUT-${expense.expenseNumber}`, notes: `Paid to ${expense.payeeName}.`, status: "RECORDED", createdByMemberId: expense.createdByMemberId, createdAt: at(payment.day, 14) },
    });
    await prisma.paymentAllocation.upsert({
      where: { id: `${id}_alloc` },
      update: {},
      create: { id: `${id}_alloc`, companyId: expense.companyId, paymentId: id, expenseId: expense.id, amount: expense.totalAmount, createdByMemberId: expense.createdByMemberId, createdAt: at(payment.day, 14) },
    });
  }

  /* Commitments entered by hand (§20) ------------------------------------------- */
  const manual = [
    // United Towers is UNICO's own: UNICO designs it in-house and engages the structural and MEP engineers.
    { id: "armaar_cmt_ut_design", company: "UNICO_CONSTRUCTION" as CompanyCode, project: "UNITED_TOWERS" as ProjectCode, reference: "UT-ENG-01", description: "Structural and MEP engineering design — United Towers", counterparty: "Demo Engineering Consultants sh.p.k.", category: "SERVICES" as const, amount: 420_000, status: "APPROVED" as const, expected: 120, day: -40 },
    { id: "armaar_cmt_gm_operator", company: "SARANDA_MARINA_INVEST" as CompanyCode, project: "GRAN_MELIA" as ProjectCode, reference: "GM-TSA-01", description: "Hotel operator technical services — pre-opening", counterparty: "Demo Hospitality Advisors", category: "SERVICES" as const, amount: 180_000, status: "PENDING_APPROVAL" as const, expected: 200, day: -3 },
  ];
  for (const commitment of manual) {
    const keeper = memberId(FINANCE[commitment.company]!, commitment.company);
    await prisma.commitment.upsert({
      where: { id: commitment.id },
      update: {},
      create: { id: commitment.id, companyId: companyId(commitment.company), projectId: projectId(commitment.project), reference: commitment.reference, description: commitment.description, counterpartyName: commitment.counterparty, category: commitment.category, currency: EUR, amount: money(commitment.amount), expectedDate: day(commitment.expected), status: commitment.status, createdByMemberId: keeper, createdAt: at(commitment.day, 10) },
    });
    const approver = memberId(APPROVER[commitment.company]!, commitment.company);
    const pending = commitment.status === "PENDING_APPROVAL";
    await prisma.financeApproval.upsert({
      where: { id: `${commitment.id}_approval` },
      update: {},
      create: { id: `${commitment.id}_approval`, companyId: companyId(commitment.company), recordType: "COMMITMENT", recordId: commitment.id, status: pending ? "PENDING" : "APPROVED", submittedByMemberId: keeper, submittedAt: at(commitment.day, 11), decidedByMemberId: pending ? null : approver, decidedAt: pending ? null : at(commitment.day + 1, 10) },
    });
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return {
    invoices: await prisma.invoice.count({ where: inGroup }),
    expenses: await prisma.expense.count({ where: inGroup }),
    disbursements: await prisma.payment.count({ where: { ...inGroup, direction: "DISBURSEMENT" } }),
    commitments: await prisma.commitment.count({ where: inGroup }),
  };
}

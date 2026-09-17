import { Prisma } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { companyDays } from "@/lib/core/notifications/company-day";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere, structureOpen } from "@/lib/modules/project-structure/structure.permissions";
import { fail, findReadableUnit } from "@/lib/modules/project-structure/structure.service";
import { paidByContract, paidByInstallment } from "../finance.settlement";
import { financialStatus, installmentStatus, isCurrentSchedule, outstanding, progressPercent, scheduleTarget, sumAmounts } from "./unit-finance.rules";
import type { InstallmentStatus, UnitFinanceCapabilities, UnitFinancialStatus } from "./unit-finance.types";

/**
 * What every Finance surface of a unit shares (E-05F §35-§41, §54, §85, §99-§106):
 * who may do what, the doors to a unit and to its sale contract, and the
 * contract's figures, computed in a fixed number of queries however many
 * contracts are asked about.
 *
 * Finance reads the contract Legal owns — its status, value and units — and
 * never writes it. The figures are the contract's, not split across its units:
 * an apartment and its parking on one contract show the same balance (§91).
 */

type Client = Prisma.TransactionClient | typeof prisma;

export function financeCapabilities(context: UserContext): UnitFinanceCapabilities {
  const open = structureOpen(context);
  const has = (permission: Parameters<typeof can>[1]) => open && can(context, permission);
  // A company with Finance switched off has no unit finance, whatever the unit grants say (PRD #47 §25).
  const view = isModuleEnabled(context, "finance") && has("project.unit.finance.view");
  const finance = canAccessModule(context, "finance");
  return {
    canView: view,
    canManageSchedule: view && has("project.unit.finance.manage_schedule"),
    canIssueInvoice: view && has("project.unit.finance.issue_invoice") && finance && can(context, "finance.invoice.create"),
    canRecordPayment: view && has("project.unit.finance.record_payment") && finance && can(context, "finance.payment.create"),
    canAllocate: view && has("project.unit.finance.allocate_payment") && finance && can(context, "finance.payment.create"),
    canManageDocuments: view && has("project.unit.finance.documents.manage"),
    canCorrect: view && has("project.unit.finance.correct"),
    canSeePayments: view && finance && can(context, "finance.payment.view"),
    canSeeInvoices: view && finance && can(context, "finance.invoice.view"),
    canVoidPayment: view && has("project.unit.finance.correct") && finance && can(context, "finance.payment.void"),
    canSeeDocuments: view && finance && canAccessModule(context, "documents") && can(context, "document.view") && can(context, "finance.document.view") && can(context, "finance.payment.view"),
  };
}

/** A unit whose Finance section the reader may open: through its project's door, then the finance view grant (§99). */
export async function findFinanceUnit(context: UserContext, unitId: string) {
  const unit = await findReadableUnit(context, unitId);
  if (!financeCapabilities(context).canView) throw new AccessError("FORBIDDEN", "You cannot see this unit's finance.");
  return unit;
}

export type FinanceContract = {
  id: string;
  companyId: string;
  projectId: string | null;
  contractNumber: string;
  contractType: string;
  status: string;
  contractValue: Prisma.Decimal | null;
  currency: string | null;
  clientId: string | null;
  opportunityId: string | null;
  ownerMemberId: string;
  units: Array<{ unitId: string; unitCode: string; projectId: string; released: boolean }>;
};

/**
 * A sale contract, reached only through a unit the reader may open (§99, §105):
 * a contract whose units are all out of reach is a 404 that names nothing, as is
 * a contract that sells no unit at all.
 */
export async function findFinanceContract(context: UserContext, contractId: string): Promise<FinanceContract> {
  const contract = await prisma.contract.findFirst({
    where: { companyId: context.companyId, id: contractId, units: { some: { unit: { is: readableUnitWhere(context) } } } },
    select: {
      id: true,
      companyId: true,
      projectId: true,
      contractNumber: true,
      contractType: true,
      status: true,
      contractValue: true,
      currency: true,
      clientId: true,
      opportunityId: true,
      ownerMemberId: true,
      units: { orderBy: { createdAt: "asc" }, select: { unitId: true, releasedAt: true, unit: { select: { unitCode: true, projectId: true } } } },
    },
  });
  if (!contract) throw fail("CONTRACT_NOT_FOUND", "That contract could not be found.", "NOT_FOUND");
  // Found first, refused second: another company's contract is not found whatever the reader's own modules (§105).
  if (!financeCapabilities(context).canView) throw new AccessError("FORBIDDEN", "You cannot see this unit's finance.");
  return { ...contract, units: contract.units.map((row) => ({ unitId: row.unitId, unitCode: row.unit.unitCode, projectId: row.unit.projectId, released: row.releasedAt !== null })) };
}

/** The unit's one live contract, if it has one (§8). */
export async function liveContractForUnit(client: Client, companyId: string, unitId: string): Promise<{ contractId: string } | null> {
  const row = await client.contractUnit.findFirst({ where: { companyId, unitId, releasedAt: null }, select: { contractId: true } });
  return row;
}

/** The start of today where the company lives, as due dates compare (PRD #51 §48). */
export async function companyToday(companyId: string, now = new Date()): Promise<Date> {
  return (await companyDays(companyId))(now).start;
}

export type InstallmentFacts = {
  id: string;
  scheduleId: string;
  sequence: number;
  label: string;
  type: string;
  amount: Prisma.Decimal;
  dueDate: Date;
  paid: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  status: InstallmentStatus;
};

export type ContractFacts = {
  contractId: string;
  contractNumber: string;
  status: string;
  value: Prisma.Decimal;
  currency: string;
  paid: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  overdue: Prisma.Decimal;
  unallocated: Prisma.Decimal;
  /** Still owed on the current schedule's installments. */
  openInstallments: Prisma.Decimal;
  /** Collected against installments of earlier schedules, which a new schedule does not cover again (§84). */
  carriedPaid: Prisma.Decimal;
  currentScheduleId: string | null;
  currentInstallments: InstallmentFacts[];
  nextDue: InstallmentFacts | null;
  deposit: { exists: boolean; total: Prisma.Decimal; paid: Prisma.Decimal };
  financialStatus: UnitFinancialStatus;
  progressPercent: string | null;
};

const ZERO = new Prisma.Decimal(0);

/**
 * The figures of each contract (§35-§41, §85), in five queries for any number
 * of contracts: the contracts, their current schedules with installments, what
 * is allocated to those installments, what is allocated to each contract, and
 * what was received against each (§107).
 */
export async function contractFinanceFacts(client: Client, companyId: string, contractIds: string[], today: Date): Promise<Map<string, ContractFacts>> {
  const ids = [...new Set(contractIds)];
  if (ids.length === 0) return new Map();

  const [contracts, schedules, paidByContractId, received] = await Promise.all([
    client.contract.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, contractNumber: true, status: true, contractValue: true, currency: true } }),
    client.paymentSchedule.findMany({
      where: { companyId, contractId: { in: ids }, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { id: true, contractId: true, status: true, installments: { orderBy: [{ dueDate: "asc" }, { sequence: "asc" }], select: { id: true, sequence: true, label: true, type: true, amount: true, dueDate: true } } },
    }),
    paidByContract(ids, client as Prisma.TransactionClient),
    client.payment.groupBy({ by: ["contractId"], where: { companyId, contractId: { in: ids }, status: "RECORDED" }, _sum: { amount: true } }),
  ]);
  const installmentPaid = await paidByInstallment(
    schedules.flatMap((schedule) => schedule.installments.map((installment) => installment.id)),
    client as Prisma.TransactionClient,
  );
  const receivedBy = new Map(received.map((row) => [row.contractId!, row._sum?.amount ?? ZERO]));

  const facts = new Map<string, ContractFacts>();
  for (const contract of contracts) {
    const schedule = schedules.find((row) => row.contractId === contract.id && isCurrentSchedule(row.status)) ?? null;
    const installments: InstallmentFacts[] = (schedule?.installments ?? []).map((row) => {
      const paid = installmentPaid.get(row.id) ?? ZERO;
      return {
        id: row.id,
        scheduleId: schedule!.id,
        sequence: row.sequence,
        label: row.label,
        type: row.type,
        amount: row.amount,
        dueDate: row.dueDate,
        paid,
        outstanding: outstanding(row.amount, paid),
        status: installmentStatus({ scheduleStatus: schedule!.status, amount: row.amount, paid, dueDate: row.dueDate, today }),
      };
    });
    const value = contract.contractValue ?? ZERO;
    const paid = paidByContractId.get(contract.id) ?? ZERO;
    const currentPaid = sumAmounts(installments.map((row) => row.paid));
    const overdue = sumAmounts(installments.filter((row) => row.status === "OVERDUE").map((row) => row.outstanding));
    const openInstallments = sumAmounts(installments.map((row) => row.outstanding));
    const unallocated = outstanding(receivedBy.get(contract.id) ?? ZERO, paid);
    const deposits = installments.filter((row) => row.type === "DEPOSIT");
    facts.set(contract.id, {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
      value,
      currency: contract.currency ?? "EUR",
      paid,
      outstanding: outstanding(value, paid),
      overdue,
      unallocated,
      openInstallments,
      carriedPaid: outstanding(paid, currentPaid),
      currentScheduleId: schedule?.id ?? null,
      currentInstallments: installments,
      nextDue: installments.find((row) => row.outstanding.greaterThan(0)) ?? null,
      deposit: { exists: deposits.length > 0, total: sumAmounts(deposits.map((row) => row.amount)), paid: sumAmounts(deposits.map((row) => row.paid)) },
      financialStatus: financialStatus({ contractStatus: contract.status, value, paid, overdue, unallocated, openInstallments }),
      progressPercent: progressPercent(value, paid),
    });
  }
  return facts;
}

/**
 * What a schedule activated now must add up to (§24, §84): the value less
 * everything collected so far. A new schedule replaces the current one, so what
 * was paid against the current one is history it does not cover again.
 */
export async function scheduleTargetFor(client: Client, companyId: string, contractId: string, today: Date): Promise<Prisma.Decimal> {
  const facts = (await contractFinanceFacts(client, companyId, [contractId], today)).get(contractId);
  return facts ? scheduleTarget(facts.value, facts.paid) : ZERO;
}

/**
 * Whether a unit meets the parts of the company's Sold rule that Legal and
 * Finance hold (E-05F §42, §43): a signed contract, and a deposit paid in full.
 * Read here, where both are derived, so Sales asks one question.
 */
export async function unitSaleReadiness(client: Client, companyId: string, unitId: string, now = new Date()): Promise<{ contract: { id: string; number: string; status: string } | null; signed: boolean; deposit: { exists: boolean; paid: boolean } }> {
  const live = await liveContractForUnit(client, companyId, unitId);
  if (!live) return { contract: null, signed: false, deposit: { exists: false, paid: false } };
  const facts = (await contractFinanceFacts(client, companyId, [live.contractId], await companyToday(companyId, now))).get(live.contractId);
  if (!facts) return { contract: null, signed: false, deposit: { exists: false, paid: false } };
  return {
    contract: { id: facts.contractId, number: facts.contractNumber, status: facts.status },
    signed: ["SIGNED", "ACTIVE", "COMPLETED"].includes(facts.status),
    deposit: { exists: facts.deposit.exists, paid: facts.deposit.exists && facts.deposit.paid.greaterThanOrEqualTo(facts.deposit.total) },
  };
}

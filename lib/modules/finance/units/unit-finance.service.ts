import { Prisma, type PaymentScheduleStatus } from "@prisma/client";

import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { applyTransition } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { fail } from "@/lib/modules/project-structure/structure.service";
import { businessDateString } from "../finance.fields";
import { toAmountString } from "../finance.money";
import { allocatedByPayment, lockRow, paidByInstallment, paidByInvoice } from "../finance.settlement";
import { resolveFinanceSettings } from "../finance.settings";
import { createInstallmentInvoiceRecord } from "../invoices/invoice.service";
import { allocate, lockPayment, reverseAllocation } from "../payments/payment.allocations";
import { paymentScheduleMachine, type PaymentScheduleAction } from "./payment-schedule.machine";
import {
  companyToday,
  contractFinanceFacts,
  financeCapabilities,
  findFinanceContract,
  findFinanceUnit,
  scheduleTargetFor,
  type ContractFacts,
  type FinanceContract,
} from "./unit-finance.core";
import { firstUnit, money, notifyFinance, saleAudience, trackingStatus, unitActivity } from "./unit-finance.events";
import { installmentStatus, isCollecting, outstanding, sumAmounts } from "./unit-finance.rules";
import type { activateScheduleSchema, allocatePaymentSchema, createScheduleSchema, discardScheduleSchema, issueInvoiceSchema, recordContractPaymentSchema, reverseAllocationSchema, updateScheduleSchema } from "./unit-finance.schema";
import type { ContractPaymentDTO, FinanceSummaryDTO, ScheduleDTO, UnitFinanceDTO } from "./unit-finance.types";
import type { z } from "zod";

/**
 * Collecting a unit's sale (E-05F §18-§41, §57-§66, §74-§84).
 *
 * Every write reaches the sale contract through a unit the person may open and
 * the unit's finance grant, then locks the contract row: schedules, payments,
 * allocations and invoices of one contract queue behind each other, and each
 * decides on what the contract is now. A schedule moves only by its machine;
 * money is allocated only by the allocation engine, which refuses more than a
 * payment holds or an installment owes. Every change that moves money records
 * the unit's financial status when it changes (§97), and leaves activity on each
 * unit the contract sells, without a client's name.
 */

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

/** The contract row, held for the rest of the transaction (§78, §80). */
async function lockContract(tx: Tx, context: UserContext, contract: FinanceContract): Promise<{ status: string; contractValue: Prisma.Decimal | null; currency: string | null }> {
  await lockRow(tx, "contracts", contract.id);
  return tx.contract.findFirstOrThrow({ where: { companyId: context.companyId, id: contract.id }, select: { status: true, contractValue: true, currency: true } });
}

function assertOpenContract(status: string) {
  if (["CANCELLED", "TERMINATED", "EXPIRED", "ARCHIVED"].includes(status)) {
    throw fail("CONTRACT_CLOSED", "This contract is no longer in force, so its schedule and payments are closed.", "CONFLICT");
  }
}

/* Reading (§39, §50, §64) ---------------------------------------------------------- */

function summaryDTO(unitId: string, contract: FinanceContract | null, facts: ContractFacts | null): FinanceSummaryDTO {
  if (!contract || !facts) {
    return { unitId, contract: null, paidAmount: "0.00", outstandingAmount: "0.00", overdueAmount: "0.00", unallocatedAmount: "0.00", nextDue: null, financialStatus: "NO_CONTRACT", progressPercent: null, sharedWithUnits: [] };
  }
  return {
    unitId,
    contract: { id: contract.id, number: contract.contractNumber, status: facts.status, value: toAmountString(facts.value), currency: facts.currency },
    paidAmount: toAmountString(facts.paid),
    outstandingAmount: toAmountString(facts.outstanding),
    overdueAmount: toAmountString(facts.overdue),
    unallocatedAmount: toAmountString(facts.unallocated),
    nextDue: facts.nextDue ? { installmentId: facts.nextDue.id, label: facts.nextDue.label, amount: toAmountString(facts.nextDue.outstanding), dueDate: businessDateString(facts.nextDue.dueDate) } : null,
    financialStatus: facts.financialStatus,
    progressPercent: facts.progressPercent,
    sharedWithUnits: contract.units.filter((row) => !row.released && row.unitId !== unitId).map((row) => ({ id: row.unitId, unitCode: row.unitCode })),
  };
}

/** The unit's live contract, or — once it has none — the last one it had, for its history. */
async function contractForUnit(context: UserContext, unitId: string): Promise<{ contract: FinanceContract; live: boolean } | null> {
  const link = await prisma.contractUnit.findFirst({ where: { companyId: context.companyId, unitId }, orderBy: [{ releasedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], select: { contractId: true, releasedAt: true } });
  if (!link) return null;
  return { contract: await findFinanceContract(context, link.contractId), live: link.releasedAt === null };
}

export async function getUnitFinanceSummary(context: UserContext, unitId: string): Promise<FinanceSummaryDTO> {
  const unit = await findFinanceUnit(context, unitId);
  const found = await contractForUnit(context, unit.id);
  if (!found?.live) return summaryDTO(unit.id, null, null);
  const facts = (await contractFinanceFacts(prisma, context.companyId, [found.contract.id], await companyToday(context.companyId))).get(found.contract.id) ?? null;
  return summaryDTO(unit.id, found.contract, facts);
}

export async function getUnitFinance(context: UserContext, unitId: string): Promise<UnitFinanceDTO> {
  const unit = await findFinanceUnit(context, unitId);
  const caps = financeCapabilities(context);
  const found = await contractForUnit(context, unit.id);
  const base = { unitId: unit.id, projectId: unit.projectId, unitCode: unit.unitCode, capabilities: caps };
  if (!found) return { ...base, summary: summaryDTO(unit.id, null, null), scheduleTarget: null, contractStatusAllowsActivation: false, schedules: [], payments: [], invoices: [], documents: [] };

  const { contract, live } = found;
  const today = await companyToday(context.companyId);
  const [factsMap, schedules, target] = await Promise.all([
    contractFinanceFacts(prisma, context.companyId, [contract.id], today),
    prisma.paymentSchedule.findMany({
      where: { companyId: context.companyId, contractId: contract.id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        currency: true,
        notes: true,
        totalExceptionReason: true,
        activatedAt: true,
        supersededAt: true,
        cancelledAt: true,
        cancelReason: true,
        version: true,
        installments: {
          orderBy: { sequence: "asc" },
          select: { id: true, sequence: true, label: true, type: true, amount: true, currency: true, dueDate: true, notes: true, invoices: { where: { status: { notIn: ["CANCELLED", "ARCHIVED"] } }, take: 1, select: { id: true, invoiceNumber: true, status: true } } },
        },
      },
    }),
    live ? scheduleTargetFor(prisma, context.companyId, contract.id, today) : Promise.resolve(null),
  ]);
  const facts = factsMap.get(contract.id) ?? null;
  const installmentPaid = await paidByInstallment(schedules.flatMap((schedule) => schedule.installments.map((row) => row.id)));

  const scheduleDTOs: ScheduleDTO[] = schedules.map((schedule) => ({
    id: schedule.id,
    versionNumber: schedule.versionNumber,
    status: schedule.status,
    currency: schedule.currency,
    notes: schedule.notes,
    total: toAmountString(sumAmounts(schedule.installments.map((row) => row.amount))),
    totalExceptionReason: schedule.totalExceptionReason,
    activatedAt: schedule.activatedAt?.toISOString() ?? null,
    supersededAt: schedule.supersededAt?.toISOString() ?? null,
    cancelledAt: schedule.cancelledAt?.toISOString() ?? null,
    cancelReason: schedule.cancelReason,
    version: schedule.version,
    installments: schedule.installments.map((row) => {
      const paid = installmentPaid.get(row.id) ?? ZERO;
      return {
        id: row.id,
        sequence: row.sequence,
        label: row.label,
        type: row.type,
        amount: toAmountString(row.amount),
        currency: row.currency,
        dueDate: businessDateString(row.dueDate),
        notes: row.notes,
        paidAmount: toAmountString(paid),
        outstandingAmount: toAmountString(outstanding(row.amount, paid)),
        // A schedule of a contract no longer in force is shown as it now stands.
        status: installmentStatus({ scheduleStatus: live ? schedule.status : schedule.status === "ACTIVE" ? "CANCELLED" : schedule.status, amount: row.amount, paid, dueDate: row.dueDate, today }),
        invoice: caps.canSeeInvoices ? (row.invoices[0] ?? null) : null,
      };
    }),
  }));

  let payments: ContractPaymentDTO[] = [];
  if (caps.canSeePayments) {
    const rows = await prisma.payment.findMany({
      where: { companyId: context.companyId, contractId: contract.id },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: { id: true, paymentDate: true, amount: true, currency: true, method: true, reference: true, notes: true, status: true, voidReason: true, replacesPaymentId: true, allocations: { orderBy: { createdAt: "asc" }, select: { id: true, installmentId: true, amount: true, reversedAt: true, reversalReason: true, installment: { select: { label: true, schedule: { select: { versionNumber: true } } } } } } },
    });
    const allocated = await allocatedByPayment(rows.map((row) => row.id));
    payments = rows.map((row) => ({
      id: row.id,
      paymentDate: businessDateString(row.paymentDate),
      amount: toAmountString(row.amount),
      currency: row.currency,
      method: row.method,
      reference: row.reference,
      notes: row.notes,
      status: row.status,
      voidReason: row.voidReason,
      allocatedAmount: toAmountString(allocated.get(row.id) ?? ZERO),
      unallocatedAmount: toAmountString(outstanding(row.amount, allocated.get(row.id) ?? ZERO)),
      replacesPaymentId: row.replacesPaymentId,
      allocations: row.allocations.map((allocation) => ({ id: allocation.id, installmentId: allocation.installmentId, label: allocation.installment ? `${allocation.installment.label} (v${allocation.installment.schedule.versionNumber})` : "Allocation", amount: toAmountString(allocation.amount), reversed: allocation.reversedAt !== null, reversalReason: allocation.reversalReason })),
    }));
  }

  let documents: UnitFinanceDTO["documents"] = [];
  if (caps.canSeeDocuments && payments.length) {
    const rows = await prisma.document.findMany({
      where: { companyId: context.companyId, entityType: "payment", entityId: { in: payments.map((row) => row.id) }, status: "ACTIVE", archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, entityId: true, createdAt: true },
    });
    documents = rows.map((row) => ({ id: row.id, name: row.name, paymentId: row.entityId!, createdAt: row.createdAt.toISOString() }));
  }

  let invoices: UnitFinanceDTO["invoices"] = [];
  if (caps.canSeeInvoices) {
    const rows = await prisma.invoice.findMany({ where: { companyId: context.companyId, contractId: contract.id }, orderBy: { issueDate: "desc" }, select: { id: true, invoiceNumber: true, status: true, totalAmount: true, dueDate: true, installment: { select: { label: true } } } });
    const paid = await paidByInvoice(rows.map((row) => row.id));
    invoices = rows.map((row) => ({ id: row.id, invoiceNumber: row.invoiceNumber, status: row.status, totalAmount: toAmountString(row.totalAmount), paidAmount: toAmountString(paid.get(row.id) ?? ZERO), outstandingAmount: toAmountString(outstanding(row.totalAmount, paid.get(row.id) ?? ZERO)), dueDate: businessDateString(row.dueDate), installmentLabel: row.installment?.label ?? null }));
  }

  return {
    ...base,
    summary: live ? summaryDTO(unit.id, contract, facts) : summaryDTO(unit.id, null, null),
    scheduleTarget: target === null ? null : toAmountString(target),
    contractStatusAllowsActivation: live && ["SIGNED", "ACTIVE"].includes(contract.status),
    schedules: scheduleDTOs,
    payments,
    invoices,
    documents,
  };
}

/** The schedules of a sale contract (§59). */
export async function listContractSchedules(context: UserContext, contractId: string): Promise<ScheduleDTO[]> {
  const contract = await findFinanceContract(context, contractId);
  const unit = firstUnit(contract);
  return (await getUnitFinance(context, unit.unitId)).schedules;
}

export async function getPaymentSchedule(context: UserContext, scheduleId: string): Promise<ScheduleDTO> {
  const { contract } = await findSchedule(context, scheduleId);
  const schedules = await listContractSchedules(context, contract.id);
  const schedule = schedules.find((row) => row.id === scheduleId);
  if (!schedule) throw fail("SCHEDULE_NOT_FOUND", "That payment schedule could not be found.", "NOT_FOUND");
  return schedule;
}

/* Schedules (§18-§25, §76, §84) --------------------------------------------------------- */

async function findSchedule(context: UserContext, scheduleId: string) {
  const row = await prisma.paymentSchedule.findFirst({ where: { companyId: context.companyId, id: scheduleId }, select: { id: true, contractId: true } });
  if (!row) throw fail("SCHEDULE_NOT_FOUND", "That payment schedule could not be found.", "NOT_FOUND");
  const contract = await findFinanceContract(context, row.contractId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") throw fail("SCHEDULE_NOT_FOUND", "That payment schedule could not be found.", "NOT_FOUND");
    throw error;
  });
  return { scheduleId: row.id, contract };
}

type InstallmentInput = z.infer<typeof createScheduleSchema>["installments"][number];

function installmentRows(context: UserContext, contractId: string, scheduleId: string, currency: string, installments: InstallmentInput[]): Prisma.PaymentInstallmentCreateManyInput[] {
  return installments.map((row, index) => ({
    companyId: context.companyId,
    contractId,
    scheduleId,
    sequence: index + 1,
    label: row.label,
    type: row.type,
    amount: new Prisma.Decimal(row.amount),
    currency,
    dueDate: row.dueDate,
    notes: row.notes,
  }));
}

function staleSchedule() {
  return fail("SCHEDULE_STALE", "This payment schedule was changed by another user. Refresh before continuing.", "CONFLICT");
}

export async function createPaymentSchedule(context: UserContext, contractId: string, input: z.infer<typeof createScheduleSchema>): Promise<{ scheduleId: string }> {
  const contract = await findFinanceContract(context, contractId);
  assertPermission(context, "project.unit.finance.manage_schedule");

  return runInTransaction("finance.unit.schedule.create", async (tx) => {
    const locked = await lockContract(tx, context, contract);
    assertOpenContract(locked.status);
    if (!locked.currency || locked.contractValue === null) throw fail("CONTRACT_VALUE_MISSING", "This contract has no value and currency yet, so there is nothing to schedule.", "CONFLICT");
    const draft = await tx.paymentSchedule.findFirst({ where: { companyId: context.companyId, contractId: contract.id, status: "DRAFT" }, select: { id: true } });
    if (draft) throw fail("SCHEDULE_DRAFT_EXISTS", "This contract already has a draft schedule. Edit that one.", "CONFLICT");
    const last = await tx.paymentSchedule.findFirst({ where: { companyId: context.companyId, contractId: contract.id }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
    const versionNumber = (last?.versionNumber ?? 0) + 1;

    const schedule = await tx.paymentSchedule.create({
      data: { companyId: context.companyId, contractId: contract.id, versionNumber, status: "DRAFT", currency: locked.currency, notes: input.notes, createdByMemberId: context.membershipId },
      select: { id: true },
    });
    await tx.paymentInstallment.createMany({ data: installmentRows(context, contract.id, schedule.id, locked.currency, input.installments) });

    const total = sumAmounts(input.installments.map((row) => row.amount));
    await unitActivity(tx, context, contract, "PAYMENT_SCHEDULE_CREATED", `drafted payment schedule v${versionNumber} for contract ${contract.contractNumber}`);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PAYMENT_SCHEDULE_CREATED,
        entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
        projectId: contract.projectId,
        after: { scheduleId: schedule.id, contractId: contract.id, versionNumber, total: toAmountString(total), currency: locked.currency, installments: input.installments.length },
      },
      { tx },
    );
    return { scheduleId: schedule.id };
  });
}

/** A draft is edited as a whole: its installments are replaced, in order (§21). */
export async function updatePaymentSchedule(context: UserContext, scheduleId: string, input: z.infer<typeof updateScheduleSchema>): Promise<{ version: number }> {
  const { contract } = await findSchedule(context, scheduleId);
  assertPermission(context, "project.unit.finance.manage_schedule");

  return runInTransaction("finance.unit.schedule.update", async (tx) => {
    const locked = await lockContract(tx, context, contract);
    assertOpenContract(locked.status);
    const schedule = await tx.paymentSchedule.findFirstOrThrow({ where: { companyId: context.companyId, id: scheduleId }, select: { id: true, status: true, currency: true, version: true } });
    if (schedule.status !== "DRAFT") throw fail("SCHEDULE_NOT_DRAFT", "Only a draft schedule is edited. Revise the active one as a new version.", "CONFLICT");
    if (input.expectedVersion !== undefined && schedule.version !== input.expectedVersion) throw staleSchedule();

    const saved = await tx.paymentSchedule.updateMany({
      where: { companyId: context.companyId, id: schedule.id, status: "DRAFT", version: schedule.version },
      data: { notes: input.notes, updatedByMemberId: context.membershipId, version: { increment: 1 } },
    });
    if (!saved.count) throw staleSchedule();
    await tx.paymentInstallment.deleteMany({ where: { companyId: context.companyId, scheduleId: schedule.id } });
    await tx.paymentInstallment.createMany({ data: installmentRows(context, contract.id, schedule.id, schedule.currency, input.installments) });
    return { version: schedule.version + 1 };
  });
}

async function moveSchedule(tx: Tx, context: UserContext, schedule: { id: string; status: PaymentScheduleStatus }, action: PaymentScheduleAction, input: { reason?: string | null; data?: Record<string, unknown>; expectedVersion?: number }) {
  await applyTransition(tx, {
    machine: paymentScheduleMachine,
    action,
    id: schedule.id,
    context,
    from: schedule.status,
    reason: input.reason,
    expectedVersion: input.expectedVersion,
    data: { ...input.data, updatedByMemberId: context.membershipId },
  });
}

/**
 * Puts a draft in force (§24, §76, §84). Its installments must add up to what
 * the contract still needs — the value less everything collected — unless
 * somebody holding the correction grant gives a reason. The schedule in force is
 * superseded in the same transaction and keeps its paid history.
 */
export async function activatePaymentSchedule(context: UserContext, scheduleId: string, input: z.infer<typeof activateScheduleSchema>): Promise<{ supersededScheduleId: string | null }> {
  const { contract } = await findSchedule(context, scheduleId);
  assertPermission(context, "project.unit.finance.manage_schedule");

  return runInTransaction("finance.unit.schedule.activate", async (tx) => {
    const locked = await lockContract(tx, context, contract);
    assertOpenContract(locked.status);
    if (!["SIGNED", "ACTIVE"].includes(locked.status)) throw fail("CONTRACT_NOT_SIGNED", "A payment schedule is activated once the contract is signed.", "CONFLICT");
    const schedule = await tx.paymentSchedule.findFirstOrThrow({ where: { companyId: context.companyId, id: scheduleId }, select: { id: true, status: true, versionNumber: true, version: true, currency: true, installments: { select: { amount: true } } } });
    if (schedule.status !== "DRAFT") throw fail("SCHEDULE_NOT_DRAFT", "Only a draft schedule can be activated.", "CONFLICT");
    if (input.expectedVersion !== undefined && schedule.version !== input.expectedVersion) throw staleSchedule();
    if (schedule.installments.length === 0) throw fail("SCHEDULE_EMPTY", "Add at least one installment before activating the schedule.", "VALIDATION_ERROR");

    const today = await companyToday(context.companyId);
    const target = await scheduleTargetFor(tx, context.companyId, contract.id, today);
    const total = sumAmounts(schedule.installments.map((row) => row.amount));
    let exceptionReason: string | null = null;
    if (!total.equals(target)) {
      if (!input.exceptionReason) {
        throw fail("SCHEDULE_TOTAL_MISMATCH", `Payment schedule total does not match the Contract value. The installments add up to ${money(total, schedule.currency)} and the contract still needs ${money(target, schedule.currency)}.`, "VALIDATION_ERROR", { total: toAmountString(total), target: toAmountString(target) });
      }
      assertPermission(context, "project.unit.finance.correct");
      exceptionReason = input.exceptionReason;
    }

    return trackingStatus(tx, context, contract, async () => {
      const current = await tx.paymentSchedule.findFirst({ where: { companyId: context.companyId, contractId: contract.id, status: "ACTIVE" }, select: { id: true, status: true, versionNumber: true } });
      if (current) {
        await moveSchedule(tx, context, current, "supersede", { data: { supersededAt: new Date(), supersededByScheduleId: schedule.id } });
        await recordUserAction(
          context,
          {
            actionKey: AuditAction.PAYMENT_SCHEDULE_SUPERSEDED,
            entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
            projectId: contract.projectId,
            before: { scheduleId: current.id, status: "ACTIVE" },
            after: { scheduleId: current.id, contractId: contract.id, versionNumber: current.versionNumber, status: "SUPERSEDED", supersededByScheduleId: schedule.id },
          },
          { tx },
        );
      }
      await moveSchedule(tx, context, schedule, "activate", { expectedVersion: schedule.version, data: { activatedAt: new Date(), activatedByMemberId: context.membershipId, totalExceptionReason: exceptionReason, totalExceptionByMemberId: exceptionReason ? context.membershipId : null } });
      await unitActivity(tx, context, contract, "PAYMENT_SCHEDULE_ACTIVATED", current ? `activated payment schedule v${schedule.versionNumber} for contract ${contract.contractNumber}, replacing v${current.versionNumber}` : `activated payment schedule v${schedule.versionNumber} for contract ${contract.contractNumber}`);
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PAYMENT_SCHEDULE_ACTIVATED,
          entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
          projectId: contract.projectId,
          before: { scheduleId: schedule.id, status: "DRAFT" },
          after: { scheduleId: schedule.id, contractId: contract.id, versionNumber: schedule.versionNumber, status: "ACTIVE", total: toAmountString(total), target: toAmountString(target), currency: schedule.currency, totalExceptionReason: exceptionReason },
        },
        { tx },
      );
      return { supersededScheduleId: current?.id ?? null };
    });
  });
}

export async function discardPaymentSchedule(context: UserContext, scheduleId: string, input: z.infer<typeof discardScheduleSchema>): Promise<void> {
  const { contract } = await findSchedule(context, scheduleId);
  assertPermission(context, "project.unit.finance.manage_schedule");
  await runInTransaction("finance.unit.schedule.discard", async (tx) => {
    await lockContract(tx, context, contract);
    const schedule = await tx.paymentSchedule.findFirstOrThrow({ where: { companyId: context.companyId, id: scheduleId }, select: { id: true, status: true, versionNumber: true, version: true } });
    if (schedule.status !== "DRAFT") throw fail("SCHEDULE_NOT_DRAFT", "Only a draft schedule can be discarded.", "CONFLICT");
    await moveSchedule(tx, context, schedule, "discard", { expectedVersion: input.expectedVersion, data: { cancelledAt: new Date(), cancelledByMemberId: context.membershipId, cancelReason: input.reason } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PAYMENT_SCHEDULE_CANCELLED,
        entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
        projectId: contract.projectId,
        before: { scheduleId: schedule.id, status: "DRAFT" },
        after: { scheduleId: schedule.id, contractId: contract.id, versionNumber: schedule.versionNumber, status: "CANCELLED", reason: input.reason },
      },
      { tx },
    );
  });
}

/* Invoices (§26, §61) ------------------------------------------------------------------ */

/**
 * Raises the invoice for one installment of the active schedule (§26): a draft
 * in the Finance module's own workflow, for the installment's amount, billing the
 * contract's client on its project. Money already allocated to the installment
 * is linked to it, so the invoice shows what is paid.
 */
export async function issueInstallmentInvoice(context: UserContext, installmentId: string, input: z.infer<typeof issueInvoiceSchema>): Promise<{ invoiceId: string }> {
  const row = await prisma.paymentInstallment.findFirst({ where: { companyId: context.companyId, id: installmentId }, select: { contractId: true } });
  if (!row) throw fail("INSTALLMENT_NOT_FOUND", "That installment could not be found.", "NOT_FOUND");
  const contract = await findFinanceContract(context, row.contractId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") throw fail("INSTALLMENT_NOT_FOUND", "That installment could not be found.", "NOT_FOUND");
    throw error;
  });
  assertPermission(context, "project.unit.finance.issue_invoice");
  assertPermission(context, "finance.invoice.create");
  if (!contract.clientId || !contract.projectId) throw fail("CONTRACT_INCOMPLETE", "This contract has no client or project to invoice.", "CONFLICT");
  const settings = await resolveFinanceSettings(context.companyId);

  return runInTransaction("finance.unit.invoice.issue", async (tx) => {
    const locked = await lockContract(tx, context, contract);
    assertOpenContract(locked.status);
    const installment = await tx.paymentInstallment.findFirstOrThrow({ where: { companyId: context.companyId, id: installmentId }, select: { id: true, label: true, type: true, amount: true, currency: true, dueDate: true, sequence: true, schedule: { select: { status: true, versionNumber: true } } } });
    if (installment.schedule.status !== "ACTIVE") throw fail("SCHEDULE_NOT_ACTIVE", "Invoices are raised for installments of the active payment schedule.", "CONFLICT");
    const live = await tx.invoice.findFirst({ where: { companyId: context.companyId, installmentId: installment.id, status: { notIn: ["CANCELLED", "ARCHIVED"] } }, select: { invoiceNumber: true } });
    if (live) throw fail("INSTALLMENT_ALREADY_INVOICED", `This installment is already invoiced on ${live.invoiceNumber}.`, "CONFLICT");

    const issueDate = input.issueDate ?? new Date();
    const dueDate = input.dueDate ?? (installment.dueDate.getTime() > issueDate.getTime() ? installment.dueDate : new Date(issueDate.getTime() + settings.defaultPaymentTermsDays * 86_400_000));
    const invoice = await createInstallmentInvoiceRecord(tx, context, {
      clientId: contract.clientId!,
      projectId: contract.projectId!,
      contractId: contract.id,
      installmentId: installment.id,
      issueDate,
      dueDate,
      currency: installment.currency,
      description: `${installment.label} — contract ${contract.contractNumber}`,
      amount: installment.amount,
      notes: `Installment ${installment.sequence} of payment schedule v${installment.schedule.versionNumber}, contract ${contract.contractNumber}.`,
    });
    // What was already paid against the installment settles its invoice too (§26).
    await tx.paymentAllocation.updateMany({ where: { companyId: context.companyId, installmentId: installment.id, invoiceId: null }, data: { invoiceId: invoice.id } });

    await unitActivity(tx, context, contract, "INVOICE_ISSUED", `raised invoice ${invoice.invoiceNumber} for ${installment.label} of contract ${contract.contractNumber}`);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.INVOICE_ISSUED,
        entity: { type: "Invoice", id: invoice.id, label: invoice.invoiceNumber },
        projectId: contract.projectId,
        after: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, contractId: contract.id, installmentId: installment.id, totalAmount: toAmountString(installment.amount), currency: installment.currency, status: "DRAFT" },
      },
      { tx },
    );
    return { invoiceId: invoice.id };
  });
}

/* Payments (§29-§34, §62, §63, §77-§81) ----------------------------------------------------- */

export class DuplicatePaymentError extends AccessError {
  constructor(matches: Array<{ id: string; paymentDate: string; amount: string; reference: string | null }>) {
    super("CONFLICT", "A payment with the same amount and date is already recorded on this contract. Check it is not the same money before recording it again.", { code: "DUPLICATE_PAYMENT", matches });
  }
}

/**
 * Records money received against a sale contract and allocates it, in one
 * transaction (§77): the payment, each allocation — refused beyond what the
 * payment holds or an installment owes (§79, §80) — the financial status, audit,
 * activity and notices. What is not allocated stays on the payment as
 * unallocated for Finance to review, never lost (§34).
 */
export async function recordContractPayment(context: UserContext, contractId: string, input: z.infer<typeof recordContractPaymentSchema>): Promise<{ paymentId: string; unallocated: string }> {
  const contract = await findFinanceContract(context, contractId);
  assertPermission(context, "project.unit.finance.record_payment");
  assertPermission(context, "finance.payment.create");
  if (input.allocations.length > 0) assertPermission(context, "project.unit.finance.allocate_payment");
  if (!contract.clientId) throw fail("CONTRACT_INCOMPLETE", "This contract has no client to record a payment from.", "CONFLICT");
  const seen = new Set<string>();
  for (const row of input.allocations) {
    if (seen.has(row.installmentId)) throw new AccessError("VALIDATION_ERROR", "Allocate to each installment once.", { allocations: ["Allocate to each installment once."] });
    seen.add(row.installmentId);
  }

  return runInTransaction("finance.unit.payment.record", async (tx) => {
    const locked = await lockContract(tx, context, contract);
    assertOpenContract(locked.status);
    if (!isCollecting(locked.status)) throw fail("CONTRACT_NOT_SIGNED", "Payments are recorded against a signed contract.", "CONFLICT");
    const amount = new Prisma.Decimal(input.amount);

    // Double payment protection (§78): the same money on the same day, warned about — never blocked for being the same amount alone.
    if (!input.acceptDuplicate) {
      const matches = await tx.payment.findMany({
        where: { companyId: context.companyId, contractId: contract.id, status: "RECORDED", amount, paymentDate: input.paymentDate, ...(input.reference ? { reference: input.reference } : {}) },
        select: { id: true, paymentDate: true, amount: true, reference: true },
        take: 5,
      });
      if (matches.length > 0) throw new DuplicatePaymentError(matches.map((row) => ({ id: row.id, paymentDate: businessDateString(row.paymentDate), amount: toAmountString(row.amount), reference: row.reference })));
    }
    if (input.replacesPaymentId) {
      const replaced = await tx.payment.findFirst({ where: { companyId: context.companyId, id: input.replacesPaymentId, contractId: contract.id }, select: { status: true } });
      if (!replaced) throw new AccessError("VALIDATION_ERROR", "That payment is not one of this contract's.", { replacesPaymentId: ["Choose a payment of this contract."] });
      if (replaced.status !== "VOIDED") throw fail("PAYMENT_NOT_VOIDED", "Only a voided payment is replaced. Void it first, with a reason.", "CONFLICT");
    }

    return trackingStatus(tx, context, contract, async () => {
      const payment = await tx.payment.create({
        data: {
          companyId: context.companyId,
          direction: "RECEIPT",
          clientId: contract.clientId,
          contractId: contract.id,
          projectId: contract.projectId,
          amount,
          currency: locked.currency ?? "EUR",
          paymentDate: input.paymentDate,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          replacesPaymentId: input.replacesPaymentId ?? null,
          status: "RECORDED",
          createdByMemberId: context.membershipId,
        },
        select: { id: true },
      });
      const held = await lockPayment(tx, context.companyId, payment.id);
      for (const row of input.allocations) await allocate(tx, context, held, { installmentId: row.installmentId }, row.amount);
      const unallocated = outstanding(amount, sumAmounts(input.allocations.map((row) => row.amount)));

      await unitActivity(tx, context, contract, "PAYMENT_RECORDED", `recorded a payment of ${money(amount, held.currency)} against contract ${contract.contractNumber}`);
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.FINANCE_PAYMENT_RECORDED,
          entity: { type: "Payment", id: payment.id, label: contract.contractNumber },
          projectId: contract.projectId,
          after: { amount: amount.toString(), currency: held.currency, direction: "RECEIPT", status: "RECORDED" },
        },
        { tx },
      );
      await notifyFinance(tx, context, { eventType: NotificationEvent.UNIT_PAYMENT_RECEIVED, companyId: context.companyId, contract, memberIds: await saleAudience(tx, context.companyId, contract.units.map((row) => row.unitId)), amountLabel: money(amount, held.currency), paymentId: payment.id });
      return { paymentId: payment.id, unallocated: toAmountString(unallocated) };
    });
  });
}

async function findContractPayment(context: UserContext, paymentId: string) {
  const row = await prisma.payment.findFirst({ where: { companyId: context.companyId, id: paymentId }, select: { id: true, contractId: true } });
  if (!row?.contractId) throw fail("PAYMENT_NOT_FOUND", "That payment could not be found.", "NOT_FOUND");
  const contract = await findFinanceContract(context, row.contractId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") throw fail("PAYMENT_NOT_FOUND", "That payment could not be found.", "NOT_FOUND");
    throw error;
  });
  return { paymentId: row.id, contract };
}

/** Allocates what is still unallocated on a contract payment (§31, §34, §63). */
export async function allocateContractPayment(context: UserContext, paymentId: string, input: z.infer<typeof allocatePaymentSchema>): Promise<{ unallocated: string }> {
  const { contract } = await findContractPayment(context, paymentId);
  assertPermission(context, "project.unit.finance.allocate_payment");
  assertPermission(context, "finance.payment.create");

  return runInTransaction("finance.unit.payment.allocate", async (tx) => {
    const held = await lockPayment(tx, context.companyId, paymentId);
    const locked = await lockContract(tx, context, contract);
    assertOpenContract(locked.status);
    return trackingStatus(tx, context, contract, async () => {
      for (const row of input.allocations) await allocate(tx, context, held, { installmentId: row.installmentId }, row.amount);
      const allocated = (await allocatedByPayment([held.id], tx)).get(held.id) ?? ZERO;
      await unitActivity(tx, context, contract, "PAYMENT_ALLOCATED", `allocated ${money(sumAmounts(input.allocations.map((row) => row.amount)), held.currency)} of a payment on contract ${contract.contractNumber}`);
      return { unallocated: toAmountString(outstanding(held.amount, allocated)) };
    });
  });
}

/** Reverses one allocation of a contract payment, with a reason (§63, §81). Elevated. */
export async function reverseContractAllocation(context: UserContext, allocationId: string, input: z.infer<typeof reverseAllocationSchema>): Promise<void> {
  const row = await prisma.paymentAllocation.findFirst({ where: { companyId: context.companyId, id: allocationId }, select: { paymentId: true } });
  if (!row) throw fail("ALLOCATION_NOT_FOUND", "That allocation could not be found.", "NOT_FOUND");
  const { contract } = await findContractPayment(context, row.paymentId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") throw fail("ALLOCATION_NOT_FOUND", "That allocation could not be found.", "NOT_FOUND");
    throw error;
  });
  assertPermission(context, "project.unit.finance.correct");

  await runInTransaction("finance.unit.allocation.reverse", async (tx) => {
    await trackingStatus(tx, context, contract, async () => {
      await reverseAllocation(tx, context, allocationId, input.reason);
      await unitActivity(tx, context, contract, "PAYMENT_ALLOCATION_CORRECTED", `reversed an allocation of a payment on contract ${contract.contractNumber}`);
    });
  });
}

/* Doors for Legal (§82, §83) ---------------------------------------------------------------- */

/**
 * The contract's schedules end with it (§82): a cancelled or terminated sale
 * contract cancels its draft and active schedules, keeping every installment,
 * payment and allocation as history. Payments are never deleted.
 */
export async function cancelSchedulesWithContract(tx: Tx, context: UserContext, contract: { id: string; contractNumber: string; projectId: string | null }, reason: string): Promise<string[]> {
  const schedules = await tx.paymentSchedule.findMany({ where: { companyId: context.companyId, contractId: contract.id, status: { in: ["DRAFT", "ACTIVE"] } }, select: { id: true, status: true, versionNumber: true } });
  for (const schedule of schedules) {
    await moveSchedule(tx, context, schedule, "cancel_with_contract", { reason, data: { cancelledAt: new Date(), cancelledByMemberId: context.membershipId, cancelReason: reason } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PAYMENT_SCHEDULE_CANCELLED,
        entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
        projectId: contract.projectId,
        before: { scheduleId: schedule.id, status: schedule.status },
        after: { scheduleId: schedule.id, contractId: contract.id, versionNumber: schedule.versionNumber, status: "CANCELLED", reason },
      },
      { tx },
    );
  }
  return schedules.map((schedule) => schedule.id);
}

/** Whether a sale contract is financially complete, read inside the caller's transaction (§41, §83). */
export async function contractFinancialStatus(tx: Tx, companyId: string, contractId: string): Promise<ContractFacts | null> {
  return (await contractFinanceFacts(tx, companyId, [contractId], await companyToday(companyId))).get(contractId) ?? null;
}

/** Completing the contract completes the schedule it was paid by (§20, §83). */
export async function completeScheduleWithContract(tx: Tx, context: UserContext, contractId: string): Promise<void> {
  const schedule = await tx.paymentSchedule.findFirst({ where: { companyId: context.companyId, contractId, status: "ACTIVE" }, select: { id: true, status: true } });
  if (schedule) await moveSchedule(tx, context, schedule, "complete_with_contract", { data: { completedAt: new Date() } });
}

import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { toAmountString } from "../finance.money";
import { companyToday, contractFinanceFacts, findFinanceContract, type ContractFacts, type FinanceContract } from "./unit-finance.core";

/**
 * What a change to a sale contract's money leaves behind (E-05F §94, §97, §98):
 * activity on every unit the contract sells, the unit's financial status when it
 * moves, and the notices for the people who act on it — never every holder of a
 * finance grant.
 */

type Tx = Prisma.TransactionClient;
const MODULE = "finance";
const UNIT_ENTITY = "ProjectUnit";

export function money(value: Prisma.Decimal.Value, currency: string): string {
  return `${currency} ${Number(new Prisma.Decimal(value).toFixed(2)).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Evidence on every unit the contract sells, so each unit's Activity tells the same story (§98). */
export async function unitActivity(tx: Tx, context: UserContext, contract: FinanceContract, action: string, message: string) {
  for (const unit of contract.units.filter((row) => !row.released)) {
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.unitId, action, message, metadata: { projectId: unit.projectId, contractId: contract.id } });
  }
}

export function firstUnit(contract: FinanceContract) {
  return contract.units.find((row) => !row.released) ?? contract.units[0]!;
}

/** The salesperson and the deal owner of the units on a contract (E-05E §52). */
export async function saleAudience(client: Tx | typeof prisma, companyId: string, unitIds: string[]): Promise<string[]> {
  const reservations = await client.unitReservation.findMany({
    where: { companyId, unitId: { in: unitIds }, status: { in: ["ACTIVE", "CONVERTED_TO_SALE"] } },
    select: { createdByMemberId: true, opportunity: { select: { ownerMemberId: true } } },
  });
  return [...new Set(reservations.flatMap((row) => [row.createdByMemberId, row.opportunity.ownerMemberId]))];
}

export async function notifyFinance(
  tx: Tx,
  context: UserContext | null,
  input: { eventType: (typeof NotificationEvent)["UNIT_PAYMENT_RECEIVED" | "UNIT_FINANCIALLY_COMPLETE"]; companyId: string; contract: FinanceContract; memberIds: string[]; amountLabel?: string; paymentId?: string },
) {
  const actor = context?.membershipId ?? null;
  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== actor);
  if (memberIds.length === 0) return;
  const unit = firstUnit(input.contract);
  await enqueueNotificationEvent(tx, {
    companyId: input.companyId,
    eventType: input.eventType,
    moduleKey: "projects",
    entityType: "project_unit",
    entityId: unit.unitId,
    actorMemberId: actor,
    projectId: unit.projectId,
    payload: { memberIds, unitCode: input.contract.units.filter((row) => !row.released).map((row) => row.unitCode).join(", ") || unit.unitCode, contractNumber: input.contract.contractNumber, contractId: input.contract.id, amountLabel: input.amountLabel ?? null, paymentId: input.paymentId ?? null },
  });
}

/**
 * Runs a change to a contract's money and records the unit's financial status
 * if the change moved it (§97): computed before and after, inside the same
 * transaction, so the audit trail says exactly when a sale became overdue,
 * paid or complete.
 */
export async function trackingStatus<T>(tx: Tx, context: UserContext, contract: FinanceContract, change: () => Promise<T>): Promise<T> {
  const today = await companyToday(context.companyId);
  const before = (await contractFinanceFacts(tx, context.companyId, [contract.id], today)).get(contract.id);
  const result = await change();
  const after = (await contractFinanceFacts(tx, context.companyId, [contract.id], today)).get(contract.id);
  if (before && after && before.financialStatus !== after.financialStatus) {
    await recordStatusChange(tx, context, contract, before, after);
  }
  return result;
}

export async function recordStatusChange(tx: Tx, context: UserContext, contract: FinanceContract, before: ContractFacts, after: ContractFacts) {
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.UNIT_FINANCIAL_STATUS_CHANGED,
      entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
      projectId: contract.projectId,
      before: { contractId: contract.id, financialStatus: before.financialStatus, paid: toAmountString(before.paid), outstanding: toAmountString(before.outstanding), overdue: toAmountString(before.overdue), currency: before.currency },
      after: { contractId: contract.id, financialStatus: after.financialStatus, paid: toAmountString(after.paid), outstanding: toAmountString(after.outstanding), overdue: toAmountString(after.overdue), currency: after.currency },
    },
    { tx },
  );
  if (after.financialStatus === "FINANCIALLY_COMPLETE") {
    await unitActivity(tx, context, contract, "UNIT_FINANCIALLY_COMPLETE", `recorded contract ${contract.contractNumber} as paid in full`);
    await notifyFinance(tx, context, { eventType: NotificationEvent.UNIT_FINANCIALLY_COMPLETE, companyId: context.companyId, contract, memberIds: [contract.ownerMemberId, ...(await saleAudience(tx, context.companyId, contract.units.map((row) => row.unitId)))] });
  }
}

/** The figures of a contract before its payment is voided, to compare with after (§81, §97). */
export async function contractFactsBeforeVoid(companyId: string, contractId: string): Promise<ContractFacts | undefined> {
  return (await contractFinanceFacts(prisma, companyId, [contractId], await companyToday(companyId))).get(contractId);
}

/** After a contract payment is voided, the unit's financial status may have moved; this records it (§81, §97). */
export async function recordStatusAfterVoid(context: UserContext, contractId: string, before: ContractFacts | undefined): Promise<void> {
  const contract = await findFinanceContract(context, contractId);
  await prisma.$transaction(async (tx) => {
    await unitActivity(tx, context, contract, "PAYMENT_VOIDED", `voided a payment on contract ${contract.contractNumber}`);
    const after = (await contractFinanceFacts(tx, context.companyId, [contract.id], await companyToday(context.companyId))).get(contract.id);
    if (before && after && before.financialStatus !== after.financialStatus) await recordStatusChange(tx, context, contract, before, after);
  });
}

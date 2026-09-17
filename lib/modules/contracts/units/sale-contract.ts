import type { ContractStatus, Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { cancelSchedulesWithContract, completeScheduleWithContract } from "@/lib/modules/finance/units/unit-finance.service";
import { readableUnitWhere, structureOpen } from "@/lib/modules/project-structure/structure.permissions";
import { findReadableUnit } from "@/lib/modules/project-structure/structure.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import type { ContractAction } from "../contracts/contract.machine";
import { UNIT_CONTRACT_STATUS_LABELS, type UnitLegalCapabilities } from "./unit-contract.types";

/**
 * A sale contract is Legal's canonical Contract selling one or more units
 * (E-05F §7, §11, §88). What makes it different from any other contract lives
 * here, and the contract service asks it at every move:
 *
 *   the unit grant beside Legal's own — sending a sale contract for review,
 *   recording its signature, cancelling it — so a Legal reader who may not open
 *   the unit cannot act on its sale (§55, §99);
 *
 *   what the move means for the units: cancelling, terminating or letting it
 *   expire releases them and cancels the contract's payment schedules, keeping
 *   every payment (§82); signing tells the salesperson that the Sold rule may now
 *   be met (§44); each move is audited and written on every unit's Activity
 *   (§97, §98).
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export const SALE_AGREEMENT = "SALE_AGREEMENT";
const MODULE = "contracts";
const UNIT_ENTITY = "ProjectUnit";

/** The unit grant each contract move needs on a sale contract. Deciding an approval is Legal's approval grant alone. */
const SALE_GRANTS: Partial<Record<ContractAction, Permission>> = {
  submit_review: "project.unit.contract.review",
  return_to_draft: "project.unit.contract.review",
  submit_approval: "project.unit.contract.review",
  mark_sent: "project.unit.contract.sign_status",
  mark_signed: "project.unit.contract.sign_status",
  activate: "project.unit.contract.sign_status",
  complete: "project.unit.contract.sign_status",
  expire: "project.unit.contract.cancel",
  terminate: "project.unit.contract.cancel",
  cancel: "project.unit.contract.cancel",
  archive: "project.unit.contract.cancel",
  restore: "project.unit.contract.cancel",
};

/** Moves that end the contract's hold on its units (§8, §82). */
const RELEASING: ContractAction[] = ["cancel", "terminate", "expire"];

export function legalCapabilities(context: UserContext): UnitLegalCapabilities {
  const open = structureOpen(context);
  const has = (permission: Permission) => open && can(context, permission);
  // A company with Contracts switched off has no unit contracts, whatever the unit grants say (PRD #47 §25).
  const view = isModuleEnabled(context, "contracts") && has("project.unit.legal.view");
  const legal = canAccessModule(context, "contracts");
  return {
    canView: view,
    canRequest: view && has("project.unit.contract.request"),
    canCreate: view && has("project.unit.contract.create") && legal && can(context, "legal.contract.create"),
    canUpdate: view && has("project.unit.contract.update") && legal && can(context, "legal.contract.update"),
    canReview: view && has("project.unit.contract.review") && legal,
    canSignStatus: view && has("project.unit.contract.sign_status") && legal,
    canCancel: view && has("project.unit.contract.cancel") && legal,
    canManageDocuments: view && has("project.unit.contract.documents.manage") && legal && can(context, "legal.document.create"),
    canAmend: view && has("project.unit.contract.amend") && legal && can(context, "legal.amendment.create"),
    canOpenContract: legal && can(context, "legal.contract.view"),
    canSeeValue: view && (can(context, "legal.commercial.view") || (isModuleEnabled(context, "finance") && can(context, "project.unit.finance.view"))),
    canSeeClients: canAccessModule(context, "clients") && can(context, "client.view"),
    canSeeDeals: canAccessModule(context, "sales") && can(context, "sales.opportunity.view"),
  };
}

/** A unit whose Legal section the reader may open (§99, §104). */
export async function findLegalUnit(context: UserContext, unitId: string) {
  const unit = await findReadableUnit(context, unitId);
  if (!legalCapabilities(context).canView) throw new AccessError("FORBIDDEN", "You cannot see this unit's contract.");
  return unit;
}

export type SaleUnit = { unitId: string; unitCode: string; projectId: string; released: boolean };

export async function saleContractUnits(client: Client, companyId: string, contractId: string): Promise<SaleUnit[]> {
  const rows = await client.contractUnit.findMany({ where: { companyId, contractId }, orderBy: { createdAt: "asc" }, select: { unitId: true, releasedAt: true, unit: { select: { unitCode: true, projectId: true } } } });
  return rows.map((row) => ({ unitId: row.unitId, unitCode: row.unit.unitCode, projectId: row.unit.projectId, released: row.releasedAt !== null }));
}

type SaleContractRef = { id: string; contractType: string; contractNumber: string; projectId: string | null; ownerMemberId: string };

/**
 * The unit grant a move needs on a sale contract, and a unit of it the reader
 * can open (§99). A contract of any other type passes untouched.
 */
export async function assertSaleContractGrant(client: Client, context: UserContext, contract: Pick<SaleContractRef, "id" | "contractType">, action: ContractAction | "update" | "amend"): Promise<void> {
  if (contract.contractType !== SALE_AGREEMENT) return;
  const permission: Permission | undefined = action === "update" ? "project.unit.contract.update" : action === "amend" ? "project.unit.contract.amend" : SALE_GRANTS[action];
  if (!permission) return;
  if (!structureOpen(context) || !can(context, permission)) {
    throw new AccessError("FORBIDDEN", "This contract sells a unit, and changing it needs the unit's contract permission as well as Legal's.", { code: "SALE_CONTRACT_GRANT_MISSING" }, "PERMISSION_DENIED");
  }
  const reachable = await client.contractUnit.count({ where: { companyId: context.companyId, contractId: contract.id, unit: { is: readableUnitWhere(context) } } });
  if (reachable === 0) throw new AccessError("FORBIDDEN", "This contract sells units of a project you cannot open.", { code: "SALE_CONTRACT_GRANT_MISSING" }, "PERMISSION_DENIED");
}

/** A draft sale contract is cancelled before it is archived, so its units are released first (§8). */
export function assertSaleContractArchivable(contract: Pick<SaleContractRef, "contractType">, status: ContractStatus): void {
  if (contract.contractType === SALE_AGREEMENT && status === "DRAFT") {
    throw new AccessError("CONFLICT", "Cancel this sale contract before archiving it, so its units are released.", { code: "SALE_CONTRACT_NOT_CLOSED" });
  }
}

/** The salesperson and deal owner of the contract's units (E-05E §52). */
async function saleAudience(client: Client, companyId: string, unitIds: string[]): Promise<string[]> {
  const rows = await client.unitReservation.findMany({
    where: { companyId, unitId: { in: unitIds }, status: { in: ["ACTIVE", "CONVERTED_TO_SALE"] } },
    select: { createdByMemberId: true, opportunity: { select: { ownerMemberId: true } } },
  });
  return [...new Set(rows.flatMap((row) => [row.createdByMemberId, row.opportunity.ownerMemberId]))];
}

async function notify(tx: Tx, context: UserContext, contract: SaleContractRef, units: SaleUnit[], eventType: (typeof NotificationEvent)["UNIT_CONTRACT_SIGNED" | "UNIT_CONTRACT_CANCELLED"], extra: { verb?: string; memberIds: string[] }) {
  const memberIds = [...new Set(extra.memberIds)].filter((id) => id !== context.membershipId);
  const first = units[0];
  if (!first || memberIds.length === 0) return;
  const project = await tx.project.findFirst({ where: { companyId: context.companyId, id: first.projectId }, select: { name: true } });
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType,
    moduleKey: "projects",
    entityType: "project_unit",
    entityId: first.unitId,
    actorMemberId: context.membershipId,
    projectId: first.projectId,
    payload: { memberIds, unitCode: units.map((unit) => unit.unitCode).join(", "), contractNumber: contract.contractNumber, contractId: contract.id, projectName: project?.name ?? null, verb: extra.verb ?? null },
  });
}

async function unitActivity(tx: Tx, context: UserContext, contract: SaleContractRef, units: SaleUnit[], action: string, message: (unitCode: string) => string) {
  for (const unit of units) {
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.unitId, action, message: message(unit.unitCode), metadata: { projectId: unit.projectId, contractId: contract.id } });
  }
}

const VERBS: Partial<Record<ContractAction, string>> = {
  submit_review: "sent sale contract %n for review",
  return_to_draft: "returned sale contract %n to draft",
  submit_approval: "submitted sale contract %n for approval",
  approve: "approved sale contract %n, ready for signature",
  reject: "rejected sale contract %n back to review",
  return_for_revision: "returned sale contract %n for revision",
  mark_sent: "sent sale contract %n for signature",
  mark_signed: "recorded sale contract %n as signed",
  activate: "activated sale contract %n",
  complete: "completed sale contract %n",
  expire: "recorded sale contract %n as expired",
  terminate: "terminated sale contract %n",
  cancel: "cancelled sale contract %n",
  archive: "archived sale contract %n",
  restore: "restored sale contract %n",
};

/**
 * What a move of a sale contract leaves behind, in the move's transaction (§75,
 * §82, §97, §98). A contract of any other type is left alone.
 */
export async function afterSaleContractMove(
  tx: Tx,
  context: UserContext,
  contract: SaleContractRef,
  move: { action: ContractAction; from: ContractStatus; to: ContractStatus; reason?: string | null; signedDate?: Date | null },
): Promise<void> {
  if (contract.contractType !== SALE_AGREEMENT) return;
  const all = await saleContractUnits(tx, context.companyId, contract.id);
  const live = all.filter((unit) => !unit.released);
  const unitIds = live.map((unit) => unit.unitId);
  const verb = VERBS[move.action] ?? `moved sale contract %n to ${UNIT_CONTRACT_STATUS_LABELS[move.to]}`;
  await unitActivity(tx, context, contract, live, `UNIT_CONTRACT_${move.action.toUpperCase()}`, () => verb.replace("%n", contract.contractNumber));

  if (RELEASING.includes(move.action)) {
    const reason = move.reason?.trim() || `Contract ${UNIT_CONTRACT_STATUS_LABELS[move.to].toLowerCase()}`;
    await tx.contractUnit.updateMany({ where: { companyId: context.companyId, contractId: contract.id, releasedAt: null }, data: { releasedAt: new Date(), releasedByMemberId: context.membershipId, releaseReason: reason } });
    const scheduleIds = await cancelSchedulesWithContract(tx, context, contract, reason);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.UNIT_CONTRACT_CANCELLED,
        entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
        projectId: contract.projectId,
        before: { contractId: contract.id, status: move.from },
        after: { contractId: contract.id, status: move.to, unitIds, reason, scheduleIds },
      },
      { tx },
    );
    await notify(tx, context, contract, live, NotificationEvent.UNIT_CONTRACT_CANCELLED, { verb: UNIT_CONTRACT_STATUS_LABELS[move.to].toLowerCase(), memberIds: [contract.ownerMemberId, ...(await saleAudience(tx, context.companyId, unitIds))] });
    return;
  }

  if (move.action === "mark_signed") {
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.UNIT_CONTRACT_SIGNED,
        entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
        projectId: contract.projectId,
        before: { contractId: contract.id, status: move.from },
        after: { contractId: contract.id, status: move.to, signedDate: move.signedDate?.toISOString().slice(0, 10) ?? null, unitIds },
      },
      { tx },
    );
    await notify(tx, context, contract, live, NotificationEvent.UNIT_CONTRACT_SIGNED, { memberIds: [contract.ownerMemberId, ...(await saleAudience(tx, context.companyId, unitIds))] });
    return;
  }

  if (move.action === "complete") {
    await completeScheduleWithContract(tx, context, contract.id);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.UNIT_CONTRACT_COMPLETED,
        entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
        projectId: contract.projectId,
        before: { contractId: contract.id, status: move.from },
        after: { contractId: contract.id, status: move.to, completedAt: new Date().toISOString(), unitIds },
      },
      { tx },
    );
    return;
  }

  await recordUserAction(
    context,
    {
      actionKey: AuditAction.UNIT_CONTRACT_STATUS_CHANGED,
      entity: { type: "Contract", id: contract.id, label: contract.contractNumber },
      projectId: contract.projectId,
      before: { contractId: contract.id, status: move.from },
      after: { contractId: contract.id, status: move.to, action: move.action },
    },
    { tx },
  );
}

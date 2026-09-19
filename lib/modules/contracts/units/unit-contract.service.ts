import { Prisma, type ContractStatus, type UnitContractRequestStatus } from "@prisma/client";

import { AccessError, assertModule, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { allocateNumber, isAutoNumbered } from "@/lib/core/numbering/numbering.service";
import { applyTransition } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere } from "@/lib/modules/project-structure/structure.permissions";
import { fail, findReadableUnit } from "@/lib/modules/project-structure/structure.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { fullName } from "@/lib/utils/format";
import { contractMachine } from "../contracts/contract.machine";
import { contractEditMode } from "../contracts/contract.status";
import { findLegalUnit, legalCapabilities, SALE_AGREEMENT } from "./sale-contract";
import { unitContractRequestMachine, type UnitContractRequestAction } from "./unit-contract-request.machine";
import type { ContractRequestQuery, contractUnitValueSchema, createUnitContractSchema, declineRequestSchema, requestContractSchema } from "./unit-contract.schema";
import {
  UNIT_CONTRACT_STATUS_LABELS,
  type ContractCandidateDTO,
  type ContractRequestDTO,
  type ContractStatusKey,
  type UnitContractAction,
  type UnitContractDTO,
  type UnitLegalCapabilities,
  type UnitLegalDTO,
} from "./unit-contract.types";
import type { z } from "zod";

/**
 * A unit's contract (E-05F §7-§17, §49, §57, §74, §88-§90, §113).
 *
 * Sales asks; Legal drafts. A salesperson requests the contract for a unit that
 * is reserved — or sold — for a client, a deal and an agreed price, and the
 * request waits in Legal's queue. Legal drafts the canonical Contract from it:
 * the client, deal and project are the reservation's, the value starts from the
 * agreed price, and other units of the same client and deal — the parking, the
 * storage — may be sold on the same contract (§88). A unit has at most one live
 * contract, held by a partial unique index as well as by the check (§8).
 *
 * Nothing here copies the unit, the client or the deal. The contract's lifecycle
 * after drafting is the Legal module's own, through its machine; what that means
 * for the units lives in `sale-contract.ts`.
 */

type Tx = Prisma.TransactionClient;
const MODULE = "contracts";
const UNIT_ENTITY = "ProjectUnit";

function moneyText(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}

async function memberNames(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, fullName(row.user.firstName, row.user.lastName)]));
}

/* The unit's standing with Sales (§13) ------------------------------------------------------ */

type Standing = {
  commercialStatus: string;
  reservation: { id: string; status: string; clientId: string; opportunityId: string; agreedPrice: Prisma.Decimal | null; currency: string | null; expiresAt: Date; createdByMemberId: string; clientName: string; dealName: string } | null;
};

const RESERVATION_SELECT = {
  id: true,
  status: true,
  clientId: true,
  opportunityId: true,
  agreedPrice: true,
  currency: true,
  expiresAt: true,
  createdByMemberId: true,
  client: { select: { name: true } },
  opportunity: { select: { name: true } },
} satisfies Prisma.UnitReservationSelect;

/**
 * The reservation a contract would be drafted from: the active one of a reserved
 * unit, or the one a sold unit's sale converted. Read from Sales' tables, never
 * written here.
 */
async function standingOf(client: Tx | typeof prisma, companyId: string, unitId: string): Promise<Standing> {
  const profile = await client.unitCommercialProfile.findFirst({ where: { companyId, unitId }, select: { status: true } });
  const status = profile?.status ?? "NOT_FOR_SALE";
  const wanted = status === "RESERVED" ? "ACTIVE" : status === "SOLD" ? "CONVERTED_TO_SALE" : null;
  const row = wanted ? await client.unitReservation.findFirst({ where: { companyId, unitId, status: wanted }, orderBy: [{ closedAt: { sort: "desc", nulls: "first" } }, { reservedAt: "desc" }], select: RESERVATION_SELECT }) : null;
  return {
    commercialStatus: status,
    reservation: row ? { id: row.id, status: row.status, clientId: row.clientId, opportunityId: row.opportunityId, agreedPrice: row.agreedPrice, currency: row.currency, expiresAt: row.expiresAt, createdByMemberId: row.createdByMemberId, clientName: row.client.name, dealName: row.opportunity.name } : null,
  };
}

/** Why a contract cannot be asked for or drafted from this standing, or null (§13, §111). */
function standingProblem(standing: Standing, now: Date): string | null {
  if (!standing.reservation) return "Reserve the unit for a client and a deal before its contract is requested.";
  if (standing.reservation.status === "ACTIVE" && standing.reservation.expiresAt.getTime() <= now.getTime()) return "The reservation has expired. Extend it before the contract is requested.";
  if (standing.reservation.agreedPrice === null) return "Record the agreed price on the reservation first.";
  return null;
}

async function liveContract(client: Tx | typeof prisma, companyId: string, unitId: string) {
  return client.contractUnit.findFirst({ where: { companyId, unitId, releasedAt: null }, select: { contractId: true, contract: { select: { contractNumber: true } } } });
}

const alreadyContracted = () => fail("UNIT_CONTRACT_EXISTS", "This Unit already has an active primary Contract.", "CONFLICT");

/* Reading (§49) -------------------------------------------------------------------------------- */

const CONTRACT_SELECT = {
  id: true,
  contractNumber: true,
  title: true,
  status: true,
  clientId: true,
  opportunityId: true,
  contractValue: true,
  currency: true,
  signedDate: true,
  effectiveDate: true,
  completedAt: true,
  ownerMemberId: true,
  createdAt: true,
  client: { select: { name: true } },
  opportunity: { select: { name: true } },
  units: { orderBy: { createdAt: "asc" }, select: { unitId: true, value: true, valueNote: true, releasedAt: true, releaseReason: true, unit: { select: { unitCode: true } } } },
} satisfies Prisma.ContractSelect;

type ContractRow = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

/** What the unit page may offer on a contract in this status, to this reader (§49, §57). */
function contractActions(status: ContractStatus, live: boolean, caps: UnitLegalCapabilities): UnitContractAction[] {
  if (!live) return [];
  const actions: UnitContractAction[] = [];
  const may = (action: string) => contractMachine.transitions.some((transition) => transition.action === action && transition.from.includes(status));
  if (caps.canReview && may("submit_review")) actions.push("submit_review");
  if (caps.canReview && may("submit_approval")) actions.push("submit_approval");
  if (caps.canReview && may("return_to_draft")) actions.push("return_to_draft");
  if (caps.canSignStatus && may("mark_sent")) actions.push("mark_sent");
  if (caps.canSignStatus && may("mark_signed")) actions.push("mark_signed");
  if (caps.canSignStatus && may("activate")) actions.push("activate");
  if (caps.canSignStatus && may("complete")) actions.push("complete");
  if (caps.canCancel && may("cancel")) actions.push("cancel");
  if (caps.canCancel && may("terminate")) actions.push("terminate");
  return actions;
}

function contractDTO(row: ContractRow, unitId: string, caps: UnitLegalCapabilities, names: Map<string, string>, pending: Set<string>, documents: Map<string, number>): UnitContractDTO {
  const link = row.units.find((unit) => unit.unitId === unitId);
  const live = Boolean(link && link.releasedAt === null);
  return {
    id: row.id,
    number: row.contractNumber,
    title: row.title,
    status: row.status as ContractStatusKey,
    statusLabel: UNIT_CONTRACT_STATUS_LABELS[row.status as ContractStatusKey],
    live,
    client: caps.canSeeClients && row.clientId && row.client ? { id: row.clientId, name: row.client.name } : null,
    deal: caps.canSeeDeals && row.opportunityId && row.opportunity ? { id: row.opportunityId, name: row.opportunity.name } : null,
    value: caps.canSeeValue ? moneyText(row.contractValue) : null,
    currency: row.currency,
    signedDate: row.signedDate?.toISOString().slice(0, 10) ?? null,
    effectiveDate: row.effectiveDate?.toISOString().slice(0, 10) ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    owner: names.get(row.ownerMemberId) ?? null,
    ownerMemberId: row.ownerMemberId,
    createdAt: row.createdAt.toISOString(),
    units: row.units.map((unit) => ({ unitId: unit.unitId, unitCode: unit.unit.unitCode, value: caps.canSeeValue ? moneyText(unit.value) : null, valueNote: caps.canSeeValue ? unit.valueNote : null, released: unit.releasedAt !== null, releaseReason: unit.releaseReason })),
    pendingApproval: pending.has(row.id),
    documentCount: documents.get(row.id) ?? 0,
    actions: contractActions(row.status, live, caps),
  };
}

const REQUEST_SELECT = {
  id: true,
  status: true,
  notes: true,
  requestedByMemberId: true,
  requestedAt: true,
  closedAt: true,
  closeReason: true,
  clientId: true,
  opportunityId: true,
  contract: { select: { id: true, contractNumber: true } },
  client: { select: { name: true } },
  opportunity: { select: { name: true } },
  reservation: { select: { id: true, status: true, expiresAt: true, agreedPrice: true, currency: true } },
  unit: { select: { id: true, unitCode: true, projectId: true, project: { select: { name: true } }, floor: { select: { name: true, building: { select: { name: true } } } } } },
} satisfies Prisma.UnitContractRequestSelect;

type RequestRow = Prisma.UnitContractRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

/** A request whose reservation has ended is no longer a request for anything (§12); it reads as withdrawn. */
function requestEnded(row: { status: UnitContractRequestStatus; reservation: { status: string } }): boolean {
  return row.status === "OPEN" && !["ACTIVE", "CONVERTED_TO_SALE"].includes(row.reservation.status);
}

function requestDTO(row: RequestRow, caps: Pick<UnitLegalCapabilities, "canSeeClients" | "canSeeDeals">, names: Map<string, string>): ContractRequestDTO {
  const ended = requestEnded(row);
  return {
    id: row.id,
    status: ended ? "CANCELLED" : row.status,
    unit: { id: row.unit.id, unitCode: row.unit.unitCode, projectId: row.unit.projectId, projectName: row.unit.project.name, building: row.unit.floor.building.name, floor: row.unit.floor.name },
    client: caps.canSeeClients ? { id: row.clientId, name: row.client.name } : null,
    deal: caps.canSeeDeals ? { id: row.opportunityId, name: row.opportunity.name } : null,
    agreedPrice: moneyText(row.reservation.agreedPrice),
    currency: row.reservation.currency,
    reservation: { id: row.reservation.id, status: row.reservation.status, expiresAt: row.reservation.expiresAt.toISOString() },
    notes: row.notes,
    requestedBy: names.get(row.requestedByMemberId) ?? null,
    requestedByMemberId: row.requestedByMemberId,
    requestedAt: row.requestedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: ended ? "The reservation ended." : row.closeReason,
    contract: row.contract ? { id: row.contract.id, number: row.contract.contractNumber } : null,
  };
}

export async function getUnitLegal(context: UserContext, unitId: string): Promise<UnitLegalDTO> {
  const unit = await findLegalUnit(context, unitId);
  const caps = legalCapabilities(context);
  const now = new Date();
  const [links, requests, standing, autoNumber] = await Promise.all([
    prisma.contractUnit.findMany({ where: { companyId: context.companyId, unitId: unit.id }, orderBy: [{ releasedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], select: { contract: { select: CONTRACT_SELECT } } }),
    prisma.unitContractRequest.findMany({ where: { companyId: context.companyId, unitId: unit.id }, orderBy: { requestedAt: "desc" }, take: 50, select: REQUEST_SELECT }),
    standingOf(prisma, context.companyId, unit.id),
    isAutoNumbered({ companyId: context.companyId, moduleKey: "contracts", entityType: "contract" }),
  ]);
  const contracts = links.map((link) => link.contract);
  const contractIds = contracts.map((row) => row.id);
  const [pending, documents] = await Promise.all([
    prisma.contractApproval.findMany({ where: { companyId: context.companyId, recordType: "CONTRACT", recordId: { in: contractIds }, status: "PENDING" }, select: { recordId: true } }),
    prisma.document.groupBy({ by: ["entityId"], where: { companyId: context.companyId, entityType: "contract", entityId: { in: contractIds }, archivedAt: null }, _count: { _all: true } }),
  ]);
  const names = await memberNames(context.companyId, [...contracts.map((row) => row.ownerMemberId), ...requests.map((row) => row.requestedByMemberId)]);
  const dtos = contracts.map((row) => contractDTO(row, unit.id, caps, names, new Set(pending.map((item) => item.recordId)), new Map(documents.map((item) => [item.entityId!, item._count._all]))));
  const live = dtos.find((row) => row.live) ?? null;
  const requestDTOs = requests.map((row) => requestDTO(row, caps, names));
  const openRequest = requestDTOs.find((row) => row.status === "OPEN") ?? null;

  const problem = standingProblem(standing, now);
  const requestBlocked = live ? "This unit already has an active primary Contract." : openRequest ? "A contract has already been requested for this unit." : problem;
  const createBlocked = live ? "This unit already has an active primary Contract." : problem ?? (openRequest ? null : "Sales has not requested a contract for this unit yet.");

  let candidates: ContractCandidateDTO[] = [];
  if (!live && standing.reservation) {
    const others = await prisma.unitReservation.findMany({
      where: {
        companyId: context.companyId,
        unitId: { not: unit.id },
        clientId: standing.reservation.clientId,
        opportunityId: standing.reservation.opportunityId,
        status: { in: ["ACTIVE", "CONVERTED_TO_SALE"] },
        unit: { is: { AND: [readableUnitWhere(context), { projectId: unit.projectId }, { contractLinks: { none: { releasedAt: null } } }] } },
      },
      select: { unitId: true, agreedPrice: true, currency: true, unit: { select: { unitCode: true, unitType: { select: { name: true } }, contractRequests: { where: { status: "OPEN" }, select: { id: true } } } } },
    });
    candidates = others.map((row) => ({ unitId: row.unitId, unitCode: row.unit.unitCode, unitType: row.unit.unitType.name, agreedPrice: moneyText(row.agreedPrice), currency: row.currency, hasOpenRequest: row.unit.contractRequests.length > 0 }));
  }

  return {
    unitId: unit.id,
    projectId: unit.projectId,
    unitCode: unit.unitCode,
    contract: live,
    history: dtos.filter((row) => !row.live),
    openRequest,
    requests: requestDTOs,
    requestBlocked,
    createBlocked,
    candidates,
    defaults: { autoNumber, title: `Sale agreement — ${unit.unitCode}`, agreedPrice: moneyText(standing.reservation?.agreedPrice), currency: standing.reservation?.currency ?? null },
    capabilities: caps,
  };
}

/* Sales' request (§12) ----------------------------------------------------------------------------- */

async function moveRequest(tx: Tx, context: UserContext, request: { id: string; status: UnitContractRequestStatus }, action: UnitContractRequestAction, input: { reason?: string | null; data?: Record<string, unknown> }) {
  await applyTransition(tx, {
    machine: unitContractRequestMachine,
    action,
    id: request.id,
    context,
    from: request.status,
    reason: input.reason,
    data: { ...input.data, closedAt: new Date(), closedByMemberId: context.membershipId },
  });
}

/** Lock the units' commercial profiles, so a release or a sale on the same units waits for this (E-05E §23). */
async function lockUnits(tx: Tx, companyId: string, unitIds: string[]) {
  for (const unitId of [...unitIds].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "unit_commercial_profiles" WHERE "unitId" = ${unitId} AND "companyId" = ${companyId} FOR UPDATE`;
  }
}

export async function requestUnitContract(context: UserContext, unitId: string, input: z.infer<typeof requestContractSchema>): Promise<{ requestId: string }> {
  const unit = await findLegalUnit(context, unitId);
  assertPermission(context, "project.unit.contract.request");

  return runInTransaction("contracts.unit.request", async (tx) => {
    await lockUnits(tx, context.companyId, [unit.id]);
    if (await liveContract(tx, context.companyId, unit.id)) throw alreadyContracted();
    const standing = await standingOf(tx, context.companyId, unit.id);
    const problem = standingProblem(standing, new Date());
    if (problem) throw fail("UNIT_NOT_READY_FOR_CONTRACT", problem, "CONFLICT");
    const reservation = standing.reservation!;

    // A request left open by a reservation that has ended is closed before a new one is made.
    const open = await tx.unitContractRequest.findFirst({ where: { companyId: context.companyId, unitId: unit.id, status: "OPEN" }, select: { id: true, status: true, reservation: { select: { status: true } } } });
    if (open && !requestEnded(open)) throw fail("CONTRACT_ALREADY_REQUESTED", "A contract has already been requested for this unit.", "CONFLICT");
    if (open) await moveRequest(tx, context, open, "cancel", { data: { closeReason: "The reservation ended." } });

    const request = await tx.unitContractRequest.create({
      data: { companyId: context.companyId, projectId: unit.projectId, unitId: unit.id, reservationId: reservation.id, clientId: reservation.clientId, opportunityId: reservation.opportunityId, notes: input.notes, requestedByMemberId: context.membershipId },
      select: { id: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_CONTRACT_REQUESTED", message: `asked Legal for a contract for ${unit.unitCode}`, metadata: { projectId: unit.projectId, requestId: request.id } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.UNIT_CONTRACT_REQUESTED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, after: { requestId: request.id, reservationId: reservation.id, clientId: reservation.clientId, opportunityId: reservation.opportunityId, status: "OPEN" } },
      { tx },
    );
    // Legal's queue, not a person: whoever may draft this unit's contract (§12).
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.UNIT_CONTRACT_REQUESTED,
      moduleKey: "projects",
      entityType: "project_unit",
      entityId: unit.id,
      actorMemberId: context.membershipId,
      projectId: unit.projectId,
      payload: { requestId: request.id, unitCode: unit.unitCode, projectName: unit.project.name, excludeMemberIds: [context.membershipId] },
    });
    return { requestId: request.id };
  });
}

async function findRequest(context: UserContext, requestId: string) {
  const row = await prisma.unitContractRequest.findFirst({ where: { companyId: context.companyId, id: requestId, unit: { is: readableUnitWhere(context) } }, select: { id: true, unitId: true } });
  if (!row) throw fail("CONTRACT_REQUEST_NOT_FOUND", "That contract request could not be found.", "NOT_FOUND");
  const unit = await findLegalUnit(context, row.unitId);
  return { requestId: row.id, unit };
}

/** Sales takes its request back while Legal has not drafted the contract (§12). */
export async function withdrawContractRequest(context: UserContext, requestId: string): Promise<void> {
  const { unit } = await findRequest(context, requestId);
  assertPermission(context, "project.unit.contract.request");
  await runInTransaction("contracts.unit.request.withdraw", async (tx) => {
    const request = await tx.unitContractRequest.findFirstOrThrow({ where: { companyId: context.companyId, id: requestId }, select: { id: true, status: true } });
    if (request.status !== "OPEN") throw fail("CONTRACT_REQUEST_CLOSED", "This request has already been answered.", "CONFLICT");
    await moveRequest(tx, context, request, "cancel", { data: { closeReason: "Withdrawn by Sales." } });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_CONTRACT_REQUEST_WITHDRAWN", message: `withdrew the contract request for ${unit.unitCode}`, metadata: { projectId: unit.projectId, requestId } });
  });
}

/** Legal's queue (§12): the open requests for units the reader may open, oldest first. */
export async function listContractRequests(context: UserContext, query: ContractRequestQuery): Promise<{ items: ContractRequestDTO[]; page: number; pageSize: number; total: number }> {
  assertModule(context, "projects");
  const caps = legalCapabilities(context);
  if (!caps.canView || !(caps.canCreate || caps.canReview)) throw new AccessError("FORBIDDEN", "You cannot see contract requests.");
  const live = { status: "OPEN" as const, reservation: { is: { status: { in: ["ACTIVE", "CONVERTED_TO_SALE"] as Array<"ACTIVE" | "CONVERTED_TO_SALE"> } } } };
  const where: Prisma.UnitContractRequestWhereInput = {
    AND: [
      { companyId: context.companyId, unit: { is: readableUnitWhere(context) } },
      query.view === "open" ? live : { NOT: live },
      query.projectId ? { projectId: query.projectId } : {},
      query.q
        ? {
            OR: [
              { unit: { is: { unitCode: { contains: query.q, mode: "insensitive" } } } },
              { unit: { is: { project: { is: { name: { contains: query.q, mode: "insensitive" } } } } } },
              ...(caps.canSeeClients ? [{ client: { is: { name: { contains: query.q, mode: "insensitive" as const } } } }] : []),
            ],
          }
        : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.unitContractRequest.count({ where }),
    prisma.unitContractRequest.findMany({ where, orderBy: query.view === "open" ? [{ requestedAt: "asc" }] : [{ updatedAt: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit, select: REQUEST_SELECT }),
  ]);
  const names = await memberNames(context.companyId, rows.map((row) => row.requestedByMemberId));
  return { items: rows.map((row) => requestDTO(row, caps, names)), page: query.page, pageSize: query.limit, total };
}

export async function declineContractRequest(context: UserContext, requestId: string, input: z.infer<typeof declineRequestSchema>): Promise<void> {
  const { unit } = await findRequest(context, requestId);
  assertPermission(context, "project.unit.contract.review");
  await runInTransaction("contracts.unit.request.decline", async (tx) => {
    const request = await tx.unitContractRequest.findFirstOrThrow({ where: { companyId: context.companyId, id: requestId }, select: { id: true, status: true, requestedByMemberId: true } });
    if (request.status !== "OPEN") throw fail("CONTRACT_REQUEST_CLOSED", "This request has already been answered.", "CONFLICT");
    await moveRequest(tx, context, request, "decline", { reason: input.reason, data: { closeReason: input.reason } });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_CONTRACT_REQUEST_DECLINED", message: `declined the contract request for ${unit.unitCode}`, metadata: { projectId: unit.projectId, requestId } });
    await recordUserAction(context, { actionKey: AuditAction.UNIT_CONTRACT_REQUEST_DECLINED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, before: { requestId, status: "OPEN" }, after: { requestId, status: "DECLINED", reason: input.reason } }, { tx });
    if (request.requestedByMemberId !== context.membershipId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.UNIT_CONTRACT_REQUEST_DECLINED,
        moduleKey: "projects",
        entityType: "project_unit",
        entityId: unit.id,
        actorMemberId: context.membershipId,
        projectId: unit.projectId,
        payload: { memberIds: [request.requestedByMemberId], requestId, unitCode: unit.unitCode },
      });
    }
  });
}

/* Legal drafts the contract (§12-§16, §74, §88-§90) --------------------------------------------------- */

type Included = { unit: Awaited<ReturnType<typeof findReadableUnit>>; standing: Standing; value: Prisma.Decimal; valueNote: string | null };

/**
 * Drafts the sale contract from Sales' open request (§12, §74): authorised,
 * checked against the unit and the reservation, one live contract per unit, the
 * contract and its units, the requests fulfilled, audit and activity — in one
 * transaction. More units of the same client and deal may be sold on it (§88).
 */
export async function createUnitContract(context: UserContext, unitId: string, input: z.infer<typeof createUnitContractSchema>): Promise<{ contractId: string; contractNumber: string }> {
  const unit = await findLegalUnit(context, unitId);
  assertModule(context, MODULE);
  assertPermission(context, "project.unit.contract.create");
  assertPermission(context, "legal.contract.create");

  const unitIds = [unit.id, ...input.additionalUnitIds.filter((id) => id !== unit.id)];
  if (new Set(unitIds).size !== unitIds.length) throw new AccessError("VALIDATION_ERROR", "Each unit is on a contract once.", { additionalUnitIds: ["Each unit is on a contract once."] });
  const units = [unit];
  for (const id of unitIds.slice(1)) {
    const other = await findReadableUnit(context, id).catch((error: unknown) => {
      if (error instanceof AccessError && error.code === "NOT_FOUND") throw invalidRecordLink("additionalUnitIds", "CROSS_PROJECT_REFERENCE", "Choose units you can open.");
      throw error;
    });
    if (other.projectId !== unit.projectId) throw invalidRecordLink("additionalUnitIds", "CROSS_PROJECT_REFERENCE", "A contract sells units of one project.");
    units.push(other);
  }
  for (const row of input.values) {
    if (!unitIds.includes(row.unitId)) throw new AccessError("VALIDATION_ERROR", "A value was given for a unit that is not on this contract.", { values: ["A value was given for a unit that is not on this contract."] });
  }

  return runInTransaction("contracts.unit.create", async (tx) => {
    await lockUnits(tx, context.companyId, unitIds);
    const now = new Date();
    const included: Included[] = [];
    for (const row of units) {
      if (await liveContract(tx, context.companyId, row.id)) throw fail("UNIT_CONTRACT_EXISTS", `${row.unitCode} already has an active primary Contract.`, "CONFLICT");
      const standing = await standingOf(tx, context.companyId, row.id);
      const problem = standingProblem(standing, now);
      if (problem) throw fail("UNIT_NOT_READY_FOR_CONTRACT", units.length > 1 ? `${row.unitCode}: ${problem}` : problem, "CONFLICT");
      const given = input.values.find((value) => value.unitId === row.id);
      const agreed = standing.reservation!.agreedPrice!;
      const value = given ? new Prisma.Decimal(given.value) : agreed;
      // A value other than the agreed price is Legal's to set, never silently (§14).
      if (!value.equals(agreed) && !given?.valueNote) throw new AccessError("VALIDATION_ERROR", `Say why ${row.unitCode}'s value differs from the agreed price.`, { values: [`Say why ${row.unitCode}'s value differs from the agreed price.`] });
      included.push({ unit: row, standing, value, valueNote: value.equals(agreed) ? null : (given?.valueNote ?? null) });
    }
    const first = included[0]!.standing.reservation!;
    for (const row of included.slice(1)) {
      const reservation = row.standing.reservation!;
      if (reservation.clientId !== first.clientId || reservation.opportunityId !== first.opportunityId) throw new AccessError("VALIDATION_ERROR", `${row.unit.unitCode} is reserved for another client or deal.`, { additionalUnitIds: [`${row.unit.unitCode} is reserved for another client or deal.`] });
      if ((reservation.currency ?? null) !== (first.currency ?? null)) throw new AccessError("VALIDATION_ERROR", `${row.unit.unitCode} was agreed in another currency.`, { additionalUnitIds: [`${row.unit.unitCode} was agreed in another currency.`] });
    }
    // Sales asks, Legal drafts: the unit the contract is drafted for must have been requested (§12).
    const request = await tx.unitContractRequest.findFirst({ where: { companyId: context.companyId, unitId: unit.id, status: "OPEN", reservation: { is: { status: { in: ["ACTIVE", "CONVERTED_TO_SALE"] } } } }, select: { id: true } });
    if (!request) throw fail("CONTRACT_NOT_REQUESTED", "Sales has not requested a contract for this unit yet.", "CONFLICT");

    const allocated = await allocateNumber({ companyId: context.companyId, moduleKey: MODULE, entityType: "contract" }, { tx, occurredAt: now });
    const contractNumber = allocated ?? input.contractNumber;
    if (!contractNumber) throw new AccessError("VALIDATION_ERROR", "This company numbers contracts manually, so a contract number is required.", { contractNumber: ["Enter the contract number."] });
    const clash = await tx.contract.findFirst({ where: { companyId: context.companyId, contractNumber }, select: { id: true } });
    if (clash) throw new AccessError("CONFLICT", `Contract number ${contractNumber} is already used in this company.`, { contractNumber: [`${contractNumber} is already used.`] });

    const total = included.reduce((sum, row) => sum.plus(row.value), new Prisma.Decimal(0));
    const codes = included.map((row) => row.unit.unitCode).join(", ");
    const contract = await tx.contract.create({
      data: {
        companyId: context.companyId,
        contractNumber,
        title: input.title ?? `Sale agreement — ${codes}`,
        contractType: SALE_AGREEMENT,
        clientId: first.clientId,
        projectId: unit.projectId,
        opportunityId: first.opportunityId,
        ownerMemberId: context.membershipId,
        status: "DRAFT",
        // The party as it will sign: the client's name today, kept (PRD #18 §61).
        counterpartyName: first.clientName,
        currency: first.currency,
        contractValue: total,
        summary: input.summary,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });
    for (const row of included) {
      await tx.contractUnit
        .create({ data: { companyId: context.companyId, projectId: row.unit.projectId, contractId: contract.id, unitId: row.unit.id, value: row.value, currency: first.currency, valueNote: row.valueNote, createdByMemberId: context.membershipId } })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw alreadyContracted();
          throw error;
        });
    }
    const fulfilled = await tx.unitContractRequest.findMany({ where: { companyId: context.companyId, unitId: { in: unitIds }, status: "OPEN" }, select: { id: true, status: true } });
    for (const row of fulfilled) await moveRequest(tx, context, row, "fulfil", { data: { contractId: contract.id } });

    await recordActivity(tx, context, { module: MODULE, entityType: "Contract", entityId: contract.id, action: "LEGAL_CONTRACT_CREATED", message: `drafted sale contract ${contractNumber}`, metadata: { contractType: SALE_AGREEMENT, clientId: first.clientId, projectId: unit.projectId } });
    for (const row of included) {
      await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: row.unit.id, action: "UNIT_CONTRACT_CREATED", message: `drafted sale contract ${contractNumber} for ${row.unit.unitCode}`, metadata: { projectId: row.unit.projectId, contractId: contract.id } });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.UNIT_CONTRACT_CREATED,
        entity: { type: "Contract", id: contract.id, label: contractNumber },
        projectId: unit.projectId,
        after: { contractId: contract.id, contractNumber, status: "DRAFT", clientId: first.clientId, opportunityId: first.opportunityId, unitIds, contractValue: total.toFixed(2), currency: first.currency, requestIds: fulfilled.map((row) => row.id) },
      },
      { tx },
    );
    return { contractId: contract.id, contractNumber };
  });
}

/**
 * A unit's part of a draft sale contract's value (§14, §90): a different figure
 * from the agreed price carries why, and the contract value stays the sum of its
 * units. Past review, terms change by amendment.
 */
export async function updateContractUnitValue(context: UserContext, contractId: string, unitId: string, input: z.infer<typeof contractUnitValueSchema>): Promise<{ contractValue: string }> {
  const unit = await findLegalUnit(context, unitId);
  assertModule(context, MODULE);
  assertPermission(context, "project.unit.contract.update");
  assertPermission(context, "legal.contract.update");
  if (!legalCapabilities(context).canSeeValue) throw new AccessError("FORBIDDEN", "You cannot see this contract's value.");

  return runInTransaction("contracts.unit.value", async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "contracts" WHERE "id" = ${contractId} AND "companyId" = ${context.companyId} FOR UPDATE`;
    const contract = await tx.contract.findFirst({ where: { companyId: context.companyId, id: contractId, contractType: SALE_AGREEMENT }, select: { id: true, contractNumber: true, status: true, contractValue: true, projectId: true, units: { where: { releasedAt: null }, select: { id: true, unitId: true, value: true } } } });
    const link = contract?.units.find((row) => row.unitId === unit.id);
    if (!contract || !link) throw fail("CONTRACT_NOT_FOUND", "That contract could not be found.", "NOT_FOUND");
    if (contractEditMode(contract.status) !== "FULL") throw fail("CONTRACT_TERMS_FROZEN", "An approved contract's terms change by amendment, not by editing.", "CONFLICT");
    const standing = await standingOf(tx, context.companyId, unit.id);
    const agreed = standing.reservation?.agreedPrice ?? null;
    const value = new Prisma.Decimal(input.value);
    if (agreed && !value.equals(agreed) && !input.valueNote) throw new AccessError("VALIDATION_ERROR", "Say why the value differs from the agreed price.", { valueNote: ["Say why the value differs from the agreed price."] });

    await tx.contractUnit.updateMany({ where: { companyId: context.companyId, id: link.id, releasedAt: null }, data: { value, valueNote: agreed && value.equals(agreed) ? null : input.valueNote } });
    const total = contract.units.reduce((sum, row) => sum.plus(row.id === link.id ? value : (row.value ?? 0)), new Prisma.Decimal(0));
    const saved = await tx.contract.updateMany({ where: { companyId: context.companyId, id: contract.id, status: contract.status }, data: { contractValue: total, updatedByMemberId: context.membershipId } });
    if (!saved.count) throw fail("CONTRACT_STALE", "This contract changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_CONTRACT_UPDATED", message: `changed ${unit.unitCode}'s value on sale contract ${contract.contractNumber}`, metadata: { projectId: unit.projectId, contractId } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.UNIT_CONTRACT_UPDATED, entity: { type: "Contract", id: contract.id, label: contract.contractNumber }, projectId: contract.projectId, before: { contractId, unitId: unit.id, value: moneyText(link.value), contractValue: moneyText(contract.contractValue) }, after: { contractId, unitId: unit.id, value: value.toFixed(2), valueNote: input.valueNote, contractValue: total.toFixed(2) } },
      { tx },
    );
    return { contractValue: total.toFixed(2) };
  });
}

/** Every contract a unit has had, live first (§57). */
export async function listUnitContracts(context: UserContext, unitId: string): Promise<UnitContractDTO[]> {
  const legal = await getUnitLegal(context, unitId);
  return [...(legal.contract ? [legal.contract] : []), ...legal.history];
}


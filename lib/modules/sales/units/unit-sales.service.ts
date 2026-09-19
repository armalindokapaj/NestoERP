import { Prisma, type UnitCommercialStatus } from "@prisma/client";

import { can, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { applyTransition } from "@/lib/core/state/transition";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { createClientSchema } from "@/lib/modules/clients/client.schema";
import { checkDuplicates, createClientRecord, DuplicateClientError } from "@/lib/modules/clients/client.service";
import { fail } from "@/lib/modules/project-structure/structure.service";
import { unitSaleReadiness } from "@/lib/modules/finance/units/unit-finance.core";
import { resolveUnitSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { fullName } from "@/lib/utils/format";
import { findOpportunityInScope } from "../opportunities/opportunity.repository";
import { createOpportunitySchema } from "../opportunities/opportunity.schema";
import { createOpportunityInTransaction } from "../opportunities/opportunity.service";
import { buildOpportunityScopeWhere, buildSalesClientWhere } from "../sales.scope";
import { unitCommercialMachine, type UnitCommercialAction } from "./unit-commercial.machine";
import {
  activeReservation,
  checkVersion,
  closeReservation,
  findReadableReservation,
  findSellableUnit,
  isUniqueViolation,
  lockedProfile,
  notifyReservation,
  PROFILE_SELECT,
  recordStatusChange,
  reservationAudience,
  SALES_ACTIVITY_MODULE,
  salesCapabilities,
  UNIT_ENTITY,
  type ProfileRow,
  type SellableUnit,
} from "./unit-sales.core";
import { canMarkUnitSold, defaultExpiry, moneyText, pricePerSqm, sellability } from "./unit-sales.rules";
import { cancelSaleApprovals, latestSaleApproval } from "./unit-sale-approval.service";
import type { commercialDetailsSchema, correctReservationSchema, dealUnitSchema, extendReservationSchema, releaseReservationSchema, reopenSaleSchema, reserveSchema, saleStatusSchema } from "./unit-sales.schema";
import { MAX_RESERVATION_DAYS, PRICE_BASIS_AREA, type ReservationDTO, type UnitSalesDTO } from "./unit-sales.types";
import type { z } from "zod";

/**
 * Selling a unit (E-05E §6-§31, §45-§50).
 *
 * Every change reads the unit through its project's door, then locks the unit's
 * commercial profile and reads it again: two people reserving one unit queue, and
 * the second is told it has just been reserved (§50). Statuses move only by the
 * `unit_commercial` machine, and every move leaves a status trail, an audit event
 * and — without a client's name — an activity entry on the unit (§44, §53, §54).
 * Nothing here copies the unit, the client or the deal: they are referenced by id.
 */

type Tx = Prisma.TransactionClient;
type Unit = SellableUnit;

const DAY = 86_400_000;

async function memberNames(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: wanted } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, fullName(row.user.firstName, row.user.lastName)]));
}

function unitRef(unit: Unit) {
  return { id: unit.id, unitCode: unit.unitCode, projectId: unit.projectId, projectName: unit.project.name };
}

async function evidence(tx: Tx, context: UserContext, unit: Unit, input: { action: string; message: string; audit: { actionKey: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown> } }) {
  await recordActivity(tx, context, { module: SALES_ACTIVITY_MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: input.action, message: input.message, metadata: { projectId: unit.projectId } });
  await recordUserAction(context, { actionKey: input.audit.actionKey, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, before: input.audit.before, after: input.audit.after, metadata: input.audit.metadata }, { tx });
}

async function move(tx: Tx, context: UserContext, unit: Unit, profile: ProfileRow, action: UnitCommercialAction, input: { to?: UnitCommercialStatus; reason?: string | null; data?: Record<string, unknown>; reservationId?: string | null; opportunityId?: string | null }) {
  const transition = unitCommercialMachine.transitions.find((candidate) => candidate.action === action)!;
  const to = input.to ?? (transition.to as UnitCommercialStatus);
  await applyTransition(tx, {
    machine: unitCommercialMachine,
    action,
    id: profile.id,
    context,
    from: profile.status,
    to: input.to,
    expectedVersion: profile.version,
    reason: input.reason,
    data: { ...input.data, statusChangedAt: new Date(), updatedByMemberId: context.membershipId },
  });
  await recordStatusChange(tx, { companyId: context.companyId, projectId: unit.projectId, unitId: unit.id, from: profile.status, to, reason: input.reason ?? null, source: "USER", actorMemberId: context.membershipId, reservationId: input.reservationId, opportunityId: input.opportunityId });
  return to;
}

function assertSellable(unit: Parameters<typeof sellability>[0]) {
  const verdict = sellability(unit);
  if (!verdict.sellable) throw fail("UNIT_NOT_SELLABLE", verdict.reason!, "CONFLICT");
}

async function unitPublication(client: Tx | typeof prisma, unitId: string, companyId: string) {
  return client.projectUnit.findFirstOrThrow({ where: { companyId, id: unitId }, select: { publicationStatus: true, isActive: true, saleableArea: true, internalArea: true, grossArea: true } });
}

/* Reading (§15, §34) ----------------------------------------------------------- */

export async function getUnitSales(context: UserContext, unitId: string): Promise<UnitSalesDTO> {
  const unit = await findSellableUnit(context, unitId);
  const caps = salesCapabilities(context);
  const [facts, profile, reservations, prices, trail, links, settings] = await Promise.all([
    unitPublication(prisma, unit.id, context.companyId),
    prisma.unitCommercialProfile.findFirst({ where: { companyId: context.companyId, unitId: unit.id }, select: PROFILE_SELECT }),
    prisma.unitReservation.findMany({
      where: { companyId: context.companyId, unitId: unit.id },
      orderBy: [{ reservedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        status: true,
        clientId: true,
        opportunityId: true,
        reservedAt: true,
        expiresAt: true,
        closedAt: true,
        closeReason: true,
        agreedPrice: true,
        currency: true,
        notes: true,
        createdByMemberId: true,
        version: true,
        client: { select: { name: true } },
        opportunity: { select: { name: true } },
        extensions: { orderBy: { extendedAt: "asc" }, select: { oldExpiresAt: true, newExpiresAt: true, reason: true, extendedByMemberId: true, extendedAt: true } },
      },
    }),
    prisma.unitPriceHistory.findMany({ where: { companyId: context.companyId, unitId: unit.id }, orderBy: { changedAt: "desc" }, take: 50 }),
    prisma.unitCommercialStatusHistory.findMany({ where: { companyId: context.companyId, unitId: unit.id }, orderBy: { changedAt: "desc" }, take: 50 }),
    prisma.opportunityUnit.findMany({ where: { companyId: context.companyId, unitId: unit.id }, orderBy: { createdAt: "asc" }, select: { opportunityId: true, agreedPrice: true, currency: true, opportunity: { select: { name: true } } } }),
    resolveUnitSalesSettings(context.companyId),
  ]);
  const activeRow = reservations.find((row) => row.status === "ACTIVE") ?? null;
  // What Legal and Finance hold for the Sold rule (E-05F §42), and the sale's approval where the rule asks for one.
  const [readiness, approval] = await Promise.all([
    unitSaleReadiness(prisma, context.companyId, unit.id),
    activeRow ? latestSaleApproval(prisma, context.companyId, unit.id, activeRow.id) : Promise.resolve(null),
  ]);
  const names = await memberNames(context.companyId, [
    profile?.heldByMemberId,
    ...reservations.flatMap((row) => [row.createdByMemberId, ...row.extensions.map((extension) => extension.extendedByMemberId)]),
    ...prices.map((row) => row.changedByMemberId),
    ...trail.map((row) => row.actorMemberId),
    approval?.submittedByMemberId,
    approval?.decidedByMemberId,
  ]);

  const toReservation = (row: (typeof reservations)[number]): ReservationDTO => ({
    id: row.id,
    status: row.status,
    client: caps.canSeeClients ? { id: row.clientId, name: row.client.name } : null,
    deal: caps.canSeeDeals ? { id: row.opportunityId, name: row.opportunity.name } : null,
    reservedAt: row.reservedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    agreedPrice: moneyText(row.agreedPrice),
    currency: row.currency,
    notes: row.notes,
    salesperson: names.get(row.createdByMemberId) ?? null,
    salespersonMemberId: row.createdByMemberId,
    version: row.version,
    extensions: row.extensions.map((extension) => ({ oldExpiresAt: extension.oldExpiresAt.toISOString(), newExpiresAt: extension.newExpiresAt.toISOString(), reason: extension.reason, extendedBy: names.get(extension.extendedByMemberId) ?? null, extendedByMemberId: extension.extendedByMemberId, extendedAt: extension.extendedAt.toISOString() })),
  });
  const active = reservations.find((row) => row.status === "ACTIVE") ?? null;
  const status = profile?.status ?? "NOT_FOR_SALE";
  const priceBasis = profile?.priceBasis ?? "SALEABLE_AREA";
  const areas = { saleableArea: moneyText(facts.saleableArea), internalArea: moneyText(facts.internalArea), grossArea: moneyText(facts.grossArea) };
  const basisField = PRICE_BASIS_AREA[priceBasis];
  const verdict = sellability(facts);

  return {
    unitId: unit.id,
    projectId: unit.projectId,
    unitCode: unit.unitCode,
    status,
    statusChangedAt: profile?.statusChangedAt?.toISOString() ?? null,
    askingPrice: moneyText(profile?.askingPrice),
    currency: profile?.currency ?? null,
    priceBasis,
    pricePerSqm: pricePerSqm(moneyText(profile?.askingPrice), priceBasis, areas),
    basisArea: basisField ? (areas[basisField as keyof typeof areas] ?? null) : null,
    holdReason: profile?.holdReason ?? null,
    holdUntil: profile?.holdUntil?.toISOString() ?? null,
    heldBy: profile?.heldByMemberId ? (names.get(profile.heldByMemberId) ?? null) : null,
    heldByMemberId: profile?.heldByMemberId ?? null,
    salesNotes: profile?.salesNotes ?? null,
    version: profile?.version ?? 0,
    sellable: verdict.sellable,
    sellableReason: verdict.reason,
    activeReservation: active ? toReservation(active) : null,
    reservations: reservations.map(toReservation),
    priceHistory: prices.map((row) => ({ id: row.id, oldPrice: moneyText(row.oldPrice), newPrice: moneyText(row.newPrice), oldCurrency: row.oldCurrency, currency: row.currency, priceBasis: row.priceBasis, reason: row.reason, changedBy: names.get(row.changedByMemberId) ?? null, changedByMemberId: row.changedByMemberId, changedAt: row.changedAt.toISOString() })),
    statusHistory: trail.map((row) => ({ id: row.id, fromStatus: row.fromStatus, toStatus: row.toStatus, reason: row.reason, source: row.source, actor: row.actorMemberId ? (names.get(row.actorMemberId) ?? null) : null, actorMemberId: row.actorMemberId, changedAt: row.changedAt.toISOString() })),
    deals: caps.canSeeDeals ? links.map((link) => ({ id: link.opportunityId, name: link.opportunity.name, agreedPrice: moneyText(link.agreedPrice), currency: link.currency })) : [],
    soldCheck: canMarkUnitSold({
      status,
      reservation: active ? { status: active.status, clientId: active.clientId, opportunityId: active.opportunityId, agreedPrice: moneyText(active.agreedPrice), expiresAt: active.expiresAt } : null,
      rule: settings.unitSoldRule,
      contract: readiness.contract ? { signed: readiness.signed } : null,
      deposit: readiness.deposit,
      approval,
    }),
    saleApproval: approval
      ? { status: approval.status, submittedBy: names.get(approval.submittedByMemberId) ?? null, submittedAt: approval.submittedAt.toISOString(), decidedBy: approval.decidedByMemberId ? (names.get(approval.decidedByMemberId) ?? null) : null, decidedAt: approval.decidedAt?.toISOString() ?? null, note: approval.decisionNote ?? approval.submissionNote }
      : null,
    canRequestSaleApproval: settings.unitSoldRule === "MANUAL_APPROVAL" && caps.canMarkSold && status === "RESERVED" && Boolean(active) && approval?.status !== "PENDING" && approval?.status !== "APPROVED",
    contract: isModuleEnabled(context, "contracts") && can(context, "project.unit.legal.view") ? readiness.contract : null,
    defaults: { reservationDays: settings.unitReservationDays, currency: profile?.currency ?? settings.baseCurrency },
    capabilities: caps,
  };
}

/* Price and notes (§10-§12) ------------------------------------------------------ */

export async function updateCommercialDetails(context: UserContext, unitId: string, input: z.infer<typeof commercialDetailsSchema>): Promise<{ version: number }> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.price.manage");
  const settings = await resolveUnitSalesSettings(context.companyId);

  return runInTransaction("sales.unit.details", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    checkVersion(profile, input.expectedVersion);
    if (profile.status === "SOLD") throw fail("UNIT_SOLD", "A sold unit's asking price does not change. Reopen the sale first.", "CONFLICT");
    const currency = input.askingPrice === null ? (input.currency ?? profile.currency) : (input.currency ?? profile.currency ?? settings.baseCurrency);
    const oldPrice = moneyText(profile.askingPrice);
    const priceChanged = oldPrice !== input.askingPrice || (input.askingPrice !== null && profile.currency !== currency) || profile.priceBasis !== input.priceBasis;

    const updated = await tx.unitCommercialProfile.updateMany({
      where: { id: profile.id, companyId: context.companyId, version: profile.version },
      data: {
        askingPrice: input.askingPrice === null ? null : new Prisma.Decimal(input.askingPrice),
        currency,
        priceBasis: input.priceBasis,
        salesNotes: input.salesNotes,
        updatedByMemberId: context.membershipId,
        version: { increment: 1 },
      },
    });
    if (!updated.count) throw fail("UNIT_SALES_STALE", "This unit's sales were updated by another user. Refresh before continuing.", "CONFLICT");

    if (priceChanged) {
      // The asking price keeps its history; an agreed price never overwrites it (§12, §30).
      await tx.unitPriceHistory.create({
        data: {
          companyId: context.companyId,
          projectId: unit.projectId,
          unitId: unit.id,
          oldPrice: profile.askingPrice,
          newPrice: input.askingPrice === null ? null : new Prisma.Decimal(input.askingPrice),
          oldCurrency: profile.currency,
          currency,
          oldPriceBasis: profile.priceBasis,
          priceBasis: input.priceBasis,
          reason: input.reason,
          changedByMemberId: context.membershipId,
        },
      });
      const shown = (price: string | null, code: string | null) => (price === null ? "no price" : `${code ?? ""} ${Number(price).toLocaleString("en", { minimumFractionDigits: 2 })}`.trim());
      await evidence(tx, context, unit, {
        action: "UNIT_PRICE_CHANGED",
        message: `changed the asking price of ${unit.unitCode} from ${shown(oldPrice, profile.currency)} to ${shown(input.askingPrice, currency)}`,
        audit: { actionKey: AuditAction.UNIT_PRICE_CHANGED, before: { askingPrice: oldPrice, currency: profile.currency, priceBasis: profile.priceBasis }, after: { askingPrice: input.askingPrice, currency, priceBasis: input.priceBasis, reason: input.reason } },
      });
    }
    return { version: profile.version + 1 };
  });
}

/* On sale, off sale, holds (§8, §28) ----------------------------------------------- */

export async function changeSaleStatus(context: UserContext, unitId: string, input: z.infer<typeof saleStatusSchema>): Promise<{ status: UnitCommercialStatus; version: number }> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.sales_status.manage");
  if (input.action === "hold" && !input.reason) throw new AccessError("VALIDATION_ERROR", "Give a reason for the hold.", { reason: ["Give a reason for the hold."] });
  if (input.action === "hold" && input.holdUntil && input.holdUntil.getTime() <= Date.now()) throw new AccessError("VALIDATION_ERROR", "A hold ends in the future.", { holdUntil: ["A hold ends in the future."] });

  return runInTransaction("sales.unit.status", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    checkVersion(profile, input.expectedVersion);
    // Only a published, active unit is offered for sale (§6); taking one off sale is always allowed.
    if (input.action !== "take_off_sale") assertSellable(await unitPublication(tx, unit.id, context.companyId));
    const data =
      input.action === "hold"
        ? { holdReason: input.reason, holdUntil: input.holdUntil ?? null, heldByMemberId: context.membershipId }
        : { holdReason: null, holdUntil: null, heldByMemberId: null };
    const to = await move(tx, context, unit, profile, input.action, { reason: input.reason, data });
    const verbs = { put_on_sale: "put %s on sale", take_off_sale: "took %s off sale", hold: "put %s on hold", release_hold: "released the hold on %s" } as const;
    await evidence(tx, context, unit, {
      action: "UNIT_COMMERCIAL_STATUS_CHANGED",
      message: verbs[input.action].replace("%s", unit.unitCode),
      audit: { actionKey: AuditAction.UNIT_COMMERCIAL_STATUS_CHANGED, before: { status: profile.status, holdReason: profile.holdReason }, after: { status: to, holdReason: data.holdReason, holdUntil: data.holdUntil?.toISOString() ?? null } },
    });
    return { status: to, version: profile.version + 1 };
  });
}

/* Reserving (§16-§23, §47-§50) ------------------------------------------------------ */

const reserved = () => fail("UNIT_ALREADY_RESERVED", "This Unit has just been reserved by another user. Refresh to see the current status.", "CONFLICT");

export async function reserveUnit(context: UserContext, unitId: string, input: z.infer<typeof reserveSchema>): Promise<{ reservationId: string; clientId: string; opportunityId: string; version: number }> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.reserve");
  if (!input.clientId && !input.newClient) throw new AccessError("VALIDATION_ERROR", "Select a Client before reserving this Unit.", { clientId: ["Select a Client before reserving this Unit."] });
  if (input.clientId && input.newClient) throw new AccessError("VALIDATION_ERROR", "Choose a client or create one, not both.", { clientId: ["Choose a client or create one, not both."] });
  if (!input.opportunityId && !input.newDeal) throw new AccessError("VALIDATION_ERROR", "Create or select a Deal before reserving this Unit.", { opportunityId: ["Create or select a Deal before reserving this Unit."] });
  if (input.opportunityId && input.newDeal) throw new AccessError("VALIDATION_ERROR", "Choose a deal or create one, not both.", { opportunityId: ["Choose a deal or create one, not both."] });

  const settings = await resolveUnitSalesSettings(context.companyId);
  const now = Date.now();
  const expiresAt = input.expiresAt ?? defaultExpiry(new Date(now), settings.unitReservationDays);
  if (expiresAt.getTime() <= now) throw new AccessError("VALIDATION_ERROR", "A reservation expires in the future.", { expiresAt: ["A reservation expires in the future."] });
  if (expiresAt.getTime() > now + MAX_RESERVATION_DAYS * DAY) throw new AccessError("VALIDATION_ERROR", `A reservation lasts at most ${MAX_RESERVATION_DAYS} days.`, { expiresAt: [`A reservation lasts at most ${MAX_RESERVATION_DAYS} days.`] });

  // A new client that looks like one the company already has is offered back first, as the CRM does (§16, §62).
  if (input.newClient && !input.newClient.acceptDuplicate) {
    assertModule(context, "clients");
    const matches = await checkDuplicates(context, { name: input.newClient.name, email: input.newClient.email || undefined, phone: input.newClient.phone || undefined });
    if (matches.length > 0) throw new DuplicateClientError(matches);
  }

  // An existing client must be one this person may open, and a deal must belong to it (§22, §46).
  let existingClient: { id: string; name: string } | null = null;
  if (input.clientId) {
    assertModule(context, "clients");
    assertPermission(context, "client.view");
    existingClient = await prisma.client.findFirst({ where: { AND: [buildSalesClientWhere(context), { id: input.clientId }] }, select: { id: true, name: true } });
    if (!existingClient) throw invalidRecordLink("clientId", "CROSS_COMPANY_REFERENCE", "Choose a client you can open.");
  }
  let existingDeal: { id: string; name: string; clientId: string | null } | null = null;
  if (input.opportunityId) {
    assertModule(context, "sales");
    assertPermission(context, "sales.opportunity.view");
    const deal = await findOpportunityInScope(context, input.opportunityId);
    if (!deal) throw invalidRecordLink("opportunityId", "CROSS_COMPANY_REFERENCE", "Choose a deal you can open.");
    if (deal.archivedAt || deal.stage === "LOST") throw new AccessError("VALIDATION_ERROR", "That deal is closed. Choose an open deal.", { opportunityId: ["That deal is closed. Choose an open deal."] });
    if (!input.newClient && deal.clientId !== input.clientId) throw new AccessError("VALIDATION_ERROR", "That deal belongs to another client.", { opportunityId: ["That deal belongs to another client."] });
    if (input.newClient) throw new AccessError("VALIDATION_ERROR", "A new client has no deals yet. Create the deal with the reservation.", { opportunityId: ["A new client has no deals yet."] });
    existingDeal = { id: deal.id, name: deal.name, clientId: deal.clientId };
  }

  return runInTransaction("sales.unit.reserve", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    checkVersion(profile, input.expectedVersion);
    if (profile.status === "RESERVED") throw reserved();
    if (profile.status === "SOLD") throw fail("UNIT_SOLD", "This unit is already sold.", "CONFLICT");
    if (profile.status === "NOT_FOR_SALE") throw fail("UNIT_NOT_FOR_SALE", "This unit is not for sale. Put it on sale first.", "CONFLICT");
    assertSellable(await unitPublication(tx, unit.id, context.companyId));
    if (await activeReservation(tx, context.companyId, unit.id)) throw reserved();

    const agreedPrice = input.agreedPrice ?? null;
    const currency = input.currency ?? profile.currency ?? settings.baseCurrency;

    // The client and the deal: reused, or created through their own services in this transaction (§16, §17).
    let client = existingClient;
    if (input.newClient) {
      assertModule(context, "clients");
      const created = await createClientRecord(tx, context, createClientSchema.parse({ name: input.newClient.name, type: input.newClient.type, email: input.newClient.email || undefined, phone: input.newClient.phone || undefined, status: "ACTIVE", acceptDuplicate: true }));
      client = { id: created.id, name: created.name };
    }
    let dealId = existingDeal?.id ?? null;
    let dealName = existingDeal?.name ?? null;
    if (input.newDeal) {
      const value = agreedPrice ?? moneyText(profile.askingPrice);
      if (value === null || Number(value) <= 0) throw new AccessError("VALIDATION_ERROR", "Enter the agreed price, or set the unit's asking price, to open the deal.", { agreedPrice: ["Enter the agreed price to open the deal."] });
      dealName = input.newDeal.name || `${unit.unitCode} — ${client!.name}`;
      dealId = await createOpportunityInTransaction(
        tx,
        context,
        createOpportunitySchema.parse({ name: dealName, ownerMemberId: context.membershipId, stage: "NEGOTIATION", estimatedValue: value, currency, clientId: client!.id }),
        { clientCreatedInTransaction: input.newClient ? client!.id : undefined },
      );
    }

    const reservation = await tx.unitReservation
      .create({
        data: { companyId: context.companyId, projectId: unit.projectId, unitId: unit.id, clientId: client!.id, opportunityId: dealId!, expiresAt, agreedPrice: agreedPrice === null ? null : new Prisma.Decimal(agreedPrice), currency, notes: input.notes, createdByMemberId: context.membershipId },
        select: { id: true },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw reserved();
        throw error;
      });
    await move(tx, context, unit, profile, "reserve", { data: { holdReason: null, holdUntil: null, heldByMemberId: null, currency: profile.currency ?? currency }, reservationId: reservation.id, opportunityId: dealId });
    const linked = await linkUnitToDeal(tx, context, unit, dealId!, { agreedPrice, currency });

    await evidence(tx, context, unit, {
      action: "UNIT_RESERVED",
      message: `reserved ${unit.unitCode} until ${expiresAt.toISOString().slice(0, 10)}`,
      audit: { actionKey: AuditAction.UNIT_RESERVED, before: { status: profile.status }, after: { status: "RESERVED", reservationId: reservation.id, clientId: client!.id, opportunityId: dealId, expiresAt: expiresAt.toISOString(), agreedPrice, currency } },
    });
    if (linked) await recordUserAction(context, { actionKey: AuditAction.DEAL_UNIT_LINKED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, after: { opportunityId: dealId, unitId: unit.id, agreedPrice, currency } }, { tx });
    return { reservationId: reservation.id, clientId: client!.id, opportunityId: dealId!, version: profile.version + 1 };
  });
}

/** Puts the unit in the deal, or refreshes the agreed price it holds there (§17, §43). True when the link is new. */
async function linkUnitToDeal(tx: Tx, context: UserContext, unit: Unit, opportunityId: string, input: { agreedPrice: string | null; currency: string | null }): Promise<boolean> {
  const existing = await tx.opportunityUnit.findFirst({ where: { companyId: context.companyId, opportunityId, unitId: unit.id }, select: { id: true } });
  if (existing) {
    if (input.agreedPrice !== null) await tx.opportunityUnit.updateMany({ where: { companyId: context.companyId, id: existing.id }, data: { agreedPrice: new Prisma.Decimal(input.agreedPrice), currency: input.currency } });
    return false;
  }
  await tx.opportunityUnit.create({
    data: { companyId: context.companyId, projectId: unit.projectId, opportunityId, unitId: unit.id, agreedPrice: input.agreedPrice === null ? null : new Prisma.Decimal(input.agreedPrice), currency: input.currency, createdByMemberId: context.membershipId },
  });
  return true;
}

async function lockReservation(tx: Tx, context: UserContext, reservationId: string) {
  const row = await tx.unitReservation.findFirst({
    where: { companyId: context.companyId, id: reservationId },
    select: { id: true, unitId: true, status: true, clientId: true, opportunityId: true, expiresAt: true, agreedPrice: true, currency: true, notes: true, version: true, createdByMemberId: true, opportunity: { select: { ownerMemberId: true } } },
  });
  if (!row) throw fail("RESERVATION_NOT_FOUND", "That reservation could not be found.", "NOT_FOUND");
  return row;
}

/**
 * A unit under a live contract stays with its client (E-05F §8, §82): the
 * reservation is not released and the sale not reopened until Legal cancels or
 * terminates the contract. Read from Legal's table, never written here.
 */
async function assertNoLiveContract(tx: Tx, companyId: string, unitId: string, verb: "released" | "reopened") {
  const live = await tx.contractUnit.findFirst({ where: { companyId, unitId, releasedAt: null }, select: { contract: { select: { contractNumber: true } } } });
  if (live) throw fail("UNIT_UNDER_CONTRACT", `This unit is under contract ${live.contract.contractNumber}. Legal cancels or terminates the contract before the unit is ${verb}.`, "CONFLICT");
}

function assertActive(reservation: { status: string }) {
  if (reservation.status !== "ACTIVE") throw fail("RESERVATION_NOT_ACTIVE", "This reservation has already ended. Refresh to see the current status.", "CONFLICT");
}

/** A later expiry, with a reason; the old and new dates stay on record (§26). */
export async function extendReservation(context: UserContext, reservationId: string, input: z.infer<typeof extendReservationSchema>): Promise<{ expiresAt: string }> {
  const { unit } = await findReadableReservation(context, reservationId);
  assertPermission(context, "project.unit.reservation.extend");

  return runInTransaction("sales.unit.reservation.extend", async (tx) => {
    await lockedProfile(tx, unit);
    const reservation = await lockReservation(tx, context, reservationId);
    assertActive(reservation);
    if (input.expectedVersion !== undefined && reservation.version !== input.expectedVersion) throw fail("RESERVATION_STALE", "This reservation was updated by another user. Refresh before continuing.", "CONFLICT");
    if (input.expiresAt.getTime() <= reservation.expiresAt.getTime()) throw new AccessError("VALIDATION_ERROR", "Choose a later date than the current expiry.", { expiresAt: ["Choose a later date than the current expiry."] });
    if (input.expiresAt.getTime() > Date.now() + MAX_RESERVATION_DAYS * DAY) throw new AccessError("VALIDATION_ERROR", `A reservation lasts at most ${MAX_RESERVATION_DAYS} days from now.`, { expiresAt: [`At most ${MAX_RESERVATION_DAYS} days from now.`] });

    const moved = await tx.unitReservation.updateMany({
      where: { id: reservation.id, companyId: context.companyId, status: "ACTIVE", version: reservation.version },
      // A new expiry earns a new "expires in 24 hours" warning.
      data: { expiresAt: input.expiresAt, expiryWarnedAt: null, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("RESERVATION_STALE", "This reservation was updated by another user. Refresh before continuing.", "CONFLICT");
    await tx.unitReservationExtension.create({ data: { companyId: context.companyId, reservationId: reservation.id, oldExpiresAt: reservation.expiresAt, newExpiresAt: input.expiresAt, reason: input.reason, extendedByMemberId: context.membershipId } });
    await evidence(tx, context, unit, {
      action: "UNIT_RESERVATION_EXTENDED",
      message: `extended the reservation of ${unit.unitCode} to ${input.expiresAt.toISOString().slice(0, 10)}`,
      audit: { actionKey: AuditAction.UNIT_RESERVATION_EXTENDED, before: { reservationId: reservation.id, expiresAt: reservation.expiresAt.toISOString() }, after: { reservationId: reservation.id, expiresAt: input.expiresAt.toISOString(), reason: input.reason } },
    });
    return { expiresAt: input.expiresAt.toISOString() };
  });
}

/** Ends the reservation early with a reason; the unit is for sale again (§27). */
export async function releaseReservation(context: UserContext, reservationId: string, input: z.infer<typeof releaseReservationSchema>): Promise<{ status: UnitCommercialStatus }> {
  const { unit } = await findReadableReservation(context, reservationId);
  assertPermission(context, "project.unit.reservation.release");

  return runInTransaction("sales.unit.reservation.release", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    const reservation = await lockReservation(tx, context, reservationId);
    assertActive(reservation);
    await assertNoLiveContract(tx, context.companyId, unit.id, "released");
    await cancelSaleApprovals(tx, context, context.companyId, unit.id);
    if (!(await closeReservation(tx, { companyId: context.companyId, reservationId: reservation.id, status: "RELEASED", closedByMemberId: context.membershipId, reason: input.reason }))) {
      throw fail("RESERVATION_NOT_ACTIVE", "This reservation has already ended. Refresh to see the current status.", "CONFLICT");
    }
    const to = await move(tx, context, unit, profile, "release_reservation", { reason: input.reason, reservationId: reservation.id, opportunityId: reservation.opportunityId });
    await evidence(tx, context, unit, {
      action: "UNIT_RESERVATION_RELEASED",
      message: `released the reservation of ${unit.unitCode}`,
      audit: { actionKey: AuditAction.UNIT_RESERVATION_RELEASED, before: { status: profile.status, reservationStatus: "ACTIVE" }, after: { status: to, reservationId: reservation.id, reservationStatus: "RELEASED", reason: input.reason } },
    });
    await notifyReservation(tx, { eventType: NotificationEvent.UNIT_RESERVATION_RELEASED, companyId: context.companyId, unit: unitRef(unit), reservationId: reservation.id, memberIds: reservationAudience(reservation), actorMemberId: context.membershipId });
    return { status: to };
  });
}

/** An administrative correction of the agreed price or notes, with a reason (§38 sales_correct). */
export async function correctReservation(context: UserContext, reservationId: string, input: z.infer<typeof correctReservationSchema>): Promise<void> {
  const { unit } = await findReadableReservation(context, reservationId);
  assertPermission(context, "project.unit.sales_correct");

  await runInTransaction("sales.unit.reservation.correct", async (tx) => {
    await lockedProfile(tx, unit);
    const reservation = await lockReservation(tx, context, reservationId);
    assertActive(reservation);
    const currency = input.currency ?? reservation.currency;
    const moved = await tx.unitReservation.updateMany({
      where: { id: reservation.id, companyId: context.companyId, status: "ACTIVE", version: reservation.version },
      data: { agreedPrice: input.agreedPrice === null ? null : new Prisma.Decimal(input.agreedPrice), currency, notes: input.notes, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("RESERVATION_STALE", "This reservation was updated by another user. Refresh before continuing.", "CONFLICT");
    if (input.agreedPrice !== null) {
      await tx.opportunityUnit.updateMany({ where: { companyId: context.companyId, opportunityId: reservation.opportunityId, unitId: unit.id }, data: { agreedPrice: new Prisma.Decimal(input.agreedPrice), currency } });
    }
    await evidence(tx, context, unit, {
      action: "UNIT_RESERVATION_CORRECTED",
      message: `corrected the reservation of ${unit.unitCode}`,
      audit: {
        actionKey: AuditAction.UNIT_RESERVATION_CORRECTED,
        before: { reservationId: reservation.id, agreedPrice: moneyText(reservation.agreedPrice), currency: reservation.currency, notes: reservation.notes },
        after: { reservationId: reservation.id, agreedPrice: input.agreedPrice, currency, notes: input.notes, reason: input.reason },
      },
    });
  });
}

/* The sale (§29-§31, §42) ------------------------------------------------------------ */

export async function markUnitSold(context: UserContext, unitId: string, input: { expectedVersion?: number }): Promise<{ status: UnitCommercialStatus }> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.mark_sold");
  const settings = await resolveUnitSalesSettings(context.companyId);

  return runInTransaction("sales.unit.mark_sold", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    checkVersion(profile, input.expectedVersion);
    const reservation = await activeReservation(tx, context.companyId, unit.id);
    // The company's Sold rule, read under the unit's lock (E-05F §42, §43).
    const readiness = await unitSaleReadiness(tx, context.companyId, unit.id);
    const approval = reservation ? await latestSaleApproval(tx, context.companyId, unit.id, reservation.id) : null;
    const check = canMarkUnitSold({
      status: profile.status,
      reservation: reservation ? { status: "ACTIVE", clientId: reservation.clientId, opportunityId: reservation.opportunityId, agreedPrice: moneyText(reservation.agreedPrice), expiresAt: reservation.expiresAt } : null,
      rule: settings.unitSoldRule,
      contract: readiness.contract ? { signed: readiness.signed } : null,
      deposit: readiness.deposit,
      approval,
    });
    if (!check.allowed) throw fail("UNIT_NOT_SELLABLE_YET", `This unit cannot be marked Sold. Missing: ${check.missing.join(", ")}.`, "VALIDATION_ERROR", { missing: check.missing });

    await closeReservation(tx, { companyId: context.companyId, reservationId: reservation!.id, status: "CONVERTED_TO_SALE", closedByMemberId: context.membershipId, reason: null });
    const to = await move(tx, context, unit, profile, "mark_sold", { reservationId: reservation!.id, opportunityId: reservation!.opportunityId });
    await evidence(tx, context, unit, {
      action: "UNIT_MARKED_SOLD",
      message: `marked ${unit.unitCode} Sold`,
      audit: {
        actionKey: AuditAction.UNIT_MARKED_SOLD,
        before: { status: profile.status, reservationStatus: "ACTIVE" },
        after: { status: to, reservationId: reservation!.id, reservationStatus: "CONVERTED_TO_SALE", clientId: reservation!.clientId, opportunityId: reservation!.opportunityId, agreedPrice: moneyText(reservation!.agreedPrice), currency: reservation!.currency },
      },
    });
    await notifyReservation(tx, { eventType: NotificationEvent.UNIT_MARKED_SOLD, companyId: context.companyId, unit: unitRef(unit), reservationId: reservation!.id, memberIds: reservationAudience(reservation!), actorMemberId: context.membershipId });
    return { status: to };
  });
}

/**
 * Reopening a sold unit (§31): elevated, with a reason. Back to For Sale, the sale's
 * reservation is cancelled; back to Reserved, the sale's reservation is cancelled
 * and a new active one carries the same client, deal and agreed price — history is
 * added to, never rewritten.
 */
export async function reopenSale(context: UserContext, unitId: string, input: z.infer<typeof reopenSaleSchema>): Promise<{ status: UnitCommercialStatus; reservationId: string | null }> {
  const unit = await findSellableUnit(context, unitId);
  assertPermission(context, "project.unit.reopen_sale");
  const settings = await resolveUnitSalesSettings(context.companyId);
  const expiresAt = input.to === "RESERVED" ? (input.expiresAt ?? defaultExpiry(new Date(), settings.unitReservationDays)) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new AccessError("VALIDATION_ERROR", "A reservation expires in the future.", { expiresAt: ["A reservation expires in the future."] });

  return runInTransaction("sales.unit.reopen", async (tx) => {
    const profile = await lockedProfile(tx, unit);
    checkVersion(profile, input.expectedVersion);
    await assertNoLiveContract(tx, context.companyId, unit.id, "reopened");
    const sale = await tx.unitReservation.findFirst({
      where: { companyId: context.companyId, unitId: unit.id, status: "CONVERTED_TO_SALE" },
      orderBy: { closedAt: "desc" },
      select: { id: true, clientId: true, opportunityId: true, agreedPrice: true, currency: true, notes: true, status: true },
    });
    let reservationId: string | null = null;
    if (sale) {
      await tx.unitReservation.updateMany({ where: { id: sale.id, companyId: context.companyId, status: "CONVERTED_TO_SALE" }, data: { status: "CANCELLED", closeReason: input.reason, closedByMemberId: context.membershipId, version: { increment: 1 } } });
    }
    if (input.to === "RESERVED") {
      if (!sale) throw fail("UNIT_NO_SALE_TO_RESERVE", "There is no sale to go back to a reservation from. Reopen it for sale instead.", "CONFLICT");
      const created = await tx.unitReservation.create({
        data: { companyId: context.companyId, projectId: unit.projectId, unitId: unit.id, clientId: sale.clientId, opportunityId: sale.opportunityId, expiresAt: expiresAt!, agreedPrice: sale.agreedPrice, currency: sale.currency, notes: sale.notes, createdByMemberId: context.membershipId },
        select: { id: true },
      });
      reservationId = created.id;
    }
    const to = await move(tx, context, unit, profile, "reopen", { to: input.to, reason: input.reason, reservationId: reservationId ?? sale?.id ?? null, opportunityId: sale?.opportunityId ?? null });
    await evidence(tx, context, unit, {
      action: "UNIT_SALE_REOPENED",
      message: `reopened the sale of ${unit.unitCode}`,
      audit: { actionKey: AuditAction.UNIT_SALE_REOPENED, before: { status: profile.status, reservationId: sale?.id ?? null, reservationStatus: sale ? "CONVERTED_TO_SALE" : null }, after: { status: to, reservationId: reservationId ?? sale?.id ?? null, reservationStatus: reservationId ? "ACTIVE" : sale ? "CANCELLED" : null, reason: input.reason } },
    });
    return { status: to, reservationId };
  });
}

/* Units in a deal (§17, §18, §43) ------------------------------------------------------ */

async function findDeal(context: UserContext, opportunityId: string) {
  assertModule(context, "sales");
  assertPermission(context, "sales.opportunity.view");
  const deal = await prisma.opportunity.findFirst({ where: { AND: [buildOpportunityScopeWhere(context), { id: opportunityId }] }, select: { id: true, name: true, archivedAt: true, stage: true } });
  if (!deal) throw fail("OPPORTUNITY_NOT_FOUND", "That opportunity could not be found.", "NOT_FOUND");
  return deal;
}

export type DealUnitDTO = { unitId: string; unitCode: string; projectId: string; projectName: string; building: string; floor: string; unitType: string; status: UnitCommercialStatus; agreedPrice: string | null; currency: string | null; reservation: { status: string; expiresAt: string } | null; href: string };

/** The units in a deal, as far as the reader may open them (§17). */
export async function listDealUnits(context: UserContext, opportunityId: string): Promise<DealUnitDTO[]> {
  const deal = await findDeal(context, opportunityId);
  const { readableUnitWhere } = await import("@/lib/modules/project-structure/structure.permissions");
  const links = await prisma.opportunityUnit.findMany({
    where: { companyId: context.companyId, opportunityId: deal.id, unit: { is: readableUnitWhere(context) } },
    orderBy: { createdAt: "asc" },
    select: {
      agreedPrice: true,
      currency: true,
      unit: {
        select: {
          id: true,
          unitCode: true,
          projectId: true,
          project: { select: { name: true } },
          unitType: { select: { name: true } },
          floor: { select: { name: true, building: { select: { name: true } } } },
          commercialProfile: { select: { status: true } },
          reservations: { where: { opportunityId: deal.id }, orderBy: { reservedAt: "desc" }, take: 1, select: { status: true, expiresAt: true } },
        },
      },
    },
  });
  return links.map(({ unit, agreedPrice, currency }) => ({
    unitId: unit.id,
    unitCode: unit.unitCode,
    projectId: unit.projectId,
    projectName: unit.project.name,
    building: unit.floor.building.name,
    floor: unit.floor.name,
    unitType: unit.unitType.name,
    status: unit.commercialProfile?.status ?? "NOT_FOR_SALE",
    agreedPrice: moneyText(agreedPrice),
    currency,
    reservation: unit.reservations[0] ? { status: unit.reservations[0].status, expiresAt: unit.reservations[0].expiresAt.toISOString() } : null,
    href: `/projects/${unit.projectId}/units/${unit.id}/sales`,
  }));
}

/** A unit the client is interested in, in the deal without a reservation yet (§17, §43). */
export async function addUnitToDeal(context: UserContext, opportunityId: string, input: z.infer<typeof dealUnitSchema>): Promise<void> {
  const deal = await findDeal(context, opportunityId);
  assertPermission(context, "sales.opportunity.update");
  if (deal.archivedAt || deal.stage === "LOST") throw fail("OPPORTUNITY_CLOSED", "That opportunity is closed.", "CONFLICT");
  const unit = await findSellableUnit(context, input.unitId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") throw invalidRecordLink("unitId", "CROSS_PROJECT_REFERENCE", "Choose a unit you can open.");
    throw error;
  });
  await runInTransaction("sales.deal.unit.link", async (tx) => {
    const linked = await linkUnitToDeal(tx, context, unit, deal.id, { agreedPrice: input.agreedPrice ?? null, currency: input.currency ?? null });
    if (!linked) throw fail("DEAL_UNIT_EXISTS", `${unit.unitCode} is already in this opportunity.`, "CONFLICT");
    await evidence(tx, context, unit, {
      action: "DEAL_UNIT_LINKED",
      message: `added ${unit.unitCode} to an opportunity`,
      audit: { actionKey: AuditAction.DEAL_UNIT_LINKED, after: { opportunityId: deal.id, unitId: unit.id, agreedPrice: input.agreedPrice ?? null, currency: input.currency ?? null } },
    });
  });
}

/** Takes a unit out of a deal — never one the deal holds reserved or sold (§18). */
export async function removeUnitFromDeal(context: UserContext, opportunityId: string, unitId: string): Promise<void> {
  const deal = await findDeal(context, opportunityId);
  assertPermission(context, "sales.opportunity.update");
  const unit = await findSellableUnit(context, unitId);
  await runInTransaction("sales.deal.unit.unlink", async (tx) => {
    const holding = await tx.unitReservation.count({ where: { companyId: context.companyId, unitId: unit.id, opportunityId: deal.id, status: { in: ["ACTIVE", "CONVERTED_TO_SALE"] } } });
    if (holding) throw fail("DEAL_UNIT_HELD", `This opportunity holds ${unit.unitCode} reserved or sold. Release the reservation or reopen the sale first.`, "CONFLICT");
    const removed = await tx.opportunityUnit.deleteMany({ where: { companyId: context.companyId, opportunityId: deal.id, unitId: unit.id } });
    if (!removed.count) throw fail("DEAL_UNIT_NOT_FOUND", `${unit.unitCode} is not in this opportunity.`, "NOT_FOUND");
    await evidence(tx, context, unit, {
      action: "DEAL_UNIT_UNLINKED",
      message: `removed ${unit.unitCode} from an opportunity`,
      audit: { actionKey: AuditAction.DEAL_UNIT_UNLINKED, before: { opportunityId: deal.id, unitId: unit.id } },
    });
  });
}

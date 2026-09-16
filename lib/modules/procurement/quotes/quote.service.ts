import { Prisma, type SupplierQuoteStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import {
  canSeeQuotePricing,
  dateString,
  toAmountString,
  toSupplierRef,
} from "../procurement.dto";
import { lineTotals, quantityString, sumLineTotals } from "../procurement.money";
import { buildQuoteScopeWhere, buildRfqScopeWhere } from "../procurement.scope";
import type { QuoteInput } from "../procurement.schema";
import {
  acceptsQuotes,
  canTransitionQuoteStatus,
  isQuoteEditable,
  isQuoteSelectable,
} from "../procurement.status";
import type { QuoteComparisonDTO, QuoteDTO, QuoteItemDTO } from "../procurement.types";
import { supplierQuoteMachine } from "./quote.machine";

/**
 * Supplier quotes and the comparison (PRD #19 §78–§94).
 *
 * A quote is what one supplier answered. It is commercially confidential to the
 * buying side: a reader without `procurement.quote.view` is told an enquiry
 * exists and never what anybody bid on it. The price does not leave the server
 * — `pricing: null`, not a hidden figure (PRD #19 §260).
 *
 * Selecting a winner is one transaction: the chosen quote becomes SELECTED and
 * every other qualified answer becomes NOT_SELECTED, so a comparison can never
 * show two winners (PRD #19 §94, §211).
 */

const MODULE = "procurement" as const;

const QUOTE_SELECT = {
  id: true,
  rfqId: true,
  quoteNumber: true,
  quoteDate: true,
  validUntil: true,
  currency: true,
  subtotal: true,
  taxAmount: true,
  totalAmount: true,
  leadTimeDays: true,
  deliveryDate: true,
  status: true,
  disqualificationReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true, status: true } },
  items: {
    select: {
      id: true,
      rfqItemId: true,
      quantity: true,
      unitPrice: true,
      taxRate: true,
      totalAmount: true,
      notes: true,
      rfqItem: { select: { id: true, description: true, unit: true, sortOrder: true } },
    },
  },
} satisfies Prisma.SupplierQuoteSelect;

type QuoteRow = Prisma.SupplierQuoteGetPayload<{ select: typeof QUOTE_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listForRfq(context: UserContext, rfqId: string): Promise<QuoteDTO[]> {
  if (!can(context, "procurement.rfq.view")) return [];

  // The quote list inherits the enquiry: one answer to "may they see this?".
  const reachable = await prisma.rFQ.findFirst({
    where: { AND: [buildRfqScopeWhere(context), { id: rfqId }] },
    select: { id: true },
  });
  if (!reachable) return [];

  const rows = await prisma.supplierQuote.findMany({
    where: { rfqId },
    orderBy: [{ totalAmount: "asc" }, { supplier: { name: "asc" } }],
    select: QUOTE_SELECT,
  });

  const today = new Date();
  return rows.map((row) => toDTO(context, row, today));
}

export async function getQuote(context: UserContext, quoteId: string): Promise<QuoteDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.quote.view");

  const row = assertFound(
    await prisma.supplierQuote.findFirst({
      where: { AND: [buildQuoteScopeWhere(context), { id: quoteId }] },
      select: QUOTE_SELECT,
    }),
  );

  return toDTO(context, row, new Date());
}

/**
 * The comparison grid (PRD #19 §88–§91).
 *
 * Ranked on total price and lead time among the *qualified* answers only: a
 * disqualified quote is shown so the record is complete, but it does not win a
 * comparison it was excluded from.
 *
 * A reader without quote access still sees who was asked and who answered. They
 * see no figures and no ranking, because a ranking is a statement about the
 * prices it was computed from (PRD #19 §261).
 */
export async function compareQuotes(
  context: UserContext,
  rfqId: string,
): Promise<QuoteComparisonDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.view");

  const rfq = assertFound(
    await prisma.rFQ.findFirst({
      where: { AND: [buildRfqScopeWhere(context), { id: rfqId }] },
      select: {
        id: true,
        rfqNumber: true,
        title: true,
        status: true,
        currency: true,
        responseDueDate: true,
        updatedAt: true,
        project: { select: { id: true, code: true, name: true } },
        purchaseRequest: { select: { requestNumber: true } },
        suppliers: { select: { status: true } },
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            description: true,
            quantity: true,
            unit: true,
            specification: true,
            sortOrder: true,
          },
        },
      },
    }),
  );

  const quotes = await prisma.supplierQuote.findMany({
    where: { rfqId },
    orderBy: { supplier: { name: "asc" } },
    select: QUOTE_SELECT,
  });

  const canCompare = canSeeQuotePricing(context);

  // Ranks are computed over the qualified answers only.
  const qualified = quotes.filter(
    (quote) => quote.status !== "DISQUALIFIED" && quote.status !== "DRAFT",
  );

  const byPrice = [...qualified].sort((a, b) => a.totalAmount.comparedTo(b.totalAmount));
  const byLead = [...qualified]
    .filter((quote) => quote.leadTimeDays !== null)
    .sort((a, b) => (a.leadTimeDays ?? 0) - (b.leadTimeDays ?? 0));

  const priceRank = new Map(byPrice.map((quote, index) => [quote.id, index + 1]));
  const leadRank = new Map(byLead.map((quote, index) => [quote.id, index + 1]));
  const lowestId = byPrice[0]?.id ?? null;

  return {
    rfq: {
      id: rfq.id,
      rfqNumber: rfq.rfqNumber,
      title: rfq.title,
      status: rfq.status,
      currency: rfq.currency,
      project: rfq.project,
      requestNumber: rfq.purchaseRequest?.requestNumber ?? null,
      responseDueDate: dateString(rfq.responseDueDate),
      overdue: false,
      invitedCount: rfq.suppliers.length,
      respondedCount: rfq.suppliers.filter((entry) => entry.status === "RESPONDED").length,
      updatedAt: rfq.updatedAt.toISOString(),
    },
    items: rfq.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: quantityString(item.quantity),
      unit: item.unit,
      specification: item.specification,
      sortOrder: item.sortOrder,
    })),
    rows: quotes.map((quote) => ({
      quoteId: quote.id,
      supplier: toSupplierRef(quote.supplier)!,
      status: quote.status,
      pricing: canCompare
        ? {
            currency: quote.currency,
            subtotal: toAmountString(quote.subtotal),
            taxAmount: toAmountString(quote.taxAmount),
            totalAmount: toAmountString(quote.totalAmount),
          }
        : null,
      leadTimeDays: quote.leadTimeDays,
      priceRank: canCompare ? (priceRank.get(quote.id) ?? null) : null,
      leadTimeRank: canCompare ? (leadRank.get(quote.id) ?? null) : null,
      isLowest: canCompare && quote.id === lowestId,
      itemTotals: Object.fromEntries(
        rfq.items.map((item) => {
          const line = quote.items.find((entry) => entry.rfqItemId === item.id);
          return [item.id, canCompare && line ? toAmountString(line.totalAmount) : null];
        }),
      ),
    })),
    canCompare,
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createQuote(
  context: UserContext,
  rfqId: string,
  input: QuoteInput,
): Promise<QuoteDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.quote.create");

  const rfq = await loadRfqForWrite(context, rfqId);

  if (!acceptsQuotes(rfq.status)) {
    throw new AccessError(
      "CONFLICT",
      "Quotes can only be recorded against an issued enquiry.",
      { code: "RFQ_NOT_OPEN" },
    );
  }

  const invited = await prisma.rFQSupplier.findFirst({
    where: { rfqId, supplierId: input.supplierId },
    select: { id: true, status: true },
  });

  if (!invited) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That supplier was not invited to this enquiry.",
      { code: "SUPPLIER_NOT_INVITED" },
    );
  }

  const lines = await resolveLines(rfqId, input);
  const totals = sumLineTotals(lines.map((line) => line.totals));

  const id = await prisma.$transaction(async (tx) => {
    const quote = await tx.supplierQuote.create({
      data: {
        companyId: context.companyId,
        rfqId,
        supplierId: input.supplierId,
        quoteNumber: input.quoteNumber ?? null,
        quoteDate: input.quoteDate,
        validUntil: input.validUntil ?? null,
        // A quote is priced in the enquiry's currency: comparing two currencies
        // is not a comparison V0.1 can make (PRD #19 §83).
        currency: rfq.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        leadTimeDays: input.leadTimeDays ?? null,
        deliveryDate: input.deliveryDate ?? null,
        status: "RECEIVED",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        items: {
          create: lines.map((line) => ({
            rfqItemId: line.rfqItemId,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            taxRate: new Prisma.Decimal(line.taxRate),
            subtotal: line.totals.subtotal,
            taxAmount: line.totals.taxAmount,
            totalAmount: line.totals.totalAmount,
            notes: line.notes,
          })),
        },
      },
      select: { id: true },
    });

    // The invitation has no company or machine of its own, so the status it
    // was read in is its guard: one removed from the enquiry, or answered by
    // another quote, meanwhile is not quietly written over.
    const responded = await tx.rFQSupplier.updateMany({
      where: { rfqId, supplierId: input.supplierId, status: invited.status },
      data: { status: "RESPONDED", respondedAt: new Date() },
    });
    if (responded.count === 0) throw staleInvitation();

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "RFQ",
      entityId: rfqId,
      action: "PROCUREMENT_QUOTE_RECORDED",
      // The message names the supplier and not the price: everybody who can see
      // the enquiry reads this, and not everybody may see figures (§174, §260).
      message: `recorded a quote on enquiry ${rfq.rfqNumber}`,
      metadata: { quoteId: quote.id } as Prisma.InputJsonValue,
    });

    return quote.id;
  });

  return getQuote(context, id);
}

export async function updateQuote(
  context: UserContext,
  quoteId: string,
  input: QuoteInput,
): Promise<QuoteDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.quote.update");

  const existing = await loadForWrite(context, quoteId);

  if (!isQuoteEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "A selected or disqualified quote is a decision on the record. It cannot be edited.",
      { code: "QUOTE_NOT_EDITABLE" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const lines = await resolveLines(existing.rfqId, input);
  const totals = sumLineTotals(lines.map((line) => line.totals));

  await prisma.$transaction(async (tx) => {
    await tx.supplierQuoteItem.deleteMany({ where: { supplierQuoteId: quoteId } });

    await tx.supplierQuote.update({
      where: { id: quoteId },
      data: {
        quoteNumber: input.quoteNumber ?? null,
        quoteDate: input.quoteDate,
        validUntil: input.validUntil ?? null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        leadTimeDays: input.leadTimeDays ?? null,
        deliveryDate: input.deliveryDate ?? null,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
        items: {
          create: lines.map((line) => ({
            rfqItemId: line.rfqItemId,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            taxRate: new Prisma.Decimal(line.taxRate),
            subtotal: line.totals.subtotal,
            taxAmount: line.totals.taxAmount,
            totalAmount: line.totals.totalAmount,
            notes: line.notes,
          })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "RFQ",
      entityId: existing.rfqId,
      action: "PROCUREMENT_QUOTE_UPDATED",
      message: `updated a quote on enquiry ${existing.rfqNumber}`,
    });
  });

  return getQuote(context, quoteId);
}

export async function disqualifyQuote(
  context: UserContext,
  quoteId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.quote.disqualify");

  const existing = await loadForWrite(context, quoteId);

  if (!canTransitionQuoteStatus(existing.status, "DISQUALIFIED")) {
    throw new AccessError("CONFLICT", "This quote can no longer be disqualified.", {
      code: "INVALID_TRANSITION",
    });
  }

  const invitation = await prisma.rFQSupplier.findFirst({
    where: { rfqId: existing.rfqId, supplierId: existing.supplierId },
    select: { status: true },
  });

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: supplierQuoteMachine,
      action: "disqualify",
      id: quoteId,
      context,
      from: existing.status,
      data: { disqualificationReason: reason },
    });

    // The supplier's invitation follows its quote, from the status it was read
    // in. A quote whose invitation is gone has nothing to follow.
    if (invitation) {
      const disqualified = await tx.rFQSupplier.updateMany({
        where: { rfqId: existing.rfqId, supplierId: existing.supplierId, status: invitation.status },
        data: { status: "DISQUALIFIED" },
      });
      if (disqualified.count === 0) throw staleInvitation();
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "RFQ",
      entityId: existing.rfqId,
      action: "PROCUREMENT_QUOTE_DISQUALIFIED",
      message: `disqualified a quote on enquiry ${existing.rfqNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Picks the winner (PRD #19 §92, §94, §211).
 *
 * One transaction: the chosen quote becomes SELECTED and every other qualified
 * answer becomes NOT_SELECTED, so the comparison can never show two winners.
 * Selecting again on an enquiry that already has one is refused rather than
 * quietly moving the award.
 */
export async function selectQuote(context: UserContext, quoteId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.quote.select");

  const existing = await loadForWrite(context, quoteId);

  if (!isQuoteSelectable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Only a received quote can be selected.",
      { code: "INVALID_TRANSITION" },
    );
  }

  await prisma.$transaction(async (tx) => {
    const alreadySelected = await tx.supplierQuote.findFirst({
      where: { rfqId: existing.rfqId, status: "SELECTED" },
      select: { id: true },
    });

    if (alreadySelected) {
      throw new AccessError(
        "CONFLICT",
        "This enquiry already has a selected quote. Raise an order from it, or disqualify it first.",
        { code: "QUOTE_ALREADY_SELECTED" },
      );
    }

    // Conditional on the status read, so two selections racing settle once.
    await applyTransition(tx, {
      machine: supplierQuoteMachine,
      action: "select",
      id: quoteId,
      context,
      from: existing.status,
    });

    // Every other answer still standing is passed over, each from the status
    // it was read in, so a quote decided some other way meanwhile is not
    // written over.
    const others = await tx.supplierQuote.findMany({
      where: { rfqId: existing.rfqId, id: { not: quoteId }, status: "RECEIVED" },
      select: { id: true, status: true },
    });
    for (const other of others) {
      await applyTransition(tx, {
        machine: supplierQuoteMachine,
        action: "pass_over",
        id: other.id,
        context,
        from: other.status,
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "RFQ",
      entityId: existing.rfqId,
      action: "PROCUREMENT_QUOTE_SELECTED",
      message: `selected a quote on enquiry ${existing.rfqNumber}`,
      metadata: { quoteId } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadRfqForWrite(context: UserContext, rfqId: string) {
  return assertFound(
    await prisma.rFQ.findFirst({
      where: { AND: [buildRfqScopeWhere(context), { id: rfqId }] },
      select: { id: true, rfqNumber: true, status: true, currency: true },
    }),
  );
}

async function loadForWrite(context: UserContext, quoteId: string) {
  const row = assertFound(
    await prisma.supplierQuote.findFirst({
      where: { AND: [buildQuoteScopeWhere(context), { id: quoteId }] },
      select: {
        id: true,
        rfqId: true,
        supplierId: true,
        status: true,
        updatedAt: true,
        rfq: { select: { rfqNumber: true } },
      },
    }),
  );

  return { ...row, rfqNumber: row.rfq.rfqNumber };
}

function staleInvitation(): AccessError {
  return new AccessError(
    "CONFLICT",
    "This supplier's invitation to the enquiry changed while you were working. Reload to see the latest.",
    { code: "RFQ_SUPPLIER_STALE" },
  );
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this quote while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

/** Prices the lines against the enquiry's own items (PRD #19 §81, §82). */
async function resolveLines(rfqId: string, input: QuoteInput) {
  const items = await prisma.rFQItem.findMany({
    where: { rfqId },
    select: { id: true },
  });
  const valid = new Set(items.map((item) => item.id));

  for (const line of input.items) {
    if (!valid.has(line.rfqItemId)) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "A priced line does not belong to this enquiry.",
        { code: "INVALID_QUOTE_LINE" },
      );
    }
  }

  return input.items.map((line) => ({
    rfqItemId: line.rfqItemId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    notes: line.notes ?? null,
    totals: lineTotals(line),
  }));
}

function toDTO(context: UserContext, row: QuoteRow, today: Date): QuoteDTO {
  const pricing = canSeeQuotePricing(context);

  const items: QuoteItemDTO[] = [...row.items]
    .sort((a, b) => a.rfqItem.sortOrder - b.rfqItem.sortOrder)
    .map((item) => ({
      id: item.id,
      rfqItemId: item.rfqItemId,
      description: item.rfqItem.description,
      unit: item.rfqItem.unit,
      quantity: quantityString(item.quantity),
      pricing: pricing
        ? {
            unitPrice: quantityString(item.unitPrice),
            taxRate: item.taxRate.toString(),
            totalAmount: toAmountString(item.totalAmount),
          }
        : null,
      notes: item.notes,
    }));

  return {
    id: row.id,
    rfqId: row.rfqId,
    supplier: toSupplierRef(row.supplier)!,
    quoteNumber: row.quoteNumber,
    quoteDate: dateString(row.quoteDate)!,
    validUntil: dateString(row.validUntil),
    // A quote past its validity is still on the record; it is simply no longer
    // something the company may rely on (PRD #19 §79).
    expired: row.validUntil !== null && row.validUntil.getTime() < today.getTime(),
    status: row.status,
    pricing: pricing
      ? {
          currency: row.currency,
          subtotal: toAmountString(row.subtotal),
          taxAmount: toAmountString(row.taxAmount),
          totalAmount: toAmountString(row.totalAmount),
        }
      : null,
    leadTimeDays: row.leadTimeDays,
    deliveryDate: dateString(row.deliveryDate),
    disqualificationReason: row.disqualificationReason,
    notes: row.notes,
    items,
    capabilities: {
      canEdit: isQuoteEditable(row.status) && can(context, "procurement.quote.update"),
      canSelect: isQuoteSelectable(row.status) && can(context, "procurement.quote.select"),
      canDisqualify:
        canTransitionQuoteStatus(row.status, "DISQUALIFIED") &&
        can(context, "procurement.quote.disqualify"),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type { SupplierQuoteStatus };

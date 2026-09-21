import { Prisma } from "@prisma/client";

import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { buildSupplierWhere } from "../procurement.scope";
import type { SupplierDetailDTO, SupplierSummaryDTO } from "../procurement.types";
import {
  companyFilterOptions,
  groupProcurementContexts,
  narrowToCompany,
  unionWhere,
} from "../procurement.workspace";
import type { SupplierInput, SupplierListQuery } from "../procurement.schema";
import { supplierStatusLabels } from "../procurement.status";
import { supplierMachine } from "./supplier.machine";

/**
 * Suppliers (PRD #19 §10, §26–§40).
 *
 * A supplier is who we buy from. It is deliberately not a Client with a flag:
 * a Client is who pays us, a Supplier is who we pay, and V0.1 records an
 * organisation that is both twice on purpose rather than merging two different
 * commercial relationships into one row (PRD #19 §3, §11).
 *
 * The directory is company-wide rather than project-scoped. Knowing the company
 * buys from Atlas Materials is not knowing what it paid — the confidentiality
 * lives on the buying documents, not the counterparty (PRD #19 §222).
 */

const MODULE = "procurement" as const;
const ENTITY = "Supplier";

const SUPPLIER_SELECT = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  supplierType: true,
  status: true,
  email: true,
  phone: true,
  website: true,
  taxId: true,
  registrationNumber: true,
  address: true,
  city: true,
  country: true,
  paymentTermsDays: true,
  defaultCurrency: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

/** What a Group list adds: the company each supplier belongs to (Workspace Context §45). */
const GROUP_SUPPLIER_SELECT = {
  ...SUPPLIER_SELECT,
  company: { select: { id: true, name: true } },
} satisfies Prisma.SupplierSelect;

type SupplierRow = Prisma.SupplierGetPayload<{ select: typeof SUPPLIER_SELECT }> & {
  company?: { id: string; name: string };
};

/** Matches the seed's own normaliser, so duplicate detection agrees with it. */
export function normalizeSupplierName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listSuppliers(context: UserContext, query: SupplierListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.view");

  const where = buildListWhere([context], query);

  const [rows, total, openOrders] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: orderFor(query.sort),
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUPPLIER_SELECT,
    }),
    prisma.supplier.count({ where }),
    openOrderCounts([context]),
  ]);

  return {
    data: rows.map((row) => toSummaryDTO(row, openOrders.get(row.id) ?? 0)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/** The directory's `where`, for one company or for every company a Group read spans. */
function buildListWhere(
  contexts: UserContext[],
  query: SupplierListQuery,
): Prisma.SupplierWhereInput {
  const filters: Prisma.SupplierWhereInput[] = [
    unionWhere(contexts, buildSupplierWhere),
    // The archive is a separate view rather than a filter people forget is on.
    query.status?.length ? { status: { in: query.status } } : { status: { not: "ARCHIVED" } },
  ];

  if (query.supplierType?.length) filters.push({ supplierType: { in: query.supplierType } });
  if (query.country) filters.push({ country: query.country });

  const search = searchClause(query.search, [
    "name",
    "legalName",
    "code",
    "taxId",
    "registrationNumber",
    "city",
  ]);
  if (search) filters.push(search);

  return { AND: filters };
}

/**
 * The directory the active workspace shows (Workspace Context §38).
 *
 * A company workspace is `listSuppliers`, untouched. In the Group workspace a
 * supplier is still one company's record: the same legal entity in two
 * companies is two rows, each labelled with its company, and they are never
 * merged (the company owns the relationship, PRD #19 §3).
 */
export async function listSuppliersForWorkspace(session: UserContext, query: SupplierListQuery) {
  if (!inGroupWorkspace(session)) return listSuppliers(session, query);

  const contexts = narrowToCompany(
    await groupProcurementContexts(session, "procurement.supplier.view"),
    query.companyId,
  );
  const where = buildListWhere(contexts, query);

  const [rows, total, openOrders] = await Promise.all([
    prisma.supplier.findMany({
      where,
      // The list's own sort first; the id keeps a page boundary stable when rows tie.
      orderBy: [...orderFor(query.sort), { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: GROUP_SUPPLIER_SELECT,
    }),
    prisma.supplier.count({ where }),
    openOrderCounts(contexts),
  ]);

  return {
    data: rows.map((row) => toSummaryDTO(row, openOrders.get(row.id) ?? 0)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

function orderFor(sort: SupplierListQuery["sort"]): Prisma.SupplierOrderByWithRelationInput[] {
  switch (sort) {
    case "name-desc":
      return [{ name: "desc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }];
    case "created-desc":
      return [{ createdAt: "desc" }];
    case "code-asc":
      return [{ code: "asc" }, { name: "asc" }];
    default:
      return [{ name: "asc" }];
  }
}

/**
 * Open orders per supplier, in one grouped query (PRD #19 §303).
 *
 * A directory of twelve suppliers must not become thirteen queries. A company
 * whose orders the reader may not see contributes no counts, in the Group
 * workspace exactly as in its own.
 */
async function openOrderCounts(contexts: UserContext[]): Promise<Map<string, number>> {
  const viewing = contexts.filter((context) => can(context, "procurement.order.view"));
  if (viewing.length === 0) return new Map();

  const rows = await prisma.purchaseOrder.groupBy({
    by: ["supplierId"],
    where: unionWhere<Prisma.PurchaseOrderWhereInput>(viewing, (context) => ({
      companyId: context.companyId,
      status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] },
    })),
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.supplierId, row._count._all]));
}

export async function getSupplier(
  context: UserContext,
  supplierId: string,
): Promise<SupplierDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.view");

  const row = assertFound(
    await prisma.supplier.findFirst({
      where: { AND: [buildSupplierWhere(context), { id: supplierId }] },
      select: SUPPLIER_SELECT,
    }),
  );

  const [orders, quotes, receipts, open] = await Promise.all([
    prisma.purchaseOrder.count({ where: { supplierId, companyId: context.companyId } }),
    prisma.supplierQuote.count({ where: { supplierId, companyId: context.companyId } }),
    prisma.goodsReceipt.count({ where: { supplierId, companyId: context.companyId } }),
    prisma.purchaseOrder.count({
      where: {
        supplierId,
        companyId: context.companyId,
        status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] },
      },
    }),
  ]);

  return {
    ...toSummaryDTO(row, open),
    website: row.website,
    taxId: row.taxId,
    registrationNumber: row.registrationNumber,
    address: row.address,
    city: row.city,
    notes: row.notes,
    counts: { orders, quotes, receipts },
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: capabilitiesFor(context, row),
  };
}

/** The suppliers a buying document may name: active ones only (PRD #19 §28). */
export async function selectableSuppliers(
  context: UserContext,
): Promise<{ value: string; label: string }[]> {
  if (!can(context, "procurement.supplier.view")) return [];

  const rows = await prisma.supplier.findMany({
    where: { AND: [buildSupplierWhere(context), { status: "ACTIVE" }] },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  return rows.map((row) => ({
    value: row.id,
    label: row.code ? `${row.code} — ${row.name}` : row.name,
  }));
}

export async function supplierFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.view");

  const countries = await prisma.supplier.findMany({
    where: { AND: [buildSupplierWhere(context), { country: { not: null } }] },
    select: { country: true },
    distinct: ["country"],
    orderBy: { country: "asc" },
  });

  return { countries: countries.map((row) => row.country!).filter(Boolean) };
}

export type SupplierFilterOptions = {
  countries: string[];
  /** The Group `company` filter's choices; empty in a company workspace, where the filter is locked (§86). */
  companies: { value: string; label: string }[];
};

/** The directory's filter choices: a company's own, or the union across the Group's companies. */
export async function supplierFilterOptionsForWorkspace(session: UserContext): Promise<SupplierFilterOptions> {
  if (!inGroupWorkspace(session)) {
    return { ...(await supplierFilterOptions(session)), companies: [] };
  }

  const contexts = await groupProcurementContexts(session, "procurement.supplier.view");
  const countries = await prisma.supplier.findMany({
    where: { AND: [unionWhere(contexts, buildSupplierWhere), { country: { not: null } }] },
    select: { country: true },
    distinct: ["country"],
    orderBy: { country: "asc" },
  });

  return {
    countries: countries.map((row) => row.country!).filter(Boolean),
    companies: companyFilterOptions(contexts),
  };
}

/* -------------------------------------------------------------------------- */
/* Duplicate detection (PRD #19 §31)                                           */
/* -------------------------------------------------------------------------- */

export type SupplierDuplicate = { id: string; name: string; reason: "NAME" | "TAX_ID" | "REG_NO" };

/**
 * Soft duplicate detection: a warning, never a block (PRD #19 §31).
 *
 * Two suppliers can legitimately share a trading name, and a company that
 * refuses the second one is a company people work around. A matching tax or
 * registration number is a stronger signal and says so.
 */
export async function findSupplierDuplicates(
  context: UserContext,
  input: { name: string; taxId?: string; registrationNumber?: string; excludeId?: string },
): Promise<SupplierDuplicate[]> {
  if (!can(context, "procurement.supplier.view")) return [];

  const rows = await prisma.supplier.findMany({
    where: {
      companyId: context.companyId,
      archivedAt: null,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      OR: [
        { normalizedName: normalizeSupplierName(input.name) },
        ...(input.taxId ? [{ taxId: input.taxId }] : []),
        ...(input.registrationNumber
          ? [{ registrationNumber: input.registrationNumber }]
          : []),
      ],
    },
    select: { id: true, name: true, taxId: true, registrationNumber: true, normalizedName: true },
    take: 5,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    reason:
      input.taxId && row.taxId === input.taxId
        ? "TAX_ID"
        : input.registrationNumber && row.registrationNumber === input.registrationNumber
          ? "REG_NO"
          : "NAME",
  }));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createSupplier(
  context: UserContext,
  input: SupplierInput,
): Promise<SupplierDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.create");

  const id = await prisma.$transaction(async (tx) => {
    await assertCodeIsFree(tx, context, input.code, null);

    const supplier = await tx.supplier.create({
      data: {
        companyId: context.companyId,
        code: input.code ?? null,
        name: input.name,
        legalName: input.legalName ?? null,
        supplierType: input.supplierType,
        status: input.status,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        taxId: input.taxId ?? null,
        registrationNumber: input.registrationNumber ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        paymentTermsDays: input.paymentTermsDays ?? null,
        defaultCurrency: input.defaultCurrency ?? null,
        notes: input.notes ?? null,
        normalizedName: normalizeSupplierName(input.name),
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: supplier.id,
      action: "PROCUREMENT_SUPPLIER_CREATED",
      message: `added supplier ${input.name}`,
    });

    return supplier.id;
  });

  return getSupplier(context, id);
}

export async function updateSupplier(
  context: UserContext,
  supplierId: string,
  input: SupplierInput,
): Promise<SupplierDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.update");

  const existing = assertFound(
    await prisma.supplier.findFirst({
      where: { AND: [buildSupplierWhere(context), { id: supplierId }] },
      select: { id: true, name: true, status: true, archivedAt: true, updatedAt: true },
    }),
  );

  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this supplier before editing it.", {
      code: "SUPPLIER_ARCHIVED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  await prisma.$transaction(async (tx) => {
    await assertCodeIsFree(tx, context, input.code, supplierId);

    const details = {
      code: input.code ?? null,
      name: input.name,
      legalName: input.legalName ?? null,
      supplierType: input.supplierType,
      email: input.email ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      taxId: input.taxId ?? null,
      registrationNumber: input.registrationNumber ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      defaultCurrency: input.defaultCurrency ?? null,
      notes: input.notes ?? null,
      normalizedName: normalizeSupplierName(input.name),
      updatedByMemberId: context.membershipId,
    };

    // A form saved with a different status activates or deactivates the
    // supplier; one saved with the same status is an edit. Both are bound to
    // the status the form was opened on, so neither lands on a supplier
    // archived meanwhile, nor puts one back to active behind the archive.
    if (input.status !== existing.status) {
      await applyTransition(tx, {
        machine: supplierMachine,
        action: input.status === "ACTIVE" ? "activate" : "deactivate",
        id: supplierId,
        context,
        from: existing.status,
        data: details,
      });
    } else {
      const edited = await tx.supplier.updateMany({
        where: { id: supplierId, companyId: context.companyId, status: existing.status },
        data: details,
      });
      if (edited.count === 0) {
        throw new AccessError("CONFLICT", "This supplier changed since you opened it. Reload to see the latest.", {
          code: "SUPPLIER_STALE",
        });
      }
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: supplierId,
      action: "PROCUREMENT_SUPPLIER_UPDATED",
      message: `updated supplier ${input.name}`,
      metadata:
        existing.status === input.status
          ? undefined
          : changeMetadata({ status: { from: existing.status, to: input.status } }),
    });
  });

  return getSupplier(context, supplierId);
}

export async function archiveSupplier(context: UserContext, supplierId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.archive");

  const existing = assertFound(
    await prisma.supplier.findFirst({
      where: { AND: [buildSupplierWhere(context), { id: supplierId }] },
      select: { id: true, name: true, status: true, archivedAt: true },
    }),
  );

  if (existing.archivedAt) return;

  /*
   * An order still running is work in progress, and archiving the supplier
   * behind it would leave a live commitment pointing at a record nobody can
   * find (PRD #19 §37).
   */
  const open = await prisma.purchaseOrder.count({
    where: {
      supplierId,
      companyId: context.companyId,
      status: { in: ["PENDING_APPROVAL", "APPROVED", "ISSUED", "PARTIALLY_RECEIVED"] },
    },
  });

  if (open > 0) {
    throw new AccessError(
      "CONFLICT",
      `This supplier has ${open} order${open === 1 ? "" : "s"} still running. Close them first.`,
      { code: "SUPPLIER_HAS_OPEN_ORDERS" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: supplierMachine,
      action: "archive",
      id: supplierId,
      context,
      from: existing.status,
      data: {
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: supplierId,
      action: "PROCUREMENT_SUPPLIER_ARCHIVED",
      message: `archived supplier ${existing.name}`,
    });
  });
}

export async function restoreSupplier(context: UserContext, supplierId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.supplier.restore");

  const existing = assertFound(
    await prisma.supplier.findFirst({
      where: { AND: [buildSupplierWhere(context), { id: supplierId }] },
      select: { id: true, name: true, status: true, archivedAt: true },
    }),
  );

  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    // Restores to INACTIVE rather than ACTIVE: coming out of the archive is
    // not the same decision as being ready to buy from again.
    await applyTransition(tx, {
      machine: supplierMachine,
      action: "restore",
      id: supplierId,
      context,
      from: existing.status,
      data: { archivedAt: null, archivedByMemberId: null },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: supplierId,
      action: "PROCUREMENT_SUPPLIER_RESTORED",
      message: `restored supplier ${existing.name}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function assertCodeIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  code: string | undefined,
  excludeId: string | null,
): Promise<void> {
  if (!code) return;

  const clash = await tx.supplier.findFirst({
    where: {
      companyId: context.companyId,
      code,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError("CONFLICT", `Supplier code ${code} is already in use.`, {
      code: "SUPPLIER_CODE_TAKEN",
    });
  }
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this supplier while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: SupplierRow, openOrders: number): SupplierSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalName: row.legalName,
    supplierType: row.supplierType,
    status: row.status,
    country: row.country,
    email: row.email,
    phone: row.phone,
    paymentTermsDays: row.paymentTermsDays,
    defaultCurrency: row.defaultCurrency,
    openOrders,
    updatedAt: row.updatedAt.toISOString(),
    ...(row.company ? { company: row.company } : {}),
  };
}

function capabilitiesFor(context: UserContext, row: SupplierRow) {
  const archived = row.archivedAt !== null;
  return {
    canEdit: !archived && can(context, "procurement.supplier.update"),
    canArchive: !archived && can(context, "procurement.supplier.archive"),
    canRestore: archived && can(context, "procurement.supplier.restore"),
    canViewOrders: can(context, "procurement.order.view"),
    canViewDocuments:
      can(context, "procurement.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "procurement.activity.view"),
  };
}

export { supplierStatusLabels };

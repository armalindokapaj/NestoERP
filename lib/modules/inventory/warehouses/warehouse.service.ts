import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { canSeeStock, loadMemberRef } from "../inventory.dto";
import { ZERO, quantityString } from "../inventory.quantity";
import {
  buildInventoryProjectWhere,
  buildWarehouseScopeWhere,
} from "../inventory.scope";
import type { LocationInput, WarehouseInput, WarehouseListQuery } from "../inventory.schema";
import type {
  LocationDTO,
  WarehouseDetailDTO,
  WarehouseSummaryDTO,
} from "../inventory.types";
import { inventoryLocationMachine } from "./location.machine";
import { warehouseMachine } from "./warehouse.machine";

/**
 * Warehouses and the locations inside them (PRD #20 §49–§66).
 *
 * Stock lives at a location, never merely "in a warehouse", so every warehouse
 * gets a default location the moment it is created. A warehouse with nowhere to
 * put anything is a warehouse nothing can be received into (PRD #20 §64).
 */

const MODULE = "inventory" as const;
const ENTITY = "Warehouse";

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  warehouseType: true,
  status: true,
  address: true,
  city: true,
  country: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdByMemberId: true,
  project: { select: { id: true, code: true, name: true } },
  _count: { select: { locations: true } },
} satisfies Prisma.WarehouseSelect;

type WarehouseRow = Prisma.WarehouseGetPayload<{ select: typeof WAREHOUSE_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listWarehouses(context: UserContext, query: WarehouseListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.warehouse.view");

  const filters: Prisma.WarehouseWhereInput[] = [buildWarehouseScopeWhere(context)];

  filters.push(
    query.status?.length ? { status: { in: query.status } } : { status: { not: "ARCHIVED" } },
  );
  if (query.warehouseType?.length) filters.push({ warehouseType: { in: query.warehouseType } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  const search = searchClause(query.search, ["code", "name", "city"]);
  if (search) filters.push(search);

  const where: Prisma.WarehouseWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.warehouse.findMany({
      where,
      orderBy: orderFor(query.sort),
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: WAREHOUSE_SELECT,
    }),
    prisma.warehouse.count({ where }),
  ]);

  const held = await distinctItemsByWarehouse(context, rows.map((row) => row.id));

  return {
    data: rows.map((row) => toSummaryDTO(row, held.get(row.id) ?? 0)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

function orderFor(sort: WarehouseListQuery["sort"]): Prisma.WarehouseOrderByWithRelationInput[] {
  switch (sort) {
    case "name-asc":
      return [{ name: "asc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }];
    default:
      return [{ code: "asc" }];
  }
}

/** How many distinct items each warehouse holds, in one grouped query (§303). */
async function distinctItemsByWarehouse(
  context: UserContext,
  warehouseIds: string[],
): Promise<Map<string, number>> {
  if (!canSeeStock(context) || warehouseIds.length === 0) return new Map();

  const rows = await prisma.inventoryBalance.groupBy({
    by: ["warehouseId", "inventoryItemId"],
    where: { warehouseId: { in: warehouseIds }, onHandQuantity: { gt: 0 } },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.warehouseId, (counts.get(row.warehouseId) ?? 0) + 1);
  }
  return counts;
}

export async function getWarehouse(
  context: UserContext,
  warehouseId: string,
): Promise<WarehouseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.warehouse.view");

  const row = assertFound(
    await prisma.warehouse.findFirst({
      where: { AND: [buildWarehouseScopeWhere(context), { id: warehouseId }] },
      select: WAREHOUSE_SELECT,
    }),
  );

  const [locations, held, createdBy] = await Promise.all([
    listLocations(context, warehouseId),
    distinctItemsByWarehouse(context, [warehouseId]),
    loadMemberRef(row.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(row, held.get(warehouseId) ?? 0),
    description: row.description,
    address: row.address,
    country: row.country,
    locations,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: capabilitiesFor(context, row),
  };
}

export async function listLocations(
  context: UserContext,
  warehouseId: string,
): Promise<LocationDTO[]> {
  if (!can(context, "inventory.location.view")) return [];

  const rows = await prisma.inventoryLocation.findMany({
    where: { warehouseId, companyId: context.companyId },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      status: true,
      isDefault: true,
      archivedAt: true,
    },
  });

  const held = canSeeStock(context)
    ? await prisma.inventoryBalance.groupBy({
        by: ["locationId"],
        where: { locationId: { in: rows.map((row) => row.id) }, onHandQuantity: { gt: 0 } },
        _count: { _all: true },
      })
    : [];

  const counts = new Map(held.map((row) => [row.locationId, row._count._all]));

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    isDefault: row.isDefault,
    distinctItems: counts.get(row.id) ?? 0,
    capabilities: {
      canEdit: row.archivedAt === null && can(context, "inventory.location.update"),
      canArchive: row.archivedAt === null && can(context, "inventory.location.archive"),
    },
  }));
}

/** Warehouses a stock document may name: active ones only (PRD #20 §55). */
export async function selectableWarehouses(
  context: UserContext,
): Promise<{ value: string; label: string }[]> {
  if (!can(context, "inventory.warehouse.view")) return [];

  const rows = await prisma.warehouse.findMany({
    where: { AND: [buildWarehouseScopeWhere(context), { status: "ACTIVE" }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return rows.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }));
}

/** Locations a stock document may name, grouped by warehouse for the pickers. */
export async function selectableLocations(
  context: UserContext,
  warehouseId?: string,
): Promise<{ value: string; label: string; warehouseId: string }[]> {
  if (!can(context, "inventory.location.view")) return [];

  const rows = await prisma.inventoryLocation.findMany({
    where: {
      AND: [
        { warehouse: { is: buildWarehouseScopeWhere(context) } },
        { status: "ACTIVE", archivedAt: null },
        ...(warehouseId ? [{ warehouseId }] : []),
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      warehouseId: true,
      warehouse: { select: { code: true } },
    },
    orderBy: [{ warehouse: { code: "asc" } }, { code: "asc" }],
  });

  return rows.map((row) => ({
    value: row.id,
    label: `${row.warehouse.code} · ${row.code}${row.name ? ` — ${row.name}` : ""}`,
    warehouseId: row.warehouseId,
  }));
}

export async function warehouseFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const projects = await prisma.project.findMany({
    where: buildInventoryProjectWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createWarehouse(
  context: UserContext,
  input: WarehouseInput,
): Promise<WarehouseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.warehouse.create");

  const projectId = await resolveProject(context, input);

  const id = await prisma.$transaction(async (tx) => {
    await assertCodeIsFree(tx, context, input.code, null);

    const warehouse = await tx.warehouse.create({
      data: {
        companyId: context.companyId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        warehouseType: input.warehouseType,
        projectId,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        status: input.status,
        createdByMemberId: context.membershipId,
        // Every warehouse gets somewhere to put things (PRD #20 §64).
        locations: {
          create: {
            companyId: context.companyId,
            code: "MAIN",
            name: "Main area",
            isDefault: true,
            createdByMemberId: context.membershipId,
          },
        },
      },
      select: { id: true, code: true, name: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: warehouse.id,
      action: "INVENTORY_WAREHOUSE_CREATED",
      message: `added warehouse ${warehouse.code} — ${warehouse.name}`,
    });

    return warehouse.id;
  });

  return getWarehouse(context, id);
}

export async function updateWarehouse(
  context: UserContext,
  warehouseId: string,
  input: WarehouseInput,
): Promise<WarehouseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.warehouse.update");

  const existing = assertFound(
    await prisma.warehouse.findFirst({
      where: { AND: [buildWarehouseScopeWhere(context), { id: warehouseId }] },
      select: { id: true, code: true, status: true, archivedAt: true, updatedAt: true },
    }),
  );

  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this warehouse before editing it.", {
      code: "WAREHOUSE_ARCHIVED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);
  const projectId = await resolveProject(context, input);

  await prisma.$transaction(async (tx) => {
    await assertCodeIsFree(tx, context, input.code, warehouseId);

    const details = {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      warehouseType: input.warehouseType,
      projectId,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      updatedByMemberId: context.membershipId,
    };

    // The form carries the status. Changing it switches the warehouse on or
    // off, which is a transition; leaving it alone is an edit, still
    // conditional on the status the form was opened on, so a warehouse
    // archived meanwhile is not quietly edited back to life.
    if (input.status !== existing.status) {
      await applyTransition(tx, {
        machine: warehouseMachine,
        action: input.status === "ACTIVE" ? "activate" : "deactivate",
        id: warehouseId,
        context,
        from: existing.status,
        data: details,
      });
    } else {
      const saved = await tx.warehouse.updateMany({
        where: { id: warehouseId, companyId: context.companyId, status: existing.status },
        data: details,
      });
      if (saved.count === 0) {
        throw new AccessError("CONFLICT", "This warehouse changed since you opened it. Reload to see the latest.", {
          code: "WAREHOUSE_STALE",
        });
      }
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: warehouseId,
      action: "INVENTORY_WAREHOUSE_UPDATED",
      message: `updated warehouse ${input.code}`,
    });
  });

  return getWarehouse(context, warehouseId);
}

export async function archiveWarehouse(
  context: UserContext,
  warehouseId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.warehouse.archive");

  const existing = assertFound(
    await prisma.warehouse.findFirst({
      where: { AND: [buildWarehouseScopeWhere(context), { id: warehouseId }] },
      select: { id: true, code: true, status: true, archivedAt: true },
    }),
  );

  if (existing.archivedAt) return;

  // Archiving a warehouse that still holds stock would hide material that is
  // physically sitting there (PRD #20 §59).
  const held = await prisma.inventoryBalance.aggregate({
    where: { warehouseId },
    _sum: { onHandQuantity: true },
  });

  if ((held._sum.onHandQuantity ?? ZERO).greaterThan(ZERO)) {
    throw new AccessError(
      "CONFLICT",
      "This warehouse still holds stock. Transfer or issue it out first.",
      { code: "WAREHOUSE_HAS_STOCK" },
    );
  }

  await prisma.$transaction(async (tx) => {
    const outcome = await applyTransition(tx, {
      machine: warehouseMachine,
      action: "archive",
      id: warehouseId,
      context,
      from: existing.status,
      data: { archivedAt: new Date(), archivedByMemberId: context.membershipId },
      idempotent: true,
    });
    // Archived by somebody else a moment earlier: already done, and theirs is
    // the archive the history records.
    if (outcome === "ALREADY_THERE") return;

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: warehouseId,
      action: "INVENTORY_WAREHOUSE_ARCHIVED",
      message: `archived warehouse ${existing.code}`,
    });
  });
}

export async function restoreWarehouse(
  context: UserContext,
  warehouseId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.warehouse.restore");

  const existing = assertFound(
    await prisma.warehouse.findFirst({
      where: { AND: [buildWarehouseScopeWhere(context), { id: warehouseId }] },
      select: { id: true, code: true, status: true, archivedAt: true },
    }),
  );

  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    const outcome = await applyTransition(tx, {
      machine: warehouseMachine,
      action: "restore",
      id: warehouseId,
      context,
      from: existing.status,
      data: { archivedAt: null, archivedByMemberId: null },
      idempotent: true,
    });
    if (outcome === "ALREADY_THERE") return;

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: warehouseId,
      action: "INVENTORY_WAREHOUSE_RESTORED",
      message: `restored warehouse ${existing.code}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Locations                                                                   */
/* -------------------------------------------------------------------------- */

export async function createLocation(
  context: UserContext,
  warehouseId: string,
  input: LocationInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.location.create");

  const warehouse = assertFound(
    await prisma.warehouse.findFirst({
      where: { AND: [buildWarehouseScopeWhere(context), { id: warehouseId }] },
      select: { id: true, code: true },
    }),
  );

  await prisma.$transaction(async (tx) => {
    const clash = await tx.inventoryLocation.findFirst({
      where: { warehouseId, code: input.code },
      select: { id: true },
    });
    if (clash) {
      throw new AccessError(
        "CONFLICT",
        `Location ${input.code} already exists in this warehouse.`,
        { code: "LOCATION_CODE_TAKEN" },
      );
    }

    // Exactly one default per warehouse: two defaults is no default.
    if (input.isDefault) {
      await tx.inventoryLocation.updateMany({ where: { warehouseId }, data: { isDefault: false } });
    }

    await tx.inventoryLocation.create({
      data: {
        companyId: context.companyId,
        warehouseId,
        code: input.code,
        name: input.name ?? null,
        description: input.description ?? null,
        isDefault: input.isDefault,
        createdByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: warehouseId,
      action: "INVENTORY_LOCATION_CREATED",
      message: `added location ${input.code} to warehouse ${warehouse.code}`,
    });
  });
}

export async function archiveLocation(
  context: UserContext,
  locationId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.location.archive");

  const existing = assertFound(
    await prisma.inventoryLocation.findFirst({
      where: {
        AND: [{ warehouse: { is: buildWarehouseScopeWhere(context) } }, { id: locationId }],
      },
      select: { id: true, code: true, status: true, warehouseId: true, isDefault: true, archivedAt: true },
    }),
  );

  if (existing.archivedAt) return;

  if (existing.isDefault) {
    throw new AccessError(
      "CONFLICT",
      "This is the warehouse's default location. Make another one the default first.",
      { code: "LOCATION_IS_DEFAULT" },
    );
  }

  const held = await prisma.inventoryBalance.aggregate({
    where: { locationId },
    _sum: { onHandQuantity: true },
  });

  if ((held._sum.onHandQuantity ?? ZERO).greaterThan(ZERO)) {
    throw new AccessError(
      "CONFLICT",
      "There is still stock in this location. Move it out first.",
      { code: "LOCATION_HAS_STOCK" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: inventoryLocationMachine,
      action: "archive",
      id: locationId,
      context,
      from: existing.status,
      data: { archivedAt: new Date() },
      idempotent: true,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function resolveProject(
  context: UserContext,
  input: WarehouseInput,
): Promise<string | null> {
  if (!input.projectId) return null;

  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: input.projectId, archivedAt: null }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project.id;
}

async function assertCodeIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  code: string,
  excludeId: string | null,
): Promise<void> {
  const clash = await tx.warehouse.findFirst({
    where: {
      companyId: context.companyId,
      code,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError("CONFLICT", `Warehouse code ${code} is already in use.`, {
      code: "WAREHOUSE_CODE_TAKEN",
    });
  }
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this warehouse while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: WarehouseRow, distinctItems: number): WarehouseSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    warehouseType: row.warehouseType,
    status: row.status,
    project: row.project,
    city: row.city,
    locationCount: row._count.locations,
    distinctItems,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: WarehouseRow) {
  const archived = row.archivedAt !== null;
  return {
    canEdit: !archived && can(context, "inventory.warehouse.update"),
    canArchive: !archived && can(context, "inventory.warehouse.archive"),
    canRestore: archived && can(context, "inventory.warehouse.restore"),
    canManageLocations: !archived && can(context, "inventory.location.create"),
    canViewStock: canSeeStock(context),
    canViewMovements: can(context, "inventory.movement.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}

export { quantityString };

import { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { unitLabel } from "@/lib/modules/project-structure/structure.rules";
import { MAX_BULK_UNITS } from "@/lib/modules/project-structure/structure.types";
import { containsPattern, loadStructureProject, PRICE_PER_SQM_SQL, SALE_AREA_SQL, SELECTION_COLUMNS, toSelection, unitCodeMatch, unitListOrder, type SelectionRow } from "@/lib/modules/project-structure/structure.service";
import type { UnitSelectionDTO } from "@/lib/modules/project-structure/unit-bulk.rules";
import { saleArea, saleRate } from "./unit-pricing.rules";
import { salesCapabilities } from "./unit-sales.core";
import { moneyText, saleStatusOf } from "./unit-sales.rules";
import type { InventoryQuery } from "./unit-sales.schema";
import { UNIT_SALE_STATUSES, type InventoryDTO, type InventoryRowDTO, type UnitSaleStatus } from "./unit-sales.types";

/**
 * The Sales inventory of a project (E-05E §13, §14, §45, §56).
 *
 * The canonical units, filtered, searched and sorted in the database — price per
 * square metre included, which is derived and never stored, so it is computed in
 * the query. A page of ids comes from one SQL statement; the rows are then read in
 * one query with their commercial profile and active reservation, so a page costs
 * the same at 50 units as at 10,000 (§56). Client and deal names are searched and
 * shown only for readers who may open clients and deals (§14, §32).
 *
 * The area is the sale area — the saleable area when typed, else the gross
 * (2026-11-09) — and the price per m² is the asking price over it, whatever
 * basis the price was saved on. A unit with no price that is not for sale reads
 * Not Priced, with a quick filter of its own.
 */

const STATUS = Prisma.sql`COALESCE(p."status", 'NOT_FOR_SALE'::"UnitCommercialStatus")`;
/** The status as shown: Not Priced for a unit with no asking price that is not for sale (`saleStatusOf`). */
const SALE_STATUS = Prisma.sql`(CASE WHEN ${STATUS} = 'NOT_FOR_SALE' AND p."askingPrice" IS NULL THEN 'NOT_PRICED' ELSE ${STATUS}::text END)`;

/** The Units list's order (2026-11-09: one sort list on both tabs), and the reservation expiry, soonest first. */
function orderBy(sort: InventoryQuery["sort"]): Prisma.Sql {
  if (sort === "expiry") return Prisma.sql`r."expiresAt" ASC NULLS LAST, ${unitListOrder("structure")}`;
  return unitListOrder(sort);
}

const FROM = Prisma.sql`FROM "project_units" u
    JOIN "project_floors" f ON f."id" = u."floorId"
    JOIN "project_buildings" b ON b."id" = f."buildingId"
    JOIN "project_unit_types" t ON t."id" = u."unitTypeId"
    LEFT JOIN "unit_commercial_profiles" p ON p."unitId" = u."id"
    LEFT JOIN "unit_reservations" r ON r."unitId" = u."id" AND r."status" = 'ACTIVE'
    LEFT JOIN "clients" c ON c."id" = r."clientId"
    LEFT JOIN "opportunities" o ON o."id" = r."opportunityId"`;

/**
 * The inventory's conditions, without the status chip: the project, the
 * filters and the search — the unit's code or type, and the client's or the
 * deal's name for a reader who may see them (§14, §32).
 */
function inventoryConditions(context: UserContext, projectId: string, query: InventoryQuery, caps: { canSeeClients: boolean; canSeeDeals: boolean }): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [Prisma.sql`u."companyId" = ${context.companyId}`, Prisma.sql`u."projectId" = ${projectId}`];
  if (query.buildingId) filters.push(Prisma.sql`f."buildingId" = ${query.buildingId}`);
  if (query.floorId) filters.push(Prisma.sql`u."floorId" = ${query.floorId}`);
  if (query.unitTypeId) filters.push(Prisma.sql`u."unitTypeId" = ${query.unitTypeId}`);
  if (query.orientation) filters.push(Prisma.sql`u."orientation" = ${query.orientation}::"UnitOrientation"`);
  if (query.bedrooms !== undefined) filters.push(Prisma.sql`u."bedrooms" = ${query.bedrooms}`);
  if (query.bathrooms !== undefined) filters.push(Prisma.sql`u."bathrooms" = ${query.bathrooms}`);
  if (query.areaMin) filters.push(Prisma.sql`${SALE_AREA_SQL} >= ${new Prisma.Decimal(query.areaMin)}`);
  if (query.areaMax) filters.push(Prisma.sql`${SALE_AREA_SQL} <= ${new Prisma.Decimal(query.areaMax)}`);
  if (query.priceMin) filters.push(Prisma.sql`p."askingPrice" >= ${new Prisma.Decimal(query.priceMin)}`);
  if (query.priceMax) filters.push(Prisma.sql`p."askingPrice" <= ${new Prisma.Decimal(query.priceMax)}`);
  if (query.pricePerSqmMin) filters.push(Prisma.sql`${PRICE_PER_SQM_SQL} >= ${new Prisma.Decimal(query.pricePerSqmMin)}`);
  if (query.pricePerSqmMax) filters.push(Prisma.sql`${PRICE_PER_SQM_SQL} <= ${new Prisma.Decimal(query.pricePerSqmMax)}`);
  const q = query.q?.trim();
  if (q) {
    // The unit by its code as the lists show it — "T-501", "T501" or "501" — or its type, as on Units (2026-11-09).
    const like = containsPattern(q);
    const matches = [unitCodeMatch(q), Prisma.sql`t."name" ILIKE ${like}`];
    if (caps.canSeeClients) matches.push(Prisma.sql`c."name" ILIKE ${like}`);
    if (caps.canSeeDeals) matches.push(Prisma.sql`o."name" ILIKE ${like}`);
    filters.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
  }
  return filters;
}

export async function listSalesInventory(context: UserContext, projectId: string, query: InventoryQuery): Promise<InventoryDTO> {
  const project = await loadStructureProject(context, projectId);
  const caps = salesCapabilities(context);
  if (!caps.canView) throw new AccessError("FORBIDDEN", "You cannot see this project's sales.");

  const filters = inventoryConditions(context, project.id, query, caps);
  const where = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
  const statusFilter = query.commercialStatus ? Prisma.sql`AND ${SALE_STATUS} = ${query.commercialStatus}` : Prisma.empty;

  const [page, counts] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`SELECT u."id" ${FROM} ${where} ${statusFilter} ORDER BY ${orderBy(query.sort)} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    // The quick filters' counts ignore the status filter itself, so every chip says what it would show (§14).
    prisma.$queryRaw<Array<{ status: UnitSaleStatus; count: bigint }>>`SELECT ${SALE_STATUS} AS status, COUNT(*) AS count ${FROM} ${where} GROUP BY 1`,
  ]);

  const ids = page.map((row) => row.id);
  const rows = ids.length
    ? await prisma.projectUnit.findMany({
        where: { companyId: context.companyId, projectId: project.id, id: { in: ids } },
        select: {
          id: true,
          version: true,
          floorId: true,
          isActive: true,
          unitCode: true,
          saleableArea: true,
          grossArea: true,
          bedrooms: true,
          bathrooms: true,
          orientation: true,
          publicationStatus: true,
          unitType: { select: { name: true, category: true } },
          floor: { select: { name: true, building: { select: { name: true, code: true } } } },
          commercialProfile: { select: { status: true, askingPrice: true, currency: true, version: true } },
          reservations: { where: { status: "ACTIVE" }, take: 1, select: { expiresAt: true, clientId: true, opportunityId: true, client: { select: { name: true } }, opportunity: { select: { name: true } } } },
        },
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const items = ids.map((id): InventoryRowDTO => {
    const row = byId.get(id)!;
    const profile = row.commercialProfile;
    const reservation = row.reservations[0] ?? null;
    const asking = moneyText(profile?.askingPrice);
    const areas = { saleableArea: moneyText(row.saleableArea), grossArea: moneyText(row.grossArea) };
    const sale = saleArea(areas);
    return {
      id: row.id,
      version: row.version,
      salesVersion: profile?.version ?? 0,
      floorId: row.floorId,
      isActive: row.isActive,
      grossArea: areas.grossArea,
      unitCode: row.unitCode,
      label: unitLabel(row.floor.building.code, row.unitCode),
      unitType: row.unitType.name,
      unitTypeCategory: row.unitType.category,
      building: row.floor.building.name,
      floor: row.floor.name,
      saleArea: sale.area,
      saleAreaBasis: sale.basis,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      orientation: row.orientation,
      status: profile?.status ?? "NOT_FOR_SALE",
      saleStatus: saleStatusOf(profile?.status, asking),
      publicationStatus: row.publicationStatus,
      askingPrice: asking,
      currency: profile?.currency ?? null,
      pricePerSqm: saleRate(areas, asking),
      client: reservation && caps.canSeeClients ? { id: reservation.clientId, name: reservation.client.name } : null,
      deal: reservation && caps.canSeeDeals ? { id: reservation.opportunityId, name: reservation.opportunity.name } : null,
      reservationExpiresAt: reservation?.expiresAt.toISOString() ?? null,
    };
  });

  const tally = Object.fromEntries(UNIT_SALE_STATUSES.map((status) => [status, 0])) as Record<UnitSaleStatus, number>;
  for (const row of counts) if (row.status in tally) tally[row.status] = Number(row.count);
  const all = Object.values(tally).reduce((sum, value) => sum + value, 0);
  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total: query.commercialStatus ? tally[query.commercialStatus] : all,
    counts: { ...tally, ALL: all },
    canSeeClients: caps.canSeeClients,
    canSeeDeals: caps.canSeeDeals,
  };
}

/**
 * Every unit the inventory's filters and status chip match, not one page, for
 * "Select all N matching" (2026-11-09). At most `MAX_BULK_UNITS`; `total` says
 * how many matched.
 */
export async function listSalesSelection(context: UserContext, projectId: string, query: InventoryQuery): Promise<UnitSelectionDTO> {
  const project = await loadStructureProject(context, projectId);
  const caps = salesCapabilities(context);
  if (!caps.canView) throw new AccessError("FORBIDDEN", "You cannot see this project's sales.");
  const filters = inventoryConditions(context, project.id, query, caps);
  if (query.commercialStatus) filters.push(Prisma.sql`${SALE_STATUS} = ${query.commercialStatus}`);
  const where = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
  const [counted, rows] = await prisma.$transaction(
    [
      prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count ${FROM} ${where}`,
      prisma.$queryRaw<SelectionRow[]>`SELECT ${SELECTION_COLUMNS} ${FROM} ${where} ORDER BY ${orderBy(query.sort)} LIMIT ${MAX_BULK_UNITS}`,
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return toSelection(rows, Number(counted[0]?.count ?? 0));
}

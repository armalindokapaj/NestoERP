import { Prisma, type UnitCommercialStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { loadStructureProject } from "@/lib/modules/project-structure/structure.service";
import { salesCapabilities } from "./unit-sales.core";
import { moneyText, pricePerSqm } from "./unit-sales.rules";
import type { InventoryQuery } from "./unit-sales.schema";
import { UNIT_COMMERCIAL_STATUSES, type InventoryDTO, type InventoryRowDTO } from "./unit-sales.types";

/**
 * The Sales inventory of a project (E-05E §13, §14, §45, §56).
 *
 * The canonical units, filtered, searched and sorted in the database — price per
 * square metre included, which is derived and never stored, so it is computed in
 * the query. A page of ids comes from one SQL statement; the rows are then read in
 * one query with their commercial profile and active reservation, so a page costs
 * the same at 50 units as at 10,000 (§56). Client and deal names are searched and
 * shown only for readers who may open clients and deals (§14, §32).
 */

const STATUS = Prisma.sql`COALESCE(p."status", 'NOT_FOR_SALE'::"UnitCommercialStatus")`;
const PRICE_PER_SQM = Prisma.sql`(CASE p."priceBasis"
  WHEN 'SALEABLE_AREA' THEN p."askingPrice" / NULLIF(u."saleableArea", 0)
  WHEN 'INTERNAL_AREA' THEN p."askingPrice" / NULLIF(u."internalArea", 0)
  WHEN 'GROSS_AREA' THEN p."askingPrice" / NULLIF(u."grossArea", 0)
  ELSE NULL END)`;

function orderBy(sort: InventoryQuery["sort"]): Prisma.Sql {
  const structure = Prisma.sql`b."sortOrder" ASC, f."sortOrder" ASC, u."sortOrder" ASC, u."unitCodeKey" ASC, u."id" ASC`;
  switch (sort) {
    case "code":
      return Prisma.sql`u."unitCodeKey" ASC, u."id" ASC`;
    case "price":
      return Prisma.sql`p."askingPrice" ASC NULLS LAST, ${structure}`;
    case "-price":
      return Prisma.sql`p."askingPrice" DESC NULLS LAST, ${structure}`;
    case "pricePerSqm":
      return Prisma.sql`${PRICE_PER_SQM} ASC NULLS LAST, ${structure}`;
    case "-pricePerSqm":
      return Prisma.sql`${PRICE_PER_SQM} DESC NULLS LAST, ${structure}`;
    case "area":
      return Prisma.sql`u."saleableArea" ASC NULLS LAST, ${structure}`;
    case "-area":
      return Prisma.sql`u."saleableArea" DESC NULLS LAST, ${structure}`;
    case "expiry":
      return Prisma.sql`r."expiresAt" ASC NULLS LAST, ${structure}`;
    default:
      return structure;
  }
}

export async function listSalesInventory(context: UserContext, projectId: string, query: InventoryQuery): Promise<InventoryDTO> {
  const project = await loadStructureProject(context, projectId);
  const caps = salesCapabilities(context);
  if (!caps.canView) throw new AccessError("FORBIDDEN", "You cannot see this project's sales.");

  const filters: Prisma.Sql[] = [Prisma.sql`u."companyId" = ${context.companyId}`, Prisma.sql`u."projectId" = ${project.id}`];
  if (query.buildingId) filters.push(Prisma.sql`f."buildingId" = ${query.buildingId}`);
  if (query.floorId) filters.push(Prisma.sql`u."floorId" = ${query.floorId}`);
  if (query.unitTypeId) filters.push(Prisma.sql`u."unitTypeId" = ${query.unitTypeId}`);
  if (query.orientation) filters.push(Prisma.sql`u."orientation" = ${query.orientation}::"UnitOrientation"`);
  if (query.position) filters.push(Prisma.sql`u."position" = ${query.position}::"UnitPosition"`);
  if (query.bedrooms !== undefined) filters.push(Prisma.sql`u."bedrooms" = ${query.bedrooms}`);
  if (query.bathrooms !== undefined) filters.push(Prisma.sql`u."bathrooms" = ${query.bathrooms}`);
  if (query.areaMin) filters.push(Prisma.sql`u."saleableArea" >= ${new Prisma.Decimal(query.areaMin)}`);
  if (query.areaMax) filters.push(Prisma.sql`u."saleableArea" <= ${new Prisma.Decimal(query.areaMax)}`);
  if (query.priceMin) filters.push(Prisma.sql`p."askingPrice" >= ${new Prisma.Decimal(query.priceMin)}`);
  if (query.priceMax) filters.push(Prisma.sql`p."askingPrice" <= ${new Prisma.Decimal(query.priceMax)}`);
  if (query.pricePerSqmMin) filters.push(Prisma.sql`${PRICE_PER_SQM} >= ${new Prisma.Decimal(query.pricePerSqmMin)}`);
  if (query.pricePerSqmMax) filters.push(Prisma.sql`${PRICE_PER_SQM} <= ${new Prisma.Decimal(query.pricePerSqmMax)}`);
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const matches = [Prisma.sql`u."unitCode" ILIKE ${like}`, Prisma.sql`u."name" ILIKE ${like}`];
    if (caps.canSeeClients) matches.push(Prisma.sql`c."name" ILIKE ${like}`);
    if (caps.canSeeDeals) matches.push(Prisma.sql`o."name" ILIKE ${like}`);
    filters.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
  }

  const from = Prisma.sql`FROM "project_units" u
    JOIN "project_floors" f ON f."id" = u."floorId"
    JOIN "project_buildings" b ON b."id" = f."buildingId"
    LEFT JOIN "unit_commercial_profiles" p ON p."unitId" = u."id"
    LEFT JOIN "unit_reservations" r ON r."unitId" = u."id" AND r."status" = 'ACTIVE'
    LEFT JOIN "clients" c ON c."id" = r."clientId"
    LEFT JOIN "opportunities" o ON o."id" = r."opportunityId"`;
  const where = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
  const statusFilter = query.commercialStatus ? Prisma.sql`AND ${STATUS} = ${query.commercialStatus}::"UnitCommercialStatus"` : Prisma.empty;

  const [page, counts] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`SELECT u."id" ${from} ${where} ${statusFilter} ORDER BY ${orderBy(query.sort)} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    // The quick filters' counts ignore the status filter itself, so every chip says what it would show (§14).
    prisma.$queryRaw<Array<{ status: UnitCommercialStatus; count: bigint }>>`SELECT ${STATUS} AS status, COUNT(*) AS count ${from} ${where} GROUP BY 1`,
  ]);

  const ids = page.map((row) => row.id);
  const rows = ids.length
    ? await prisma.projectUnit.findMany({
        where: { companyId: context.companyId, projectId: project.id, id: { in: ids } },
        select: {
          id: true,
          unitCode: true,
          name: true,
          saleableArea: true,
          internalArea: true,
          grossArea: true,
          bedrooms: true,
          bathrooms: true,
          orientation: true,
          publicationStatus: true,
          unitType: { select: { name: true } },
          floor: { select: { name: true, building: { select: { name: true } } } },
          commercialProfile: { select: { status: true, askingPrice: true, currency: true, priceBasis: true } },
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
    return {
      id: row.id,
      unitCode: row.unitCode,
      name: row.name,
      unitType: row.unitType.name,
      building: row.floor.building.name,
      floor: row.floor.name,
      saleableArea: moneyText(row.saleableArea),
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      orientation: row.orientation,
      status: profile?.status ?? "NOT_FOR_SALE",
      publicationStatus: row.publicationStatus,
      askingPrice: asking,
      currency: profile?.currency ?? null,
      pricePerSqm: pricePerSqm(asking, profile?.priceBasis ?? "SALEABLE_AREA", { saleableArea: moneyText(row.saleableArea), internalArea: moneyText(row.internalArea), grossArea: moneyText(row.grossArea) }),
      client: reservation && caps.canSeeClients ? { id: reservation.clientId, name: reservation.client.name } : null,
      deal: reservation && caps.canSeeDeals ? { id: reservation.opportunityId, name: reservation.opportunity.name } : null,
      reservationExpiresAt: reservation?.expiresAt.toISOString() ?? null,
    };
  });

  const tally = Object.fromEntries(UNIT_COMMERCIAL_STATUSES.map((status) => [status, 0])) as Record<UnitCommercialStatus, number>;
  for (const row of counts) tally[row.status] = Number(row.count);
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

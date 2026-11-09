import { Prisma } from "@prisma/client";

import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { SOURCE_LOCALE } from "@/lib/i18n/config";
import { numberText } from "@/lib/i18n/format";
import { readableUnitWhere } from "@/lib/modules/project-structure/structure.permissions";
import { unitLabel } from "@/lib/modules/project-structure/structure.rules";
import { fail, loadStructureProject } from "@/lib/modules/project-structure/structure.service";
import { resolveUnitSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { PROFILE_SELECT, SALES_ACTIVITY_MODULE, salesCapabilities, UNIT_ENTITY } from "./unit-sales.core";
import { moneyText } from "./unit-sales.rules";
import type { PriceListSaveInput } from "./unit-pricing.schema";
import type { PriceListDTO, PriceListSaveResult, UnitTypeCategoryKey } from "./unit-pricing.types";

/**
 * A project's price list (2026-11): read every active unit's asking price floor
 * by floor, and save many of them at once — a floor priced at a rate per m², all
 * parking at one price, any unit changed by hand.
 *
 * A save is the one-unit price change (`updateCommercialDetails`) done for many
 * units in one transaction: each unit's profile is created Not For Sale if it
 * has none, locked, checked against the version the reader saw, and refused
 * whole if one is sold or stale. Every changed price keeps its history, an
 * activity line on the unit and an audit event, exactly as a single change
 * does (E-05E §10-§12). Commercial status never moves here.
 */

const SAVE_TIMEOUT_MS = 30_000;

function shown(price: string | null, currency: string | null): string {
  return price === null ? "no price" : `${currency ?? ""} ${numberText(Number(price), { minimumFractionDigits: 2 }, SOURCE_LOCALE, "en")}`.trim();
}

export async function getPriceList(context: UserContext, projectId: string): Promise<PriceListDTO> {
  const project = await loadStructureProject(context, projectId);
  const caps = salesCapabilities(context);
  if (!caps.canView) throw new AccessError("FORBIDDEN", "You cannot see this project's sales.");

  const [settings, buildings] = await Promise.all([
    resolveUnitSalesSettings(context.companyId),
    prisma.projectBuilding.findMany({
      where: { companyId: context.companyId, projectId: project.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        floors: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            units: {
              where: { AND: [readableUnitWhere(context), { isActive: true }] },
              orderBy: [{ sortOrder: "asc" }, { unitCodeKey: "asc" }],
              select: {
                id: true,
                unitCode: true,
                saleableArea: true,
                internalArea: true,
                grossArea: true,
                unitType: { select: { name: true, category: true } },
                commercialProfile: { select: { status: true, askingPrice: true, currency: true, priceBasis: true, version: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    projectId: project.id,
    baseCurrency: settings.baseCurrency,
    canManagePrice: caps.canManagePrice,
    buildings: buildings.map((building) => ({
      id: building.id,
      name: building.name,
      floors: building.floors.map((floor) => ({
        id: floor.id,
        name: floor.name,
        units: floor.units.map((unit) => ({
          id: unit.id,
          unitCode: unit.unitCode,
          label: unitLabel(building.code, unit.unitCode),
          unitType: unit.unitType.name,
          category: unit.unitType.category as UnitTypeCategoryKey,
          saleableArea: moneyText(unit.saleableArea),
          internalArea: moneyText(unit.internalArea),
          grossArea: moneyText(unit.grossArea),
          status: unit.commercialProfile?.status ?? "NOT_FOR_SALE",
          askingPrice: moneyText(unit.commercialProfile?.askingPrice),
          currency: unit.commercialProfile?.currency ?? null,
          priceBasis: unit.commercialProfile?.priceBasis ?? "SALEABLE_AREA",
          version: unit.commercialProfile?.version ?? 0,
        })),
      })),
    })),
  };
}

const STALE = "Some of these prices were changed by someone else. Reload the price list before saving.";

export async function savePriceList(context: UserContext, projectId: string, input: PriceListSaveInput): Promise<PriceListSaveResult> {
  const project = await loadStructureProject(context, projectId);
  if (!salesCapabilities(context).canView) throw new AccessError("FORBIDDEN", "You cannot see this project's sales.");
  assertPermission(context, "project.unit.price.manage");

  const ids = input.prices.map((price) => price.unitId);
  const units = await prisma.projectUnit.findMany({
    where: { AND: [readableUnitWhere(context), { projectId: project.id, id: { in: ids }, isActive: true, floor: { isActive: true, building: { isActive: true } } }] },
    select: { id: true, unitCode: true, projectId: true, companyId: true, floor: { select: { building: { select: { code: true } } } } },
  });
  if (units.length !== ids.length) throw fail("PRICE_LIST_UNIT_NOT_FOUND", "One of these units is no longer in this project's price list. Reload it before saving.", "NOT_FOUND");
  const unitById = new Map(units.map((unit) => [unit.id, unit]));

  const saved = await runInTransaction(
    "sales.unit.price_list",
    async (tx) => {
      // Every unit gets its profile (Not For Sale) the first time Sales prices it (§58).
      await tx.unitCommercialProfile.createMany({
        data: units.map((unit) => ({ companyId: unit.companyId, projectId: unit.projectId, unitId: unit.id })),
        skipDuplicates: true,
      });
      // One lock, in a fixed order, over every profile this save touches: a
      // reservation or a one-unit price change on any of them waits for it.
      await tx.$queryRaw`SELECT "id" FROM "unit_commercial_profiles" WHERE "companyId" = ${context.companyId} AND "unitId" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
      const profiles = await tx.unitCommercialProfile.findMany({ where: { companyId: context.companyId, unitId: { in: ids } }, select: PROFILE_SELECT });
      const profileByUnit = new Map(profiles.map((profile) => [profile.unitId, profile]));

      let count = 0;
      for (const change of input.prices) {
        const unit = unitById.get(change.unitId)!;
        const profile = profileByUnit.get(change.unitId)!;
        // A profile no one has changed yet is version 1, the same as having none (version 0).
        const label = unitLabel(unit.floor.building.code, unit.unitCode);
        if (profile.version !== Math.max(change.expectedVersion, 1)) throw fail("UNIT_SALES_STALE", STALE, "CONFLICT", { unitCode: unit.unitCode, unitLabel: label });
        const oldPrice = moneyText(profile.askingPrice);
        const currency = change.askingPrice === null ? profile.currency : input.currency;
        const changed = oldPrice !== change.askingPrice || (change.askingPrice !== null && profile.currency !== currency) || profile.priceBasis !== change.priceBasis;
        if (!changed) continue;
        if (profile.status === "SOLD") throw fail("UNIT_SOLD", `${label} is sold, so its asking price does not change. Reopen the sale first.`, "CONFLICT", { unitCode: unit.unitCode, unitLabel: label });

        const newPrice = change.askingPrice === null ? null : new Prisma.Decimal(change.askingPrice);
        const updated = await tx.unitCommercialProfile.updateMany({
          where: { id: profile.id, companyId: context.companyId, version: profile.version },
          data: { askingPrice: newPrice, currency, priceBasis: change.priceBasis, updatedByMemberId: context.membershipId, version: { increment: 1 } },
        });
        if (!updated.count) throw fail("UNIT_SALES_STALE", STALE, "CONFLICT", { unitCode: unit.unitCode, unitLabel: label });

        // The asking price keeps its history; an agreed price never overwrites it (§12, §30).
        await tx.unitPriceHistory.create({
          data: {
            companyId: context.companyId,
            projectId: unit.projectId,
            unitId: unit.id,
            oldPrice: profile.askingPrice,
            newPrice,
            oldCurrency: profile.currency,
            currency,
            oldPriceBasis: profile.priceBasis,
            priceBasis: change.priceBasis,
            reason: input.reason,
            changedByMemberId: context.membershipId,
          },
        });
        await recordActivity(tx, context, {
          module: SALES_ACTIVITY_MODULE,
          entityType: UNIT_ENTITY,
          entityId: unit.id,
          action: "UNIT_PRICE_CHANGED",
          message: `changed the asking price of ${unit.unitCode} from ${shown(oldPrice, profile.currency)} to ${shown(change.askingPrice, currency)}`,
          metadata: { projectId: unit.projectId },
        });
        await recordUserAction(
          context,
          {
            actionKey: AuditAction.UNIT_PRICE_CHANGED,
            entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode },
            projectId: unit.projectId,
            before: { askingPrice: oldPrice, currency: profile.currency, priceBasis: profile.priceBasis },
            after: { askingPrice: change.askingPrice, currency, priceBasis: change.priceBasis, reason: input.reason },
            metadata: { source: "price_list" },
          },
          { tx },
        );
        count += 1;
      }
      return count;
    },
    { timeout: SAVE_TIMEOUT_MS },
  );

  return { saved, list: await getPriceList(context, project.id) };
}

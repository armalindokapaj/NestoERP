import type { Prisma } from "@prisma/client";

import { AccessError, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere } from "./structure.permissions";
import { unitLabel } from "./structure.rules";
import { loadStructureProject } from "./structure.service";
import type { UnitCommercialStatusKey, UnitPublicationStatusKey } from "./structure.types";
import { moveUnit, updateUnit } from "./structure.units";
import type { BulkOutcome, BulkSkip, BulkSkipReason, BulkUpdated } from "./unit-bulk.rules";
import type { UnitBulkInput, UnitBulkRef } from "./unit-bulk.schema";
import { archiveUnit } from "./unit-publishing.service";

/**
 * Changing ticked units together (2026-11-09, "Tick and edit").
 *
 * Every unit is changed by the service its own page uses — `updateUnit`,
 * `moveUnit`, `archiveUnit`, and Sales' price and status services — so each
 * is checked as it would be alone: its project's door, its company, the
 * permission, the version the person saw. Each runs in its own transaction
 * and publishes the unit's next version as it always does; one unit that
 * cannot take the change is skipped with the reason and the rest go ahead,
 * rather than one stale unit undoing a hundred good ones.
 *
 * The units must belong to the project the request names: a unit of another
 * project or another company is "not found", and nothing about it is said.
 */

/** What a change to many units knows of each unit before it starts. */
export type BulkTarget = {
  id: string;
  label: string;
  unitCode: string;
  unitTypeId: string;
  floorId: string;
  version: number;
  salesVersion: number;
  status: UnitCommercialStatusKey;
  askingPrice: string | null;
  saleableArea: string | null;
  grossArea: string | null;
  isActive: boolean;
  publicationStatus: UnitPublicationStatusKey;
};

const TARGET_SELECT = {
  id: true,
  unitCode: true,
  unitTypeId: true,
  floorId: true,
  version: true,
  isActive: true,
  publicationStatus: true,
  saleableArea: true,
  grossArea: true,
  floor: { select: { building: { select: { code: true } } } },
  commercialProfile: { select: { status: true, version: true, askingPrice: true } },
} satisfies Prisma.ProjectUnitSelect;

/**
 * The project, through its door, and the ticked units that are its own and the
 * reader's company's. A unit that is not comes back missing, and is skipped as
 * not found.
 */
export async function loadBulkTargets(context: UserContext, projectId: string, refs: UnitBulkRef[]): Promise<{ projectId: string; targets: Map<string, BulkTarget> }> {
  const project = await loadStructureProject(context, projectId);
  const rows = await prisma.projectUnit.findMany({
    where: { AND: [readableUnitWhere(context), { projectId: project.id, id: { in: refs.map((ref) => ref.id) } }] },
    select: TARGET_SELECT,
  });
  const targets = new Map(
    rows.map((row): [string, BulkTarget] => [
      row.id,
      {
        id: row.id,
        label: unitLabel(row.floor.building.code, row.unitCode),
        unitCode: row.unitCode,
        unitTypeId: row.unitTypeId,
        floorId: row.floorId,
        version: row.version,
        salesVersion: row.commercialProfile?.version ?? 0,
        status: row.commercialProfile?.status ?? "NOT_FOR_SALE",
        askingPrice: row.commercialProfile?.askingPrice?.toFixed(2) ?? null,
        saleableArea: row.saleableArea?.toFixed(2) ?? null,
        grossArea: row.grossArea?.toFixed(2) ?? null,
        isActive: row.isActive,
        publicationStatus: row.publicationStatus,
      },
    ]),
  );
  return { projectId: project.id, targets };
}

/** A unit left as it was, and why. */
export class BulkSkipError extends Error {
  constructor(
    readonly reason: BulkSkipReason,
    message: string,
  ) {
    super(message);
  }
}

const SKIP_MESSAGES: Record<BulkSkipReason, string> = {
  not_found: "That unit could not be found in this project.",
  not_allowed: "You cannot change this unit.",
  changed: "Someone else changed this unit since it was ticked. Refresh and try again.",
  sold: "This unit is sold.",
  reserved: "This unit is reserved.",
  on_hold: "This unit is on hold.",
  no_area: "This unit has no saleable or gross area to price per m².",
  not_sellable: "This unit is archived or inactive, so it cannot be offered.",
  on_sale: "Sales still offers, holds, has reserved or has sold this unit.",
  already: "This unit is already that way.",
  wrong_status: "This unit's sale status does not allow this change.",
  invalid: "This change does not fit this unit.",
  failed: "This unit could not be changed. Try again.",
};

export function skipFor(target: { id: string; label: string | null }, reason: BulkSkipReason, message?: string): BulkSkip {
  return { id: target.id, label: target.label, reason, message: message ?? SKIP_MESSAGES[reason] };
}

/**
 * Why a unit's own service refused it, in the words of a skipped unit. The
 * service's message is kept: it says the specific thing ("This Unit is not
 * published for Sales use.").
 */
export function skipReasonOf(error: unknown): { reason: BulkSkipReason; message: string } {
  if (error instanceof BulkSkipError) return { reason: error.reason, message: error.message };
  if (error instanceof AccessError) {
    const code = (error.details as { code?: unknown } | undefined)?.code;
    const detail = typeof code === "string" ? code : "";
    if (error.code === "FORBIDDEN" || error.code === "MODULE_UNAVAILABLE") return { reason: "not_allowed", message: SKIP_MESSAGES.not_allowed };
    if (error.code === "NOT_FOUND") return { reason: "not_found", message: SKIP_MESSAGES.not_found };
    if (detail.endsWith("_STALE")) return { reason: "changed", message: SKIP_MESSAGES.changed };
    if (detail === "UNIT_SOLD") return { reason: "sold", message: error.message };
    if (detail === "UNIT_NOT_SELLABLE") return { reason: "not_sellable", message: error.message };
    if (detail === "UNIT_ON_SALE") return { reason: "on_sale", message: error.message };
    if (detail.endsWith("_ILLEGAL_TRANSITION")) return { reason: "wrong_status", message: error.message };
    if (error.code === "CONFLICT") return { reason: "changed", message: error.message };
    return { reason: "invalid", message: error.message };
  }
  return { reason: "failed", message: SKIP_MESSAGES.failed };
}

/**
 * Runs `change` for every ticked unit, a few at a time, and reports each as
 * changed or skipped, in the order they were sent. A unit missing from
 * `targets` is skipped as not found without being touched; anything a unit's
 * service throws skips that unit only. `concurrency` 1 keeps the order of the
 * writes too — a move appends each unit to its new floor in the order ticked.
 */
export async function runForEachUnit(
  refs: UnitBulkRef[],
  targets: Map<string, BulkTarget>,
  change: (target: BulkTarget, ref: UnitBulkRef) => Promise<Omit<BulkUpdated, "id" | "label">>,
  options: { concurrency: number; operation: string },
): Promise<BulkOutcome> {
  const results: Array<{ updated: BulkUpdated } | { skipped: BulkSkip }> = new Array(refs.length);
  let next = 0;
  async function worker() {
    while (next < refs.length) {
      const index = next++;
      const ref = refs[index]!;
      const target = targets.get(ref.id);
      if (!target) {
        results[index] = { skipped: skipFor({ id: ref.id, label: null }, "not_found") };
        continue;
      }
      try {
        results[index] = { updated: { id: target.id, label: target.label, ...(await change(target, ref)) } };
      } catch (error) {
        const { reason, message } = skipReasonOf(error);
        if (reason === "failed") logger.error(`${options.operation}.unit_failed`, { unitId: target.id, ...serialiseError(error) });
        results[index] = { skipped: skipFor(target, reason, message) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, refs.length)) }, () => worker()));
  return {
    updated: results.flatMap((result) => ("updated" in result ? [result.updated] : [])),
    skipped: results.flatMap((result) => ("skipped" in result ? [result.skipped] : [])),
  };
}

/** Units changed side by side: enough to finish 500 units well inside a request, few enough for the connection pool. */
export const BULK_CONCURRENCY = 4;

type StructureBulkInput = Extract<UnitBulkInput, { action: "details" | "move" | "archive" }>;

/**
 * Edit details, move to a floor, or archive (2026-11-09). The permission is
 * asked once up front, so a person without it is refused outright, and again
 * by each unit's own service.
 */
export async function runStructureBulk(context: UserContext, projectId: string, input: StructureBulkInput): Promise<BulkOutcome> {
  const permission = { details: "project.unit.update", move: "project.unit.move", archive: "project.unit.archive" } as const;
  const { projectId: id, targets } = await loadBulkTargets(context, projectId, input.units);
  assertPermission(context, permission[input.action]);
  const kept = (target: BulkTarget) => ({ salesVersion: target.salesVersion, status: target.status, priced: target.askingPrice !== null });

  if (input.action === "details") {
    const { change } = input;
    return runForEachUnit(
      input.units,
      targets,
      async (target, ref) => {
        // The unit's own code and type unless the change names one; every field left out keeps the unit's value.
        const saved = await updateUnit(context, target.id, { ...change, unitCode: target.unitCode, unitTypeId: change.unitTypeId ?? target.unitTypeId, expectedVersion: ref.version });
        return { version: saved.version, ...kept(target) };
      },
      { concurrency: BULK_CONCURRENCY, operation: "structure.units.bulk_details" },
    );
  }

  if (input.action === "move") {
    const floor = await prisma.projectFloor.findFirst({ where: { companyId: context.companyId, projectId: id, id: input.floorId }, select: { id: true } });
    if (!floor) throw invalidRecordLink("floorId", "CROSS_PROJECT_REFERENCE", "Choose a floor of this project.");
    return runForEachUnit(
      input.units,
      targets,
      async (target, ref) => {
        if (target.floorId === floor.id) throw new BulkSkipError("already", "This unit is already on that floor.");
        const moved = await moveUnit(context, target.id, { floorId: floor.id, expectedVersion: ref.version });
        return { version: moved.version, ...kept(target) };
      },
      // One at a time: each unit joins the end of its new floor in the order it was ticked.
      { concurrency: 1, operation: "structure.units.bulk_move" },
    );
  }

  return runForEachUnit(
    input.units,
    targets,
    async (target, ref) => {
      if (target.publicationStatus === "ARCHIVED") throw new BulkSkipError("already", "This unit is already archived.");
      const archived = await archiveUnit(context, target.id, { expectedVersion: ref.version });
      return { version: archived.version, ...kept(target) };
    },
    { concurrency: BULK_CONCURRENCY, operation: "structure.units.bulk_archive" },
  );
}

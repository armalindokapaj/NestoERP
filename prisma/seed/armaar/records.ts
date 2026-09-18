/**
 * Stable keys and provenance for the ARMAAR demo (D-01 §3, §73, §107).
 *
 * Every record the seed makes has a deterministic id, so a rerun updates it in
 * place. The records a presenter talks about — the group, its companies, their
 * departments, its people and its projects — also get a `demo_records` row
 * under a readable key (`ARMAAR:PROJECT:TIRANA_LAKE`) saying where their facts
 * come from: PUBLIC with its source, SYNTHETIC, or INFERRED, field by field
 * where a record mixes them. Anything else in the group is synthetic demo data,
 * which the group's own record says.
 */
import { Prisma, type DemoSourceType, type PrismaClient } from "@prisma/client";

import { D01_SOURCE } from "./public-facts";

export const ARMAAR_GROUP_ID = "armaar_group";

/** `ARMAAR:COMPANY:ARLIS_NDERTIM`. */
export const demoKey = (...parts: string[]) => ["ARMAAR", ...parts].join(":");

/** A readable id fragment from a code: `ARLIS_NDERTIM` → `arlis_ndertim`. */
export const slugOf = (code: string) => code.toLowerCase();

export type Provenance = {
  source: DemoSourceType;
  /** Per field, where the record mixes public and synthetic values. */
  fields?: Record<string, DemoSourceType>;
  note?: string;
};

export async function recordDemo(prisma: PrismaClient, input: { key: string; entityType: string; entityId: string } & Provenance) {
  const cites = input.source === "PUBLIC" || Object.values(input.fields ?? {}).includes("PUBLIC");
  const data = {
    parentGroupId: ARMAAR_GROUP_ID,
    entityType: input.entityType,
    entityId: input.entityId,
    sourceType: input.source,
    fieldSources: input.fields ?? Prisma.JsonNull,
    sourceLabel: cites ? D01_SOURCE.label : null,
    sourceUrl: cites ? D01_SOURCE.url : null,
    sourceVerifiedAt: cites ? new Date(`${D01_SOURCE.verifiedAt}T00:00:00.000Z`) : null,
    note: input.note ?? null,
  };
  await prisma.demoRecord.upsert({ where: { key: input.key }, update: data, create: { key: input.key, ...data } });
}

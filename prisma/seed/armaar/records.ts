/**
 * Stable keys and provenance for the ARMAAR demo (D-01 §3, §73, §107).
 *
 * Every record the seed makes has a deterministic id, so a rerun updates it in
 * place. The records a presenter talks about — the group, its companies, their
 * departments, its people and its projects — also get a `demo_records` row
 * under a readable key (`ARMAAR:PROJECT:TIRANA_LAKE`) saying where their facts
 * come from: PUBLIC with its source, SYNTHETIC, INFERRED, or USER_PROVIDED by
 * NESTO's owner (D-03 §3), field by field where a record mixes them. Anything
 * else in the group is synthetic demo data, which the group's own record says.
 */
import { Prisma, type DemoSourceType, type PrismaClient } from "@prisma/client";

import { PROVIDED_SOURCE } from "./provided-facts";
import { D01_SOURCE, type PublicSource } from "./public-facts";

export const ARMAAR_GROUP_ID = "armaar_group";

/** `ARMAAR:COMPANY:ARLIS_NDERTIM`. */
export const demoKey = (...parts: string[]) => ["ARMAAR", ...parts].join(":");

/** A person's seed key from their name (D-03 §21): `Klaisi Çela` → `KLAISI_CELA`. */
export const nameKey = (firstName: string, lastName: string) =>
  normalName(firstName, lastName).toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** A full name as D-03 §23 compares them: exact, but not by case, spacing or accents. */
export const normalName = (firstName: string, lastName: string) =>
  `${firstName} ${lastName}`.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();

/** A readable id fragment from a code: `ARLIS_NDERTIM` → `arlis_ndertim`. */
export const slugOf = (code: string) => code.toLowerCase();

export type Provenance = {
  source: DemoSourceType;
  /** Per field, where the record mixes public and synthetic values. */
  fields?: Record<string, DemoSourceType>;
  /** The public sources a PUBLIC value comes from; D-01's unless said. */
  cites?: PublicSource[];
  note?: string;
};

export async function recordDemo(prisma: PrismaClient, input: { key: string; entityType: string; entityId: string } & Provenance) {
  const sources = [input.source, ...Object.values(input.fields ?? {})];
  const cites = sources.includes("PUBLIC") ? (input.cites ?? [D01_SOURCE]) : [];
  const labels = [...cites.map((source) => source.label), ...(sources.includes("USER_PROVIDED") ? [PROVIDED_SOURCE.label] : [])];
  // Verified is the public sources' date: what NESTO's owner supplied is not verified (D-03 §3).
  const verified = cites.map((source) => source.verifiedAt).sort().at(-1);
  const data = {
    parentGroupId: ARMAAR_GROUP_ID,
    entityType: input.entityType,
    entityId: input.entityId,
    sourceType: input.source,
    fieldSources: input.fields ?? Prisma.JsonNull,
    sourceLabel: labels.length ? labels.join("; ") : null,
    sourceUrl: cites.find((source) => source.url)?.url ?? null,
    sourceVerifiedAt: verified ? new Date(`${verified}T00:00:00.000Z`) : null,
    note: input.note ?? null,
  };
  // One record per entity: one kept under an earlier key (a person since named) gives way to this one.
  await prisma.demoRecord.deleteMany({ where: { entityType: input.entityType, entityId: input.entityId, key: { not: input.key } } });
  await prisma.demoRecord.upsert({ where: { key: input.key }, update: data, create: { key: input.key, ...data } });
}

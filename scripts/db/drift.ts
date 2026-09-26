/**
 * Migration drift check against a disposable shadow database (AUD-12 §5).
 *
 *   SHADOW_DATABASE_URL=postgresql://…/nesto_shadow NESTO_DISPOSABLE_DATABASES=nesto_shadow pnpm db:drift
 *
 * Prisma replays every migration into its shadow database, dropping whatever
 * is there first. This used to be handed `DATABASE_URL` — the application's
 * own database. Now:
 *
 * 1. `SHADOW_DATABASE_URL` is required, local, marked disposable, and not any
 *    URL the application uses (by host/port/database/schema, and by asking
 *    each server which database it is — aliases reach the same answer).
 * 2. Every refusal happens before Prisma starts.
 * 3. Prisma never receives that database either: a new, uniquely named
 *    database is created beside it for this run and dropped afterwards. Only
 *    that database is written to.
 *
 * Exit codes: 0 no drift, 2 drift, 1 refused or failed.
 */
import { spawnSync } from "node:child_process";

import {
  applicationTargets,
  checkShadowTarget,
  parseTarget,
  postgresProbe,
  probeDistinct,
  withDatabase,
} from "../../lib/core/database/target";

function refuse(reason: string): never {
  console.error(`db:drift refused: ${reason}`);
  process.exit(1);
}

async function main() {
  const shadowUrl = process.env.SHADOW_DATABASE_URL;
  if (!shadowUrl) {
    refuse("SHADOW_DATABASE_URL is not set. Point it at a local database kept for this purpose, never at DATABASE_URL.");
  }
  let shadow;
  try {
    shadow = parseTarget(shadowUrl);
  } catch (error) {
    refuse(`SHADOW_DATABASE_URL: ${(error as Error).message}`);
  }
  const verdict = checkShadowTarget(shadow, applicationTargets(process.env), process.env);
  if (!verdict.ok) refuse(verdict.reason);

  const applicationUrls = [process.env.DATABASE_URL, process.env.DIRECT_URL, process.env.POSTGRES_URL_NON_POOLING].filter((url): url is string => Boolean(url));
  const distinct = await probeDistinct(shadowUrl, applicationUrls).catch((error: Error) => ({ ok: false as const, reason: `the shadow server could not be reached (${error.message.split("\n")[0]}).` }));
  if (!distinct.ok) refuse(distinct.reason);

  // A database of our own for this run: nothing that existed before is touched.
  const runDatabase = `${shadow.database}_run_${process.pid}_${Date.now().toString(36)}`;
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasources: { db: { url: shadowUrl } }, log: [] });
  try {
    await admin.$executeRawUnsafe(`create database "${runDatabase}"`);
  } catch (error) {
    await admin.$disconnect();
    refuse(`could not create a run database beside ${shadow.label}: ${(error as Error).message.split("\n")[0]}. The shadow role needs CREATEDB.`);
  }

  const runUrl = withDatabase(shadowUrl, runDatabase);
  let status = 1;
  try {
    if ((await postgresProbe.tableCount(runUrl)) !== 0) throw new Error("the run database was not empty");
    const result = spawnSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--shadow-database-url",
        runUrl,
        "--exit-code",
      ],
      { stdio: "inherit", env: process.env },
    );
    status = result.status ?? 1;
    if (status === 0) console.log("no drift");
  } finally {
    await admin.$executeRawUnsafe(`drop database if exists "${runDatabase}" with (force)`).catch(() => {
      console.error(`db:drift: the run database "${runDatabase}" could not be dropped; remove it by hand.`);
      status = status === 0 ? 1 : status;
    });
    await admin.$disconnect();
  }
  process.exit(status);
}

void main();

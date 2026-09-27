import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { checkDestructiveTarget, checkSeedTarget, parseTarget } from "../../lib/core/database/target";
import { buildOperationalFixture, removeOperationalFixture, type FixtureCounts, type FixtureSummary } from "../../tests/api/perf/aud07-fixture";

/**
 * The D10 cohort (AUD-07 §3, PS-01): deterministic tenfold operational records.
 *
 * For every company, each measured family — projects, clients, tasks, invoices,
 * expenses, pending finance approvals, documents, daily logs and units — gets
 * (factor − 1) × its D1 row count added, so the company holds `factor` times
 * the demo seed with the same company, the same people and the same spread of
 * statuses. A family the company does not use stays empty: D10 grows what is
 * there, it does not invent a business. Identities are never copied; every new
 * id and business number carries the prefix and is unique.
 *
 * It writes only to a disposable database: on this machine, named in
 * NESTO_DISPOSABLE_DATABASES, never production or staging (the same verdict as
 * `db:reset`, lib/core/database/target.ts), and never `nesto_erp` by name,
 * whatever the list says.
 *
 *   NESTO_DISPOSABLE_DATABASES=nesto_perf_d10 \
 *   DATABASE_URL="postgresql://mnrv@localhost:5432/nesto_perf_d10?schema=public" \
 *   npx tsx scripts/perf/d10-generate.ts [--factor=10] [--prefix=d10] [--out=test-results/aud07/d10-fixture.json] [--remove]
 *
 * The output records the D1 counts, the rows added per company and family, a
 * checksum per family and for the whole fixture (identical on every run with
 * the same seed and arguments), the expected invoice and expense totals per
 * currency, and document metadata bytes (kept apart from record counts, §3).
 * `--remove` deletes the fixture with the same prefix and nothing else.
 */

const NEVER = new Set(["nesto_erp"]);

function argument(name: string): string | undefined {
  const match = process.argv.slice(2).find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (!match) return undefined;
  return match.includes("=") ? match.slice(match.indexOf("=") + 1) : "true";
}

function refuseUnlessDisposable(url: string | undefined): void {
  if (!url) throw new Error("Refusing to generate D10: DATABASE_URL is not set.");
  const target = parseTarget(url);
  if (NEVER.has(target.database)) throw new Error(`Refusing to generate D10: ${target.label} is the shared development database.`);
  const destructive = checkDestructiveTarget(target, process.env);
  if (!destructive.ok) throw new Error(`Refusing to generate D10: ${destructive.reason}`);
  const seed = checkSeedTarget(target, process.env);
  if (!seed.ok) throw new Error(`Refusing to generate D10: ${seed.reason}`);
}

async function d1Counts(db: PrismaClient, companyId: string): Promise<FixtureCounts> {
  const where = { companyId };
  const [projects, clients, tasks, invoices, expenses, approvals, documents, dailyLogs, units] = await Promise.all([
    db.project.count({ where }),
    db.client.count({ where }),
    db.task.count({ where }),
    db.invoice.count({ where }),
    db.expense.count({ where }),
    db.financeApproval.count({ where: { companyId, status: "PENDING" } }),
    db.document.count({ where }),
    db.dailyLog.count({ where }),
    db.projectUnit.count({ where }),
  ]);
  return { projects, clients, tasks, invoices, expenses, approvals, documents, dailyLogs, units };
}

async function main() {
  refuseUnlessDisposable(process.env.DATABASE_URL);
  const factor = Number(argument("factor") ?? 10);
  if (!Number.isInteger(factor) || factor < 2 || factor > 100) throw new Error("--factor must be a whole number from 2 to 100.");
  const prefix = (argument("prefix") ?? "d10").toLowerCase();
  if (!/^[a-z][a-z0-9]{1,11}$/.test(prefix)) throw new Error("--prefix must be 2-12 lower-case letters and digits, starting with a letter.");
  const out = resolve(argument("out") ?? "test-results/aud07/d10-fixture.json");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: ["error"] });

  try {
    const companies = await db.company.findMany({ orderBy: { id: "asc" }, select: { id: true } });
    const prefixes = companies.map((_, index) => `${prefix}c${index}`);
    for (const companyPrefix of prefixes) await removeOperationalFixture(db, companyPrefix);
    if (argument("remove")) {
      console.log(`[d10] removed the "${prefix}" fixture from ${companies.length} companies`);
      return;
    }

    const perCompany: Array<{ companyId: string; d1: FixtureCounts; added: FixtureCounts; summary: FixtureSummary | null; skipped?: string }> = [];
    for (const [index, company] of companies.entries()) {
      const d1 = await d1Counts(db, company.id);
      const members = await db.companyMember.findMany({ where: { companyId: company.id, status: "ACTIVE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 2, select: { id: true, userId: true } });
      const added = Object.fromEntries(Object.entries(d1).map(([family, count]) => [family, count * (factor - 1)])) as FixtureCounts;
      if (members.length === 0 || Object.values(d1).every((count) => count === 0)) {
        const none = Object.fromEntries(Object.keys(added).map((family) => [family, 0])) as FixtureCounts;
        perCompany.push({ companyId: company.id, d1, added: none, summary: null, skipped: members.length === 0 ? "no active member" : "no operational records" });
        continue;
      }
      // Separation of duties: approvals need a submitter who is not the creator.
      if (members.length < 2) added.approvals = 0;
      // Every added approval sits on an added expense.
      added.expenses = Math.max(added.expenses, added.approvals);
      const summary = await buildOperationalFixture(db, {
        prefix: prefixes[index]!,
        companyId: company.id,
        createdByUserId: members[0]!.userId,
        creatorMemberId: members[0]!.id,
        submitterMemberId: (members[1] ?? members[0])!.id,
        counts: added,
      });
      // What was written, not what was asked: a company with tasks but no project gets one project to hold them.
      const written = Object.fromEntries(Object.entries(summary.families).map(([family, { rows }]) => [family, rows])) as FixtureCounts;
      perCompany.push({ companyId: company.id, d1, added: written, summary });
      console.log(`[d10] ${company.id}: ${Object.entries(summary.families).map(([family, { rows }]) => `${family} +${rows}`).join(", ")}`);
    }

    const families = Object.keys(perCompany[0]?.d1 ?? {}) as (keyof FixtureCounts)[];
    const sum = (pick: (row: (typeof perCompany)[number]) => FixtureCounts) => Object.fromEntries(families.map((family) => [family, perCompany.reduce((total, row) => total + pick(row)[family], 0)]));
    const checksum = createHash("sha256")
      .update(JSON.stringify(perCompany.map((row) => [row.companyId, row.summary?.checksum ?? null])))
      .digest("hex")
      .slice(0, 16);
    const report = {
      cohort: `D${factor}`,
      factor,
      prefix,
      target: parseTarget(process.env.DATABASE_URL!).label,
      seedRevision: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
      d1Totals: sum((row) => row.d1),
      addedTotals: sum((row) => row.added),
      checksum,
      companies: perCompany,
      generatedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`[d10] checksum ${checksum}; D1 ${JSON.stringify(report.d1Totals)}; added ${JSON.stringify(report.addedTotals)}; written ${out}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

import { readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { findCrossCompanyReferences } from "@/lib/core/security/company-integrity";
import { cleanupSessions, loginAsEmail, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { COMPANY_A, COMPANY_TENANT } from "./harness/companies";
import { idsByFieldName, paramVariants } from "./harness/params";
import { callRoute, candidateValues, discoverApiRoutes, fillPattern, loadRouteModule, NON_SESSION_ROUTES, type HttpMethod, type RouteModule } from "./harness/routes";
import { idFieldsParsedIn } from "./harness/schemas";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * Links that cross a company (PRD #47 §20, §21, §62, §132, §155, §223).
 *
 * DESTRUCTIVE: every write endpoint really writes. It runs only against a
 * throwaway database (`pnpm test:security:links` clones one) and refuses to
 * start against the development database.
 *
 * For each write route, Company A's Owner first builds a request that succeeds
 * using only Company A's own ids. Then, one link field at a time — every
 * id-shaped field in the route's schema, required or optional — the same
 * request is sent with that one field naming a fixture tenant record. The server
 * must never take one up: not in the record it answers with, and — the check
 * that does not depend on what an endpoint chooses to echo — not anywhere in
 * the database afterwards, which the company-integrity scan reads table by
 * table, child rows included.
 */

const databaseName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
const destructive = process.env.SECURITY_DESTRUCTIVE === "1" && databaseName !== "nesto_erp" && databaseName !== "";

type Finding = { endpoint: string; field: string; status: number; detail: string };

let ownerA: UserContext;
const report: Record<string, unknown> = {};

beforeAll(async () => {
  if (!destructive) return;
  ownerA = await loginAsEmail("owner@nesto.test");
}, 60_000);

afterAll(async () => {
  actAs(null);
  if (process.env.SECURITY_REPORT) writeFileSync(process.env.SECURITY_REPORT, JSON.stringify(report, null, 2));
  await cleanupSessions();
  await prisma.$disconnect();
});

async function validBody(handler: NonNullable<RouteModule[HttpMethod]>, method: HttpMethod, path: string, params: Record<string, string>, idFields: string[], ownId: (field: string) => string | undefined) {
  const body: Record<string, unknown> = {};
  for (const field of idFields) {
    const id = ownId(field.replace(/Ids$/, "Id"));
    if (id) body[field] = field.endsWith("Ids") ? [id] : id;
  }
  const tried = new Map<string, number>();
  let outcome = await callRoute(handler, method, path, params, body);
  for (let round = 0; outcome.status === 422 && round < 8; round += 1) {
    const details = (outcome.body as { error?: { details?: Record<string, string[]> } })?.error?.details;
    if (!details || typeof details !== "object") break;
    let progressed = false;
    for (const [field, messages] of Object.entries(details)) {
      const attempt = tried.get(field) ?? 0;
      const candidates = candidateValues(field, Array.isArray(messages) ? messages : [], ownId);
      if (attempt >= candidates.length) continue;
      body[field] = candidates[attempt];
      tried.set(field, attempt + 1);
      progressed = true;
    }
    if (!progressed) break;
    outcome = await callRoute(handler, method, path, params, body);
  }
  return { body, outcome };
}

describe.skipIf(!destructive)("no write accepts another company's record as a link (PRD #47 §21)", () => {
  it("refuses a fixture tenant id in every link field of every write route", async () => {
    const ownId = await idsByFieldName(COMPANY_A);
    const foreignId = await idsByFieldName(COMPANY_TENANT);
    const anyForeignId = foreignId("projectId") ?? foreignId("clientId") ?? COMPANY_TENANT;
    const findings: Finding[] = [];
    /** Accepted, but the field was never read on the path that ran: reported, not failed. */
    const ignored: Finding[] = [];
    const exercised: string[] = [];
    let attempts = 0;
    actAs(ownerA);

    for (const route of discoverApiRoutes()) {
      if (NON_SESSION_ROUTES.has(route.pattern) || route.pattern.startsWith("/api/me")) continue;
      const handlers = await loadRouteModule(route);
      const variants = await paramVariants(route.pattern, route.params, { companyId: COMPANY_A, approvals: [], sessionId: null });
      const params = variants[0]?.params ?? {};
      if (route.params.length > 0 && !variants[0]) continue;

      for (const method of ["POST", "PUT", "PATCH"] as const) {
        const handler = handlers[method];
        if (!handler) continue;
        const text = readFileSync(route.file, "utf8");
        const idFields = await idFieldsParsedIn(route.file, text);
        const path = fillPattern(route.pattern, params);
        const baseline = await validBody(handler, method, path, params, idFields, ownId);
        if (baseline.outcome.status >= 300) continue;
        exercised.push(`${method} ${route.pattern}`);

        const fields = new Set([...idFields, ...Object.keys(baseline.body).filter((field) => /Ids?$/.test(field))]);
        for (const field of fields) {
          // The tenant is a smaller company, so it has no record of its own for
          // many of these fields. Any id of the tenant's still makes the point:
          // the server looks the id up inside the caller's company, where it
          // does not exist, whatever kind of record it names (PRD #47 §17, §20).
          const foreign = foreignId(field.replace(/Ids$/, "Id")) ?? anyForeignId;
          if (!foreign) continue;
          attempts += 1;
          const poisoned = { ...baseline.body, [field]: field.endsWith("Ids") ? [foreign] : foreign };
          const outcome = await callRoute(handler, method, path, params, poisoned);
          if (outcome.status >= 300) continue;

          // A 2xx alone is not the offence. A route parses several schemas —
          // this contract PATCH edits terms or only metadata depending on the
          // body — so a link field the branch that ran never reads is neither
          // refused nor used, and failing on that reports the harness rather
          // than the server. What condemns a write is the id being taken up:
          // echoed back as the record's own link here, or found in the data by
          // the integrity scan below, which reads every table including the
          // child rows that carry no companyId of their own.
          const taken = JSON.stringify(outcome.body ?? "").includes(foreign);
          const entry = { endpoint: `${method} ${route.pattern}`, field, status: outcome.status, detail: JSON.stringify(outcome.body).slice(0, 160) };
          if (taken) findings.push(entry);
          else ignored.push(entry);
        }
      }
    }

    const integrity = await findCrossCompanyReferences(prisma);
    report.routes = { exercised: exercised.length, attempts, findings, ignored, integrity };
    expect(exercised.length).toBeGreaterThan(50);
    expect(findings).toEqual([]);
    expect(integrity).toEqual([]);
  }, 1_800_000);
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { navigationItems } from "@/config/navigation";
import type { UserContext } from "@/lib/context/types";
import { listReadableAttention } from "@/lib/core/notifications/attention.service";
import { globalSearch } from "@/lib/core/search/search.service";
import { getApprovalCounts } from "@/lib/modules/approvals/approvals.service";
import { resolveDashboard } from "@/lib/modules/dashboard/dashboard.service";
import { cleanupSessions, loginAsEmail, prisma } from "../helpers";
import { actAs } from "./harness/actor";
import { discoverServerActions, modelForArgument } from "./harness/actions";
import { COMPANY_B } from "./harness/companies";
import { ownedRows } from "./harness/company-data";
import { paramVariants } from "./harness/params";
import { callRouteWithValidBody, callRoute, discoverApiRoutes, fillPattern, HTTP_METHODS, loadRouteModule } from "./harness/routes";
import { idsByFieldName } from "./harness/params";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

/**
 * A module switched off is gone, not hidden (PRD #47 §24-§26, §211, §266).
 *
 * Company B runs with Finance, Sales, Contracts, Procurement, Inventory, QA/QC
 * and HSE switched off (PRD #9 §13) — and still has rows in several of them.
 * Its Owner holds every permission a role can, so the only thing between them
 * and those rows is the module switch. Every door into a disabled module is
 * tried: its API routes, its server actions, and every cross-module surface
 * that aggregates modules — navigation, search, calendar, approvals,
 * dashboard and attention.
 */

const DISABLED = ["finance", "sales", "contracts", "procurement", "inventory", "qaqc", "hse"] as const;
const DISABLED_SET = new Set<string>(DISABLED);
/** Approval provider and calendar provider keys that belong to those modules. */
const DISABLED_PROVIDERS = new Set(["finance", "sales", "legal", "procurement", "qaqc", "hse", "contracts", "inventory"]);
const ROUTE_PREFIX = /^\/api\/(finance|sales|contracts|procurement|inventory|qaqc|hse)(\/|$)|^\/api\/projects\/\[projectId\]\/finance$/;
const ACTION_FILE = /lib\/actions\/(finance|sales|contracts|procurement|inventory|qaqc|hse)\.ts$/;

let ownerB: UserContext;

beforeAll(async () => {
  const enabled = await prisma.companyModule.findMany({ where: { companyId: COMPANY_B, enabled: true, module: { key: { in: [...DISABLED] } } }, select: { module: { select: { key: true } } } });
  if (enabled.length > 0) throw new Error(`Company B must run with ${DISABLED.join(", ")} switched off; found enabled: ${enabled.map((row) => row.module.key).join(", ")}`);
  ownerB = await loginAsEmail("owner-b@nesto.test");
}, 60_000);

afterAll(async () => {
  actAs(null);
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("a disabled module's own doors (PRD #47 §25, §211)", () => {
  it("holds no permission of a disabled module", () => {
    for (const moduleKey of DISABLED) {
      expect(ownerB.moduleAccess[moduleKey].enabled).toBe(false);
      expect(ownerB.moduleAccess[moduleKey].permissions).toEqual([]);
    }
    expect(ownerB.permissions.filter((permission) => DISABLED_SET.has(permission.split(".")[0]) || /^(legal|procurement|inventory|qaqc|hse|sales|finance)\./.test(permission))).toEqual([]);
  });

  it("answers every API route of a disabled module without data", async () => {
    actAs(ownerB);
    const idFor = await idsByFieldName(COMPANY_B);
    const answered: string[] = [];
    let calls = 0;
    for (const route of discoverApiRoutes().filter((candidate) => ROUTE_PREFIX.test(candidate.pattern))) {
      const handlers = await loadRouteModule(route);
      const variants = await paramVariants(route.pattern, route.params, { companyId: COMPANY_B, approvals: [], sessionId: null });
      const params = variants[0]?.params ?? Object.fromEntries(route.params.map((param) => [param, "missing_record"]));
      for (const method of HTTP_METHODS) {
        const handler = handlers[method];
        if (!handler) continue;
        const path = fillPattern(route.pattern, params);
        const outcome = method === "GET" ? await callRoute(handler, method, path, params) : await callRouteWithValidBody(handler, method, path, params, idFor);
        calls += 1;
        if (outcome.thrown || outcome.status < 300 || outcome.status >= 500) answered.push(`${method} ${route.pattern} → ${outcome.status} ${outcome.thrown ?? JSON.stringify(outcome.body).slice(0, 120)}`);
      }
    }
    expect(calls).toBeGreaterThan(150);
    expect(answered).toEqual([]);
  }, 300_000);

  it("refuses every server action of a disabled module", async () => {
    actAs(ownerB);
    const accepted: string[] = [];
    for (const action of discoverServerActions().filter((candidate) => ACTION_FILE.test(candidate.file))) {
      const args: unknown[] = [];
      for (const parameter of action.parameters) {
        if (/Id$/.test(parameter.name)) {
          const model = modelForArgument(action.file, parameter.name);
          args.push(model ? String((await ownedRows(model, COMPANY_B))[0]?.id ?? "missing_record") : "missing_record");
        } else if (parameter.type === "FormData") args.push(new FormData());
        else if (parameter.literals.length > 0) args.push(parameter.literals[0]);
        else if (parameter.type === "string") args.push("Security sweep");
        else args.push(parameter.optional ? undefined : {});
      }
      const actions = (await import(/* @vite-ignore */ `@/${action.file}`)) as Record<string, (...input: unknown[]) => Promise<unknown>>;
      try {
        const result = (await actions[action.name](...args)) as { ok?: boolean } | undefined;
        if (result && typeof result === "object" && result.ok === true) accepted.push(`${action.file}#${action.name}`);
      } catch (error) {
        const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : "";
        if (digest.startsWith("NEXT_REDIRECT")) accepted.push(`${action.file}#${action.name} (redirected)`);
      }
    }
    expect(accepted).toEqual([]);
  }, 300_000);
});

describe("a disabled module in every cross-module surface (PRD #47 §26)", () => {
  it("is absent from navigation", () => {
    const modules = navigationItems({ permissions: ownerB.permissions, enabledModules: ownerB.enabledModules }).map((item) => item.module);
    expect(modules.filter((moduleKey) => DISABLED_SET.has(moduleKey))).toEqual([]);
  });

  it("is absent from search", async () => {
    const response = await globalSearch(ownerB, "a", { limitPerProvider: 20, totalLimit: 50 });
    expect(response.results.filter((result) => DISABLED_SET.has(result.moduleKey))).toEqual([]);
    const targeted = await globalSearch(ownerB, "a", { moduleKeys: [...DISABLED], limitPerProvider: 20, totalLimit: 50 });
    expect(targeted.results).toEqual([]);
  });

  it("is absent from the calendar", async () => {
    actAs(ownerB);
    const route = discoverApiRoutes().find((candidate) => candidate.pattern === "/api/calendar/events")!;
    const handlers = await loadRouteModule(route);
    const outcome = await callRoute(handlers.GET!, "GET", "/api/calendar/events?from=2026-08-01T00:00:00.000Z&to=2026-10-15T00:00:00.000Z", {});
    expect(outcome.status).toBe(200);
    const events = ((outcome.body as { data?: { events?: unknown[] }; events?: unknown[] }).data?.events ?? (outcome.body as { events?: unknown[] }).events ?? []) as { providerKey?: string; metadata?: { moduleKey?: string } }[];
    expect(events.filter((event) => DISABLED_PROVIDERS.has(event.providerKey ?? "") || DISABLED_SET.has(event.metadata?.moduleKey ?? ""))).toEqual([]);
  });

  it("is absent from the approvals center", async () => {
    const counts = await getApprovalCounts(ownerB);
    const providers = JSON.stringify(counts);
    for (const key of ["finance", "sales", "legal", "procurement", "qaqc", "hse"]) {
      expect(providers).not.toMatch(new RegExp(`"(key|providerKey)":"${key}"`));
    }
  });

  it("is absent from the dashboard", async () => {
    const dashboard = await resolveDashboard(ownerB);
    expect(dashboard.widgets.filter((widget) => DISABLED_SET.has(widget.definition.module))).toEqual([]);
    expect(dashboard.kpis.filter((kpi) => DISABLED_SET.has((kpi.definition as { module?: string }).module ?? ""))).toEqual([]);
  });

  it("is absent from attention", async () => {
    const items = await listReadableAttention(ownerB, 100);
    expect(items.filter((item) => DISABLED_SET.has((item as { moduleKey?: string }).moduleKey ?? ""))).toEqual([]);
  });
});

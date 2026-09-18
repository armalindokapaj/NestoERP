import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { actAs } from "./actor";
import { discoverServerActions, modelForArgument, type ServerAction } from "./actions";
import { foreignIdentifiersIn, ownedRows } from "./company-data";
import { idsByFieldName, paramVariants, type ParamContext } from "./params";
import { callRoute, callRouteWithValidBody, candidateValues, discoverApiRoutes, fillPattern, HTTP_METHODS, loadRouteModule, NON_SESSION_ROUTES, isPlatformRoute } from "./routes";

/**
 * The attack loops behind the isolation suites (PRD #47 §131-§139, §155, §209, §210).
 *
 * One attacker, one target (a company, or a set of projects inside one), every
 * endpoint: each route handler with the target's real ids in its path and a
 * valid body, each collection route read with the target's ids in its filters,
 * each server action with the target's ids as its arguments. A response or
 * result is a violation when it succeeds, discloses by conflict, throws, fails
 * with a server error, or carries any identifier the target owns.
 */

export type Violation = { endpoint: string; status: number | string; kind: string; detail: string };
export type SweepResult = { violations: Violation[]; uncovered: string[]; calls: number; statuses: Record<string, number>; unvalidated: string[] };

export type SweepTarget = ParamContext & {
  /** Identifiers the attacker must never be shown. */
  foreign: Set<string>;
};

/**
 * A 2xx that states nothing happened.
 *
 * An idempotent removal — un-starring a record, forgetting a recent one —
 * answers 200 whether or not the caller had anything to remove, because a
 * second click is not an error. What makes that safe is that it says so:
 * `removed: false` is the endpoint reporting a no-op, which is the opposite of
 * a write the attacker got away with.
 */
function reportsNoChange(body: unknown): boolean {
  const data = (body as { data?: unknown })?.data;
  return Boolean(data && typeof data === "object" && (data as { removed?: unknown }).removed === false);
}

/** Filters a collection route might take a foreign id through (§171, §172). */
const FILTER_KEYS: Record<string, string> = {
  projectId: "Project",
  clientId: "Client",
  memberId: "CompanyMember",
  employeeId: "EmployeeProfile",
  assigneeMemberId: "CompanyMember",
  ownerMemberId: "CompanyMember",
  requesterId: "CompanyMember",
  departmentId: "Department",
  contractorId: "ContractorProfile",
  workPackageId: "WorkPackage",
  documentId: "Document",
  taskId: "Task",
  meetingId: "Meeting",
  contractId: "Contract",
  supplierId: "Supplier",
  milestoneId: "ProjectMilestone",
  dailyLogId: "DailyLog",
};

async function filterQuery(target: SweepTarget): Promise<{ query: string; supplied: string[] }> {
  const search = new URLSearchParams();
  for (const [key, model] of Object.entries(FILTER_KEYS)) {
    const restriction: Record<string, string[]> = target.projectIds ? (model === "Project" ? { id: target.projectIds } : { projectId: target.projectIds }) : {};
    const [row] = await ownedRows(model, target.companyId, restriction);
    if (row) search.set(key, String(row.id));
  }
  const [project] = await ownedRows("Project", target.companyId, target.projectIds ? { id: target.projectIds } : {});
  if (project) {
    search.set("record", `project:${project.id}`);
    search.set("parentType", "project");
    search.set("parentId", String(project.id));
    search.set("recordType", "project");
    search.set("recordId", String(project.id));
    // Search and the palette take free text: the target's own project name.
    search.set("q", String(project.name ?? project.code ?? "a"));
  }
  search.set("from", "2026-08-01T00:00:00.000Z");
  search.set("to", "2026-10-15T00:00:00.000Z");
  const supplied = [...search.entries()].filter(([key]) => key !== "q").map(([, value]) => value);
  return { query: search.toString(), supplied };
}

/**
 * Routes that name the companies of the reader's own group by design: the
 * people directory and profiles show which company a colleague works for
 * (E-01 §5, §7, §32; ADR 0002). There, and only for a target company of the
 * attacker's own group, the company's own id is not a disclosure. Its records'
 * ids still are, and a company of another group is never exempt.
 */
const GROUP_VISIBLE_COMPANY = /^\/api\/people(\/|$)/;

export async function sweepRoutes(attacker: UserContext, target: SweepTarget, options: { only?: (pattern: string) => boolean } = {}): Promise<SweepResult> {
  const result: SweepResult = { violations: [], uncovered: [], calls: 0, statuses: {}, unvalidated: [] };
  const filters = await filterQuery(target);
  const idFor = await idsByFieldName(target.companyId);
  const targetCompany = await prisma.company.findUnique({ where: { id: target.companyId }, select: { parentGroupId: true } });
  const sibling = targetCompany?.parentGroupId === attacker.parentGroupId;
  const withoutCompany = new Set([...target.foreign].filter((id) => id !== target.companyId));
  actAs(attacker);

  for (const route of discoverApiRoutes()) {
    if (NON_SESSION_ROUTES.has(route.pattern) || isPlatformRoute(route.pattern) || (options.only && !options.only(route.pattern))) continue;
    // A project restriction has nothing to say about routes with no project-bound segment.
    if (target.projectIds && route.params.length === 0 && !/\/(search|calendar|approvals|dashboard|productivity|timesheets|recent-work|favorites)/.test(route.pattern) && !route.pattern.match(/^\/api\/[\w-]+$/)) continue;
    const handlers = await loadRouteModule(route);
    const variants = await paramVariants(route.pattern, route.params, target);
    if (route.params.length > 0 && variants.length === 0) {
      result.uncovered.push(route.pattern);
      continue;
    }

    for (const variant of variants) {
      for (const method of HTTP_METHODS) {
        const handler = handlers[method];
        if (!handler) continue;
        // Writes to a collection route land in the attacker's own company or
        // project; only its reads can be aimed at the target.
        if (route.params.length === 0 && method !== "GET") continue;

        const basePath = fillPattern(route.pattern, variant.params);
        const attempts = method === "GET" ? [basePath, `${basePath}?${filters.query}`] : [basePath];
        for (const path of attempts) {
          result.calls += 1;
          const outcome = method === "GET" ? { ...(await callRoute(handler, method, path, variant.params)), sent: {} } : await callRouteWithValidBody(handler, method, path, variant.params, idFor);
          result.statuses[outcome.status] = (result.statuses[outcome.status] ?? 0) + 1;
          if (outcome.status === 422 && method !== "GET") result.unvalidated.push(`${method} ${route.pattern}`);

          const supplied = new Set([...Object.values(variant.params), ...(path.includes("?") ? filters.supplied : []), ...Object.values(outcome.sent).flat().map(String)]);
          const record = (kind: string, detail: string) => result.violations.push({ endpoint: `${method} ${path}`, status: outcome.status, kind, detail });

          if (outcome.thrown) record("threw", outcome.thrown);
          else if (outcome.status >= 500) record("server-error", JSON.stringify(outcome.body).slice(0, 300));
          else if (outcome.status === 409 && route.params.length > 0) record("disclosed-by-conflict", JSON.stringify(outcome.body).slice(0, 300));
          else if (outcome.status < 300) {
            const foreign = sibling && GROUP_VISIBLE_COMPANY.test(route.pattern) ? withoutCompany : target.foreign;
            const leaked = foreignIdentifiersIn(outcome.body, foreign, supplied);
            if (leaked.length > 0) record("leak", leaked.slice(0, 5).join(", "));
            else if (route.params.length > 0 && method !== "GET" && !reportsNoChange(outcome.body)) record("accepted-write", JSON.stringify(outcome.body).slice(0, 200));
          }
        }
      }
    }
  }
  return result;
}

function redirectDigest(error: unknown): string {
  return error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : "";
}

async function invokeAction(action: ServerAction, args: unknown[]): Promise<{ result?: unknown; redirected?: boolean; thrown?: string }> {
  const actions = (await import(/* @vite-ignore */ `@/${action.file}`)) as Record<string, (...input: unknown[]) => Promise<unknown>>;
  try {
    return { result: await actions[action.name](...args) };
  } catch (error) {
    const digest = redirectDigest(error);
    if (digest.startsWith("NEXT_REDIRECT")) return { redirected: true };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return {};
    return { thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

function fieldErrorsOf(result: unknown): Record<string, string[]> | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const errors = record.fieldErrors ?? record.errors;
  return errors && typeof errors === "object" && !Array.isArray(errors) ? (errors as Record<string, string[]>) : null;
}

export async function sweepActions(attacker: UserContext, target: SweepTarget, options: { only?: (action: ServerAction) => boolean } = {}): Promise<SweepResult> {
  const result: SweepResult = { violations: [], uncovered: [], calls: 0, statuses: {}, unvalidated: [] };
  const idFor = await idsByFieldName(target.companyId);
  const restriction = (model: string): Record<string, string[]> => (target.projectIds ? (model === "Project" ? { id: target.projectIds } : { projectId: target.projectIds }) : {});
  actAs(attacker);

  for (const action of discoverServerActions()) {
    if (options.only && !options.only(action)) continue;
    const idParameters = action.parameters.filter((parameter) => /Id$/.test(parameter.name) && parameter.type === "string");
    if (idParameters.length === 0) continue;

    const supplied: string[] = [];
    const baseArgs: unknown[] = [];
    let resolvable = true;
    for (const parameter of action.parameters) {
      if (/Id$/.test(parameter.name) && parameter.type === "string") {
        const model = modelForArgument(action.file, parameter.name) ?? (parameter.name === "projectId" ? "Project" : parameter.name === "taskId" ? "Task" : parameter.name === "clientId" ? "Client" : null);
        const id = model ? ((await ownedRows(model, target.companyId, restriction(model), 5, target.exceptMemberId))[0]?.id as string | undefined) : target.projectIds ? undefined : idFor(parameter.name);
        if (!id) {
          resolvable = false;
          break;
        }
        supplied.push(id);
        baseArgs.push(id);
      } else if (parameter.type === "FormData") baseArgs.push(new FormData());
      else if (parameter.literals.length > 0) baseArgs.push(parameter.literals[0]);
      else if (parameter.type === "string") baseArgs.push("Security sweep");
      else if (parameter.type === "boolean") baseArgs.push(true);
      else if (parameter.type === "number") baseArgs.push(1);
      else baseArgs.push(parameter.optional ? undefined : {});
    }
    if (!resolvable) {
      result.uncovered.push(`${action.file}#${action.name}`);
      continue;
    }

    const literalIndex = action.parameters.findIndex((parameter) => parameter.literals.length > 0);
    const variants = literalIndex >= 0 ? action.parameters[literalIndex].literals.slice(0, 6).map((literal) => baseArgs.map((value, index) => (index === literalIndex ? literal : value))) : [baseArgs];
    const formIndex = action.parameters.findIndex((parameter) => parameter.type === "FormData");

    for (const args of variants) {
      const form: Record<string, unknown> = {};
      const tried = new Map<string, number>();
      let outcome = await invokeAction(action, args);
      result.calls += 1;
      for (let round = 0; formIndex >= 0 && round < 6; round += 1) {
        const errors = fieldErrorsOf(outcome.result);
        if (!errors) break;
        let progressed = false;
        for (const [field, messages] of Object.entries(errors)) {
          const attempt = tried.get(field) ?? 0;
          const candidates = candidateValues(field, messages ?? [], idFor);
          if (attempt >= candidates.length) continue;
          form[field] = candidates[attempt];
          tried.set(field, attempt + 1);
          progressed = true;
        }
        if (!progressed) break;
        const data = new FormData();
        for (const [field, value] of Object.entries(form)) data.set(field, Array.isArray(value) ? value.join(",") : String(value));
        outcome = await invokeAction(action, args.map((value, index) => (index === formIndex ? data : value)));
        result.calls += 1;
      }

      const endpoint = `${action.file}#${action.name}(${args.filter((value) => typeof value === "string").join(", ")})`;
      const record = (kind: string, detail: string) => result.violations.push({ endpoint, status: "action", kind, detail });
      if (outcome.thrown) record("threw", outcome.thrown);
      else if (outcome.redirected) record("redirected-as-success", "the action redirected, which it only does after succeeding");
      else if (outcome.result && typeof outcome.result === "object" && (outcome.result as { ok?: unknown }).ok === true) record("accepted", JSON.stringify(outcome.result).slice(0, 200));
      else {
        const leaked = foreignIdentifiersIn(outcome.result, target.foreign, new Set([...supplied, ...Object.values(form).map(String)]));
        if (leaked.length > 0) record("leak", leaked.slice(0, 5).join(", "));
      }
    }
  }
  return result;
}

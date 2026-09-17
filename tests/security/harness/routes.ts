import { readdirSync } from "node:fs";

import { resetRateLimits } from "@/lib/core/security/rate-limit";

/**
 * Every API route handler, found on disk and called the way Next calls it
 * (PRD #47 §105, §153, §155).
 *
 * Discovery reads `app/api` rather than a list, so a route added without a
 * matching test is still attacked by the sweep the next time it runs.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type ApiRoute = {
  /** Source file, relative to the repository root. */
  file: string;
  /** URL pattern, e.g. `/api/tasks/[taskId]`. */
  pattern: string;
  params: string[];
};

/**
 * Routes that are not session-authenticated business endpoints, and so are
 * classified and tested elsewhere (PRD #47 §103, §104):
 *   - Auth.js's own handler,
 *   - the signed storage endpoint, whose signature is the authorisation,
 *   - health probes and the token-authenticated metrics endpoint.
 */
export const NON_SESSION_ROUTES = new Set([
  "/api/auth/[...nextauth]",
  "/api/storage/objects/[...key]",
  "/api/health/live",
  "/api/health/ready",
  "/api/internal/metrics",
]);

export function discoverApiRoutes(): ApiRoute[] {
  return (readdirSync("app/api", { recursive: true }) as string[])
    .filter((entry) => entry.endsWith("route.ts"))
    .map((entry) => `app/api/${entry.split("\\").join("/")}`)
    .map((file) => {
      const pattern = file.replace(/^app/, "").replace(/\/route\.ts$/, "");
      const params = [...pattern.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((match) => match[1]);
      return { file, pattern, params };
    })
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export type RouteModule = Partial<Record<HttpMethod, (request: Request, init: { params: Promise<Record<string, string>> }) => Promise<Response>>>;

export async function loadRouteModule(route: ApiRoute): Promise<RouteModule> {
  return (await import(/* @vite-ignore */ `@/${route.file}`)) as RouteModule;
}

export type RouteOutcome = {
  status: number;
  body: unknown;
  /** Set when the handler threw instead of answering — itself a defect. */
  thrown?: string;
};

export function fillPattern(pattern: string, params: Record<string, string>): string {
  return pattern.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
}

/**
 * Calls one handler. Rate limits are cleared first: throttling is not
 * authorisation (PRD #47 §239), and a sweep sending hundreds of writes would
 * otherwise measure the limiter instead of the guards behind it.
 */
export async function callRoute(
  handler: NonNullable<RouteModule[HttpMethod]>,
  method: HttpMethod,
  path: string,
  params: Record<string, string>,
  body: unknown = {},
): Promise<RouteOutcome> {
  resetRateLimits();
  const init: RequestInit = { method, headers: { "content-type": "application/json", "idempotency-key": `sweep-${crypto.randomUUID()}` } };
  if (method !== "GET") init.body = JSON.stringify(body);

  try {
    const response = await handler(new Request(`http://localhost${path}`, init), { params: Promise.resolve(params) });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body (a file, a CSV export) is still scanned as text.
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    return { status: 0, body: null, thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/**
 * A request body the route's own validator accepts.
 *
 * An empty body is refused before most write handlers look anything up, so an
 * attack sent with one only proves the schema works (PRD #47 §58: validation
 * comes before the record fetch). The error that refusal carries names every
 * field it wanted and why, so the body is completed from it and resent until
 * validation passes or stops making progress — at which point the request
 * reaches the lookup, which is what the attack is for.
 */
export async function callRouteWithValidBody(
  handler: NonNullable<RouteModule[HttpMethod]>,
  method: HttpMethod,
  path: string,
  params: Record<string, string>,
  idFor: (field: string) => string | undefined,
): Promise<RouteOutcome & { sent: Record<string, unknown> }> {
  const body: Record<string, unknown> = {};
  const tried = new Map<string, number>();
  let outcome = await callRoute(handler, method, path, params, body);

  for (let round = 0; method !== "GET" && outcome.status === 422 && round < 8; round += 1) {
    const details = (outcome.body as { error?: { details?: unknown } } | null)?.error?.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) break;

    let progressed = false;
    for (const [field, messages] of Object.entries(details as Record<string, unknown>)) {
      const attempt = tried.get(field) ?? 0;
      const candidates = candidateValues(field, Array.isArray(messages) ? messages.map(String) : [], idFor);
      if (attempt >= candidates.length) continue;
      body[field] = candidates[attempt];
      tried.set(field, attempt + 1);
      progressed = true;
    }
    if (!progressed) break;
    outcome = await callRoute(handler, method, path, params, body);
  }

  return { ...outcome, sent: body };
}

/**
 * Fields a name and a message cannot describe. Validation errors are flattened
 * to the top-level field, so "expected object" inside `floors[0]` is all the
 * sweep ever hears — it cannot build the element from that. A floor `number`
 * is tried below ground first, because the first level type offered is a
 * basement. Ids come from the target company, so the request reaches the
 * lookup it is attacking.
 */
const SHAPED: Record<string, (idFor: (field: string) => string | undefined) => unknown[]> = {
  ids: (idFor) => [[idFor("id") ?? "sweep_unknown_id"]],
  floors: () => [[{ number: 97, name: "Security sweep floor", levelType: "STANDARD" }]],
  units: (idFor) => [[{ unitCode: "SWEEP-1", sourceUnitId: idFor("unitId") ?? "sweep_unknown_id" }]],
  defaults: (idFor) => [{ unitTypeId: idFor("unitTypeId") ?? "sweep_unknown_id" }],
  number: () => [-1, 1],
};

export function candidateValues(field: string, messages: string[], idFor: (field: string) => string | undefined): unknown[] {
  const message = messages.join(" ");
  if (SHAPED[field]) return SHAPED[field](idFor);
  const options = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (/expected one of/i.test(message) && options.length > 0) return options.slice(0, 3);
  if (/expected boolean/i.test(message)) return [true, false];
  if (/expected array/i.test(message) || /Ids$/.test(field)) {
    const id = idFor(field.replace(/Ids$/, "Id"));
    return id ? [[id], []] : [[]];
  }
  if (/expected object/i.test(message)) return [{}];
  if (/version/i.test(field)) return [1, 0, 2];
  if (/Id$/.test(field)) {
    const id = idFor(field);
    return id ? [id, "sweep_unknown_id"] : ["sweep_unknown_id"];
  }
  if (/expected number/i.test(message) || /(amount|quantity|hours|minutes|count|rate|pct|percent|days|order|lag)/i.test(field)) return [1, "1"];
  if (/email/i.test(field)) return ["sweep@nesto.test"];
  if (/time$/i.test(field)) return ["09:00", "2026-09-14T09:00:00.000Z"];
  if (/(At|Date|date|On|From|To|Until|week|Week)$/.test(field) || /date/i.test(message)) return ["2026-09-14", "2026-09-14T09:00:00.000Z"];
  return ["Security sweep text for " + field, "2026-09-14", 1, true];
}

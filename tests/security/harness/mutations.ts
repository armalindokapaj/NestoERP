import type { UserContext } from "@/lib/context/types";
import { prisma } from "../../helpers";
import { actAs } from "./actor";
import { discoverServerActions, modelForArgument, type ServerAction } from "./actions";
import { companyOwnedModels, ownedRows } from "./company-data";
import { idsByFieldName, paramVariants, type ParamContext } from "./params";
import { callRoute, callRouteWithValidBody, candidateValues, discoverApiRoutes, fillPattern, HTTP_METHODS, isPlatformRoute, loadRouteModule, NON_SESSION_ROUTES, type HttpMethod, type RouteModule, type RouteOutcome } from "./routes";

/**
 * Forged writes from inside the company (AUD-06 §6, RP-09, RP-17, RP-23).
 *
 * The isolation sweeps (sweep.ts) attack another company, so they skip every
 * write to a collection route: a create lands in the attacker's own company,
 * where it is not a cross-company write. Inside one company that create is
 * exactly the forgery a read-only or narrow-scope member must not get away
 * with — the button being hidden is not the enforcement (RP-23). So this sweep
 * sends every write method of every route, collection routes included, and
 * every exported server action, creates included, with the company's own real
 * ids, and hands back each outcome for the suite to judge against its own,
 * independently written expectations. It judges nothing itself.
 */

export type MutationAttempt = {
  endpoint: string;
  pattern: string;
  method: HttpMethod;
  status: number;
  /** The API error code, when the answer was an error envelope. */
  code: string | null;
  body: unknown;
  thrown?: string;
  /** The path's segments, by name. */
  params: Record<string, string>;
  /** Every id the request carried: the path's and the body's. */
  ids: string[];
};

const errorCode = (body: unknown): string | null => {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : null;
};

/**
 * Every write method of every session route, called by `actor` against
 * `target.companyId`'s own records. Routes whose segments cannot be filled
 * from real rows are returned as uncovered rather than attacked with an id
 * that proves nothing.
 */
export async function sweepWrites(
  actor: UserContext,
  target: ParamContext,
  options: { only?: (pattern: string, method: HttpMethod) => boolean } = {},
): Promise<{ attempts: MutationAttempt[]; uncovered: string[] }> {
  const attempts: MutationAttempt[] = [];
  const uncovered: string[] = [];
  const idFor = await idsByFieldName(target.companyId);
  actAs(actor);

  for (const route of discoverApiRoutes()) {
    if (NON_SESSION_ROUTES.has(route.pattern) || isPlatformRoute(route.pattern)) continue;
    const handlers = await loadRouteModule(route);
    const methods = HTTP_METHODS.filter((method) => method !== "GET" && handlers[method] && (!options.only || options.only(route.pattern, method)));
    if (methods.length === 0) continue;
    const [variant] = await paramVariants(route.pattern, route.params, target);
    if (!variant) {
      uncovered.push(route.pattern);
      continue;
    }
    for (const method of methods) {
      const path = fillPattern(route.pattern, variant.params);
      const outcome = await callRouteWithValidBody(handlers[method]!, method, path, variant.params, idFor);
      const ids = [...Object.values(variant.params), ...Object.values(outcome.sent).flat().filter((value): value is string => typeof value === "string")];
      attempts.push({ endpoint: `${method} ${path}`, pattern: route.pattern, method, status: outcome.status, code: errorCode(outcome.body), body: outcome.body, thrown: outcome.thrown, params: variant.params, ids });
    }
  }
  return { attempts, uncovered };
}

export type ActionAttempt = {
  endpoint: string;
  action: ServerAction;
  /** accepted: `{ ok: true }` or a redirect into the app; refused: anything else that is not a throw. */
  outcome: "accepted" | "refused" | "threw";
  detail: string;
  result: unknown;
  ids: string[];
};

/** Where a refusing action sends the browser: never a sign of success. */
const REFUSAL_DESTINATIONS = /^\/(access-denied|module-unavailable|login|select-company|workspace)/;

function digestOf(error: unknown): string {
  return error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : "";
}

async function invoke(action: ServerAction, args: unknown[]): Promise<{ result?: unknown; redirectedTo?: string; refused?: string; thrown?: string }> {
  const actions = (await import(/* @vite-ignore */ `@/${action.file}`)) as Record<string, (...input: unknown[]) => Promise<unknown>>;
  try {
    return { result: await actions[action.name](...args) };
  } catch (error) {
    const digest = digestOf(error);
    // NEXT_REDIRECT;<type>;<url>;<status>;
    if (digest.startsWith("NEXT_REDIRECT")) return { redirectedTo: digest.split(";")[2] ?? "" };
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;")) return { refused: digest };
    return { thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

function fieldErrorsOf(result: unknown): Record<string, string[]> | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const errors = record.fieldErrors ?? record.errors;
  return errors && typeof errors === "object" && !Array.isArray(errors) ? (errors as Record<string, string[]>) : null;
}

/** A server action's answer, classified: `accepted` is `{ ok: true }` or a redirect into the app. */
export type ActionOutcome = { outcome: "accepted" | "refused" | "threw"; detail: string; result: unknown; form: Record<string, unknown> };

/** Resolves an action by its file and exported name. */
export function serverAction(file: string, name: string): ServerAction {
  const found = discoverServerActions().find((action) => action.file === file && action.name === name);
  if (!found) throw new Error(`No server action ${file}#${name}`);
  return found;
}

/**
 * Calls one action, completing its FormData argument (if it has one) from
 * the field errors it answers with, starting from `seed` — the fields a test
 * names itself because a validation message cannot describe them.
 */
export async function callActionFilled(action: ServerAction, args: unknown[], idFor: (field: string) => string | undefined, seed: Record<string, unknown> = {}): Promise<ActionOutcome> {
  const formIndex = action.parameters.findIndex((parameter) => parameter.type === "FormData");
  const form: Record<string, unknown> = { ...seed };
  const tried = new Map<string, number>();
  const withForm = () => {
    const data = new FormData();
    for (const [field, value] of Object.entries(form)) data.set(field, Array.isArray(value) ? value.join(",") : String(value));
    return args.map((value, index) => (index === formIndex ? data : value));
  };
  let outcome = await invoke(action, formIndex >= 0 ? withForm() : args);
  for (let round = 0; formIndex >= 0 && round < 8; round += 1) {
    const errors = fieldErrorsOf(outcome.result);
    if (!errors) break;
    let progressed = false;
    for (const [field, messages] of Object.entries(errors)) {
      if (field in seed) continue;
      const attempt = tried.get(field) ?? 0;
      const candidates = candidateValues(field, messages ?? [], idFor);
      if (attempt >= candidates.length) continue;
      form[field] = candidates[attempt];
      tried.set(field, attempt + 1);
      progressed = true;
    }
    if (!progressed) break;
    outcome = await invoke(action, withForm());
  }

  if (outcome.thrown) return { outcome: "threw", detail: outcome.thrown, result: null, form };
  if (outcome.redirectedTo !== undefined) return { outcome: REFUSAL_DESTINATIONS.test(outcome.redirectedTo) ? "refused" : "accepted", detail: `redirected to ${outcome.redirectedTo}`, result: null, form };
  if (outcome.refused) return { outcome: "refused", detail: outcome.refused, result: null, form };
  const ok = Boolean(outcome.result && typeof outcome.result === "object" && (outcome.result as { ok?: unknown }).ok === true);
  return { outcome: ok ? "accepted" : "refused", detail: JSON.stringify(outcome.result ?? null).slice(0, 300), result: outcome.result, form };
}

/**
 * Every exported server action — creates as well as changes to a record —
 * called by `actor` with the company's own ids. A FormData argument is
 * completed from the field errors the action answers with, so a refusal that
 * comes after validation is still reached.
 */
export async function sweepAllActions(actor: UserContext, companyId: string, options: { only?: (action: ServerAction) => boolean } = {}): Promise<{ attempts: ActionAttempt[]; uncovered: string[] }> {
  const attempts: ActionAttempt[] = [];
  const uncovered: string[] = [];
  const idFor = await idsByFieldName(companyId);
  actAs(actor);

  for (const action of discoverServerActions()) {
    if (options.only && !options.only(action)) continue;
    const args: unknown[] = [];
    const ids: string[] = [];
    let resolvable = true;
    for (const parameter of action.parameters) {
      if (/Id$/.test(parameter.name) && parameter.type === "string") {
        const model = modelForArgument(action.file, parameter.name) ?? ({ projectId: "Project", taskId: "Task", clientId: "Client" } as Record<string, string>)[parameter.name];
        const id = model ? ((await ownedRows(model, companyId))[0]?.id as string | undefined) : idFor(parameter.name);
        if (!id) {
          resolvable = false;
          break;
        }
        ids.push(id);
        args.push(id);
      } else if (parameter.type === "FormData") args.push(new FormData());
      else if (parameter.literals.length > 0) args.push(parameter.literals[0]);
      else if (parameter.type === "string") args.push("Security sweep");
      else if (parameter.type === "boolean") args.push(true);
      else if (parameter.type === "number") args.push(1);
      else args.push(parameter.optional ? undefined : {});
    }
    if (!resolvable) {
      uncovered.push(`${action.file}#${action.name}`);
      continue;
    }
    const called = await callActionFilled(action, args, idFor);
    const allIds = [...ids, ...Object.values(called.form).flat().filter((value): value is string => typeof value === "string")];
    attempts.push({ endpoint: `${action.file}#${action.name}`, action, outcome: called.outcome, detail: called.detail, result: called.result, ids: allIds });
  }
  return { attempts, uncovered };
}

/**
 * `callRouteWithValidBody` with a starting body: the fields a test names
 * itself (a currency, a time, a category) because a validation message
 * cannot describe them, completed from the route's own validation errors.
 */
export async function callRouteFilled(
  handler: NonNullable<RouteModule[HttpMethod]>,
  method: HttpMethod,
  path: string,
  params: Record<string, string>,
  idFor: (field: string) => string | undefined,
  seed: Record<string, unknown> = {},
): Promise<RouteOutcome & { sent: Record<string, unknown> }> {
  const body: Record<string, unknown> = { ...seed };
  const tried = new Map<string, number>();
  let outcome = await callRoute(handler, method, path, params, body);
  for (let round = 0; outcome.status === 422 && round < 8; round += 1) {
    const details = (outcome.body as { error?: { details?: unknown } } | null)?.error?.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) break;
    let progressed = false;
    for (const [field, messages] of Object.entries(details as Record<string, unknown>)) {
      if (field in seed) continue;
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

/** One route's handlers by URL pattern. */
export async function routeHandlers(pattern: string): Promise<RouteModule> {
  const route = discoverApiRoutes().find((candidate) => candidate.pattern === pattern);
  if (!route) throw new Error(`No API route ${pattern}`);
  return loadRouteModule(route);
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const LABEL_COLUMNS = ["name", "title", "subject", "displayName", "legalName", "description"];

/**
 * What a record is called, by id (AUD-06 §6, RP-17 "redacted metadata"): the
 * human-readable values a refusal must never repeat back. Only values long
 * enough to be distinctive are kept, so a generic message cannot match by
 * accident.
 */
export async function recordLabels(companyId: string): Promise<Map<string, string[]>> {
  const labels = new Map<string, string[]>();
  for (const model of companyOwnedModels()) {
    const columns = LABEL_COLUMNS.filter((column) => model.columns.has(column));
    if (!model.columns.has("id") || columns.length === 0) continue;
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "id", ${columns.map(quote).join(", ")} FROM ${quote(model.table)} WHERE "companyId" = $1`,
      companyId,
    );
    for (const row of rows) {
      const values = columns.map((column) => row[column]).filter((value): value is string => typeof value === "string" && value.trim().length >= 6);
      if (values.length > 0) labels.set(String(row.id), values);
    }
  }
  return labels;
}

/** Labels of the records a request named that its answer repeats. */
export function labelsDisclosed(body: unknown, ids: string[], labels: Map<string, string[]>): string[] {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return ids.flatMap((id) => (labels.get(id) ?? []).filter((label) => text.includes(label)));
}

/**
 * Every row id a company owns, table by table — the baseline a positive
 * control's own writes are measured against, so exactly those rows, and no
 * seeded one, are taken away again afterwards.
 */
export async function companyRowIds(companyId: string): Promise<Map<string, Set<string>>> {
  const ids = new Map<string, Set<string>>();
  for (const model of companyOwnedModels()) {
    if (!model.columns.has("id")) continue;
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM ${quote(model.table)} WHERE "companyId" = $1`, companyId);
    ids.set(model.table, new Set(rows.map((row) => row.id)));
  }
  return ids;
}

/** Rows that exist now and did not at `baseline`, by table. */
export async function rowsCreatedSince(companyId: string, baseline: Map<string, Set<string>>): Promise<Map<string, string[]>> {
  const created = new Map<string, string[]>();
  for (const [table, ids] of await companyRowIds(companyId)) {
    const before = baseline.get(table) ?? new Set<string>();
    const added = [...ids].filter((id) => !before.has(id));
    if (added.length > 0) created.set(table, added);
  }
  return created;
}

/**
 * Deletes what a positive control created. Foreign keys decide the order, so
 * tables are retried until a pass deletes nothing more; whatever is left is
 * returned for the suite to fail on rather than leaving it silently behind.
 */
export async function removeRowsCreatedSince(companyId: string, baseline: Map<string, Set<string>>): Promise<string[]> {
  let pending = await rowsCreatedSince(companyId, baseline);
  for (let pass = 0; pass < 8 && pending.size > 0; pass += 1) {
    for (const [table, ids] of pending) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM ${quote(table)} WHERE "id" = ANY($1::text[])`, ids);
      } catch {
        // Something still points at these rows; a later pass takes it first.
      }
    }
    pending = await rowsCreatedSince(companyId, baseline);
    // Link rows keyed by their two ends (a meeting's participants) have no id
    // to find them by. Whatever points at a row created since the baseline was
    // created since the baseline too, so it goes first.
    for (const [table, ids] of pending) {
      const children = await prisma.$queryRawUnsafe<{ child: string; column: string }[]>(
        `SELECT c.conrelid::regclass::text AS child, a.attname AS column
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1`,
        quote(table),
      );
      for (const { child, column } of children) {
        try {
          await prisma.$executeRawUnsafe(`DELETE FROM ${child} WHERE ${quote(column)} = ANY($1::text[])`, ids);
        } catch {
          // Its own dependants go on a later pass.
        }
      }
    }
  }
  return [...pending].map(([table, ids]) => `${table}: ${ids.length}`);
}

/**
 * Puts a table's rows for one company back exactly as they were. For the
 * counters a positive control moves as a side effect of succeeding — a
 * numbering sequence, a leave balance — which are updates, not rows the
 * control created, so `removeRowsCreatedSince` cannot take them back.
 */
export async function preserveRows(table: string, companyId: string): Promise<() => Promise<void>> {
  const columns = (await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, table)).map((row) => row.column_name);
  const rows = await prisma.$queryRawUnsafe<{ id: string; json: string }[]>(`SELECT t."id" AS id, row_to_json(t)::text AS json FROM ${quote(table)} t WHERE t."companyId" = $1`, companyId);
  const list = columns.map(quote).join(", ");
  const values = columns.map((column) => `r.${quote(column)}`).join(", ");
  return async () => {
    for (const row of rows) {
      await prisma.$executeRawUnsafe(`UPDATE ${quote(table)} AS x SET (${list}) = (SELECT ${values} FROM json_populate_record(NULL::${quote(table)}, $1::json) AS r) WHERE x."id" = $2`, row.json, row.id);
    }
  };
}

/**
 * Everything a company owns, row by row, and the way back to it (AUD-06 §6).
 *
 * For a positive control that has to act on a seeded record — a decision on
 * a week somebody really submitted — rather than on a fixture of its own. The
 * returned function deletes every row created since, puts every changed row
 * back as it was, and names whatever it could not (a row deleted in between),
 * for the suite to fail on.
 */
export async function captureCompanyRows(companyId: string): Promise<() => Promise<string[]>> {
  const baseline = await companyRowIds(companyId);
  const rowsOf = async (table: string) =>
    new Map((await prisma.$queryRawUnsafe<{ id: string; json: string }[]>(`SELECT t."id" AS id, row_to_json(t)::text AS json FROM ${quote(table)} t WHERE t."companyId" = $1`, companyId)).map((row) => [row.id, row.json]));
  const captured = new Map<string, Map<string, string>>();
  for (const table of baseline.keys()) captured.set(table, await rowsOf(table));

  return async () => {
    const problems = await removeRowsCreatedSince(companyId, baseline);
    for (const [table, rows] of captured) {
      const now = await rowsOf(table);
      const columns = (await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, table)).map((row) => row.column_name);
      for (const [id, json] of rows) {
        if (!now.has(id)) problems.push(`${table}: ${id} deleted`);
        else if (now.get(id) !== json) {
          await prisma.$executeRawUnsafe(
            `UPDATE ${quote(table)} AS x SET (${columns.map(quote).join(", ")}) = (SELECT ${columns.map((column) => `r.${quote(column)}`).join(", ")} FROM json_populate_record(NULL::${quote(table)}, $1::json) AS r) WHERE x."id" = $2`,
            json,
            id,
          );
        }
      }
    }
    return problems;
  };
}

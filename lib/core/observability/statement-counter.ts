import type { Prisma } from "@prisma/client";

import { currentRequestContext } from "@/lib/core/observability/request-context";
import { currentRequestScope, type RequestScope } from "@/lib/core/observability/request-scope";

/**
 * Request-correlated SQL statement counts (AUD-07 §5, PS-04).
 *
 * Opt-in, for performance runs and tests only: nothing here runs unless
 * `NESTO_PERF_SQL_COUNT=1`, and never on Vercel or where `APP_ENV` says
 * production or staging, whatever the flag says. With it off the Prisma client
 * is the plain one, untouched.
 *
 * Two counts, both exact for what they name:
 * - **operations**: every Prisma call (model operations and raw SQL), counted
 *   in the caller's own request scope through a query extension, so it is
 *   request-correlated by construction;
 * - **statements**: every SQL statement the engine sent (Prisma's `query`
 *   event), transaction control included and counted apart. The engine reports
 *   a statement outside the caller's async context, so it is credited to the
 *   one scope with a Prisma call in flight; when two scopes overlap it is
 *   counted as `ambiguous` on each instead of being guessed.
 *
 * This replaces the transaction-commit proxy (`xact_commit` deltas for the
 * whole database, tests/e2e/perf/navigation-query-count.spec.ts) as the exact
 * evidence; the proxy stays only as separately labelled supporting evidence.
 *
 * What leaves the process is one log line per request scope once it goes
 * quiet (`perf.sql.request`): counts, milliseconds, model and operation names,
 * the request kind and the harness's probe label. Never SQL text, parameters,
 * bindings, cookies, tokens, names or company ids (§5, PS-21).
 */

export const STATEMENT_COUNT_FLAG = "NESTO_PERF_SQL_COUNT";
export const PERF_PROBE_HEADER = "x-nesto-perf-probe";
export const STATEMENT_LOG_EVENT = "perf.sql.request";

type Env = Record<string, string | undefined>;

/** Whether counting may run in this process. Off unless asked for, and never in a deployment. */
export function statementCountingEnabled(env: Env = process.env): boolean {
  if (env[STATEMENT_COUNT_FLAG] !== "1") return false;
  if (env.VERCEL === "1" || env.VERCEL_ENV) return false;
  const app = env.APP_ENV?.toLowerCase();
  return app !== "production" && app !== "staging";
}

export type RequestKind = "document" | "rsc" | "prefetch" | "action" | "api" | "background" | "unknown";

export type StatementTally = {
  /** Prisma calls, model and raw. */
  operations: number;
  /** SQL statements credited to this scope alone. */
  statements: number;
  /** BEGIN / COMMIT / ROLLBACK / SAVEPOINT among `statements`. */
  transactionControl: number;
  /** Statements reported while another scope also had a call in flight: not credited, counted here. */
  ambiguous: number;
  /** Engine-reported milliseconds of the credited statements. */
  statementMs: number;
  /** Rows the calls returned (an array's length, 1 for a record, 0 for null). */
  rows: number;
  /** Raw SQL calls among `operations` ($queryRaw, $executeRaw…). */
  raw: number;
  /** Calls per model or raw operation: schema names only. */
  byModel: Record<string, number>;
  kind: RequestKind;
  probe: string | null;
  route: string | null;
  firstAt: number;
  lastAt: number;
  /** Measured by `measureStatements`: read by its caller, never written as a line. */
  silent: boolean;
};

function emptyTally(): StatementTally {
  const now = performance.now();
  return { operations: 0, statements: 0, transactionControl: 0, ambiguous: 0, statementMs: 0, rows: 0, raw: 0, byModel: {}, kind: "unknown", probe: null, route: null, firstAt: now, lastAt: now, silent: false };
}

type CounterState = {
  tallies: WeakMap<RequestScope, StatementTally>;
  /** Work with no request scope: jobs, scripts, module-level reads. Attributed separately (§5). */
  background: StatementTally;
  inFlight: Map<StatementTally, number>;
  /** Every statement the engine reported, credited or not: the process total. */
  processStatements: number;
  /** Statements reported with no call in flight anywhere (a late engine report, a transaction's BEGIN). */
  unattributed: number;
  quiet: WeakMap<StatementTally, ReturnType<typeof setTimeout>>;
  sink: ((line: StatementLogLine) => void) | null;
};

const holder = globalThis as unknown as { __nestoStatementCounter?: CounterState };

function state(): CounterState {
  return (holder.__nestoStatementCounter ??= {
    tallies: new WeakMap(),
    background: { ...emptyTally(), kind: "background" },
    inFlight: new Map(),
    processStatements: 0,
    unattributed: 0,
    quiet: new WeakMap(),
    sink: null,
  });
}

function currentTally(): StatementTally {
  const counter = state();
  const scope = currentRequestScope();
  if (!scope) return counter.background;
  let tally = counter.tallies.get(scope);
  if (!tally) {
    tally = emptyTally();
    counter.tallies.set(scope, tally);
    labelTally(tally);
  }
  return tally;
}

const PROBE = /^[A-Za-z0-9:#._-]{1,80}$/;

/** Kind, route and probe for a new tally. Route handlers know theirs; a render asks Next for its request headers. */
function labelTally(tally: StatementTally): void {
  const request = currentRequestContext();
  if (request?.route) {
    tally.kind = "api";
    tally.route = request.route;
  }
  if (request?.jobKey) tally.kind = "background";
  // Never awaited by the query: a label arrives a moment later or not at all.
  void import("next/headers")
    .then(async ({ headers }) => {
      const list = await headers();
      const probe = list.get(PERF_PROBE_HEADER);
      tally.probe = probe && PROBE.test(probe) ? probe : null;
      if (tally.kind !== "unknown") return;
      if (list.get("next-action")) tally.kind = "action";
      else if (list.get("next-router-prefetch")) tally.kind = "prefetch";
      else if (list.get("rsc") === "1") tally.kind = "rsc";
      else tally.kind = "document";
    })
    .catch(() => undefined);
}

function rowsOf(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (typeof result === "number") return 0; // counts and $executeRaw's affected rows are not returned rows
  return result === null || result === undefined ? 0 : 1;
}

/** How long a scope stays silent before its line is written. */
const QUIET_MS = 250;

function begin(tally: StatementTally, name: string, raw: boolean): void {
  tally.operations += 1;
  if (raw) tally.raw += 1;
  tally.byModel[name] = (tally.byModel[name] ?? 0) + 1;
  hold(tally);
}

/** Marks the scope as having database work in flight, so the engine's reports are credited to it. */
function hold(tally: StatementTally): void {
  const counter = state();
  tally.lastAt = performance.now();
  counter.inFlight.set(tally, (counter.inFlight.get(tally) ?? 0) + 1);
  const pending = counter.quiet.get(tally);
  if (pending) clearTimeout(pending);
}

function end(tally: StatementTally): void {
  const counter = state();
  // The engine's statement report can land a tick after the call's result: keep
  // the call in flight for one more turn of the event loop, without making the
  // caller wait for it.
  setImmediate(() => {
    const left = (counter.inFlight.get(tally) ?? 1) - 1;
    if (left > 0) counter.inFlight.set(tally, left);
    else {
      counter.inFlight.delete(tally);
      if (tally !== counter.background && !tally.silent) scheduleFlush(tally);
    }
  });
}

function scheduleFlush(tally: StatementTally): void {
  const counter = state();
  const timer = setTimeout(() => {
    counter.quiet.delete(tally);
    if (!counter.inFlight.has(tally)) writeLine(tally);
  }, QUIET_MS);
  timer.unref?.();
  counter.quiet.set(tally, timer);
}

export type StatementLogLine = {
  event: typeof STATEMENT_LOG_EVENT;
  /** "exact": statements and operations are counted per request, not the database-wide commit proxy. */
  evidence: "exact";
  kind: RequestKind;
  probe: string | null;
  route: string | null;
  operations: number;
  statements: number;
  transactionControl: number;
  ambiguous: number;
  statementMs: number;
  rows: number;
  raw: number;
  byModel: Record<string, number>;
  spanMs: number;
};

function lineOf(tally: StatementTally): StatementLogLine {
  return {
    event: STATEMENT_LOG_EVENT,
    evidence: "exact",
    kind: tally.kind,
    probe: tally.probe,
    route: tally.route,
    operations: tally.operations,
    statements: tally.statements,
    transactionControl: tally.transactionControl,
    ambiguous: tally.ambiguous,
    statementMs: Math.round(tally.statementMs * 10) / 10,
    rows: tally.rows,
    raw: tally.raw,
    byModel: { ...tally.byModel },
    spanMs: Math.round(tally.lastAt - tally.firstAt),
  };
}

function writeLine(tally: StatementTally): void {
  const line = lineOf(tally);
  const sink = state().sink;
  if (sink) sink(line);
  // One JSON object per line on stdout, parsed by the AUD-07 harness; never the logger's
  // redaction path, because nothing here is free text.
  else console.log(JSON.stringify(line));
  // A scope that wakes up again (a streamed section) starts a fresh line.
  Object.assign(tally, { ...emptyTally(), kind: tally.kind, probe: tally.probe, route: tally.route, byModel: {} });
}

const TRANSACTION_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET TRANSACTION|START TRANSACTION|DEALLOCATE)\b/i;

/** Credits one engine-reported statement. The SQL text is classified and dropped, never kept. */
export function recordStatement(event: Pick<Prisma.QueryEvent, "query" | "duration">): void {
  const counter = state();
  counter.processStatements += 1;
  const owners = [...counter.inFlight.keys()];
  const control = TRANSACTION_CONTROL.test(event.query);
  if (owners.length === 1) {
    const tally = owners[0]!;
    tally.statements += 1;
    if (control) tally.transactionControl += 1;
    tally.statementMs += Number(event.duration) || 0;
    tally.lastAt = performance.now();
  } else if (owners.length === 0) {
    counter.unattributed += 1;
  } else {
    for (const tally of owners) tally.ambiguous += 1;
  }
}

/** The probe `lib/database/prisma.ts` reports to when counting is on: one per process. */
const probe = {
  begin(model: string | undefined, operation: string): StatementTally {
    const tally = currentTally();
    begin(tally, model ?? operation, !model);
    return tally;
  },
  end(token: unknown, result: unknown): void {
    const tally = token as StatementTally;
    tally.rows += rowsOf(result);
    end(tally);
  },
  hold(): StatementTally {
    const tally = currentTally();
    hold(tally);
    return tally;
  },
  release(token: unknown): void {
    end(token as StatementTally);
  },
  statement: recordStatement,
};
(globalThis as unknown as { __nestoStatementProbe?: typeof probe }).__nestoStatementProbe = probe;

export type Measured<T> = {
  result: T;
  /** Prisma calls made inside `run`, in its own request scope. */
  operations: number;
  /** SQL statements credited to `run`'s scope. */
  statements: number;
  transactionControl: number;
  /** Every statement the process reported while `run` ran: equal to `statements` when nothing else was running. */
  processStatements: number;
  ambiguous: number;
  rows: number;
  byModel: Record<string, number>;
};

/**
 * Runs `run` in a request scope of its own and returns what it cost (tests and
 * scripts). The caller supplies the scope runner so this module never forces a
 * scope on anyone else.
 */
export async function measureStatements<T>(runInScope: <R>(fn: () => Promise<R>) => Promise<R>, run: () => Promise<T>): Promise<Measured<T>> {
  const counter = state();
  const before = counter.processStatements;
  const measured: { tally: StatementTally | null } = { tally: null };
  const result = await runInScope(async () => {
    const own = currentTally();
    own.silent = true;
    measured.tally = own;
    return run();
  });
  // Let the last calls' reports and the one-turn grace finish.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const counted = measured.tally ?? emptyTally();
  return {
    result,
    operations: counted.operations,
    statements: counted.statements,
    transactionControl: counted.transactionControl,
    processStatements: counter.processStatements - before,
    ambiguous: counted.ambiguous,
    rows: counted.rows,
    byModel: { ...counted.byModel },
  };
}

/** Test hook: capture log lines instead of writing them. */
export function setStatementLogSink(sink: ((line: StatementLogLine) => void) | null): void {
  state().sink = sink;
}

/** Process totals, for a test or a script's own summary. */
export function statementCounterTotals(): { processStatements: number; unattributed: number; background: StatementLogLine } {
  const counter = state();
  return { processStatements: counter.processStatements, unattributed: counter.unattributed, background: lineOf(counter.background) };
}

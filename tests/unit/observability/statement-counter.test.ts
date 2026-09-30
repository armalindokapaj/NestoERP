import { afterEach, describe, expect, it } from "vitest";

import { counterValue, histogramSeriesBudget, HISTOGRAMS, Metric, observeHistogram, renderPrometheus, resetHistograms, resetMetrics, type HistogramName } from "@/lib/core/observability/metrics";
import { runWithRequestScope } from "@/lib/core/observability/request-scope";
import { setStatementLogSink, statementCountingEnabled, type StatementLogLine } from "@/lib/core/observability/statement-counter";
import { perfStatementCountingEnabled, withStatementProbe } from "@/lib/database/prisma";

/**
 * AUD-07 §5, PS-04, PS-21: the opt-in statement counter and the task-command
 * histogram's folded outcome. The counter's attribution against the real
 * database is tests/api/perf/aud07-list-query-growth.test.ts; here, its gate
 * and what its log line may carry, against a stand-in client.
 */

afterEach(() => setStatementLogSink(null));

describe("the statement counter's gate", () => {
  it("is the same rule in the database layer and in observability", () => {
    const cases = [{}, { NESTO_PERF_SQL_COUNT: "1" }, { NESTO_PERF_SQL_COUNT: "1", NODE_ENV: "production" }, { NESTO_PERF_SQL_COUNT: "1", VERCEL: "1" }, { NESTO_PERF_SQL_COUNT: "1", VERCEL_ENV: "preview" }, { NESTO_PERF_SQL_COUNT: "1", APP_ENV: "production" }, { NESTO_PERF_SQL_COUNT: "1", APP_ENV: "staging" }, { NESTO_PERF_SQL_COUNT: "0" }];
    for (const env of cases) expect(perfStatementCountingEnabled(env), JSON.stringify(env)).toBe(statementCountingEnabled(env));
  });

  it("is off unless asked for, and never on a deployment", () => {
    expect(statementCountingEnabled({})).toBe(false);
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "true" })).toBe(false);
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "1" })).toBe(true);
    // A local production build (next start) is where the benchmark runs.
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "1", NODE_ENV: "production" })).toBe(true);
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "1", VERCEL: "1" })).toBe(false);
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "1", APP_ENV: "production" })).toBe(false);
    expect(statementCountingEnabled({ NESTO_PERF_SQL_COUNT: "1", APP_ENV: "Staging" })).toBe(false);
  });
});

type Operation = (input: { model?: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) => Promise<unknown>;

/** A stand-in for PrismaClient: records the query listener and the extension it is given. */
function standIn() {
  const hooks: { listener?: (event: { query: string; params: string; duration: number }) => void; operation?: Operation } = {};
  const client = {
    $on: (_event: string, listener: typeof hooks.listener) => {
      hooks.listener = listener;
    },
    $extends: (definition: { query: { $allOperations: Operation } }) => {
      hooks.operation = definition.query.$allOperations;
      return { $transaction: async (run: () => Promise<unknown>) => run() };
    },
  };
  withStatementProbe(client as never);
  return hooks as Required<typeof hooks>;
}

describe("the statement counter's log line (PS-21)", () => {
  it("credits a scope's statements and writes counts, never SQL, parameters or values", async () => {
    const hooks = standIn();
    const lines: StatementLogLine[] = [];
    setStatementLogSink((line) => lines.push(line));

    await runWithRequestScope(async () => {
      await hooks.operation({
        model: "Task",
        operation: "findMany",
        args: { where: { title: "Private title" } },
        query: async () => {
          hooks.listener({ query: 'SELECT "t"."title" FROM "tasks" WHERE "email" = $1', params: '["secret@example.com"]', duration: 3 });
          hooks.listener({ query: "COMMIT", params: "[]", duration: 1 });
          return [{ id: "a" }, { id: "b" }];
        },
      });
      await hooks.operation({ operation: "$queryRaw", args: {}, query: async () => [{ n: 1 }] });
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({ event: "perf.sql.request", evidence: "exact", operations: 2, statements: 2, transactionControl: 1, ambiguous: 0, rows: 3, raw: 1, byModel: { Task: 1, $queryRaw: 1 } });
    const text = JSON.stringify(line);
    for (const leaked of ["SELECT", "tasks", "secret", "Private", "email", "$1"]) expect(text).not.toContain(leaked);
  });

  it("counts a statement reported while two scopes overlap as ambiguous, not as either's", async () => {
    const hooks = standIn();
    const lines: StatementLogLine[] = [];
    setStatementLogSink((line) => lines.push(line));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = runWithRequestScope(() => hooks.operation({ model: "Task", operation: "findMany", args: {}, query: async () => (await gate, []) }));
    const second = runWithRequestScope(() =>
      hooks.operation({
        model: "Invoice",
        operation: "findMany",
        args: {},
        query: async () => {
          hooks.listener({ query: "SELECT 1", params: "[]", duration: 1 });
          release();
          return [];
        },
      }),
    );
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatchObject({ statements: 0, ambiguous: 1 });
  });
});

describe("task command latency keeps the outcome's class (AUD-07 §5, PS-21)", () => {
  afterEach(() => {
    resetMetrics();
    resetHistograms();
  });

  it("folds a refusal into its class and still counts the exact outcome", () => {
    expect(observeHistogram("task_mutation_ms", { command: "edit", outcome: "version_conflict" }, 40)).toBe(true);
    expect(observeHistogram("task_mutation_ms", { command: "edit", outcome: "refused" }, 20)).toBe(true);
    expect(observeHistogram("task_mutation_ms", { command: "edit", outcome: "committed" }, 300)).toBe(true);
    expect(observeHistogram("task_mutation_ms", { command: "edit", outcome: "retryable" }, 900)).toBe(true);
    const text = renderPrometheus();
    expect(text).toContain('task_mutation_ms_count{command="edit",outcome="rejected"} 2');
    expect(text).toContain('task_mutation_ms_count{command="edit",outcome="committed"} 1');
    expect(text).toContain('task_mutation_ms_count{command="edit",outcome="error"} 1');
    expect(text).not.toContain('task_mutation_ms_count{command="edit",outcome="version_conflict"}');
    expect(counterValue(Metric.TASK_MUTATION_OUTCOME, { command: "edit", outcome: "version_conflict" })).toBe(1);
    expect(counterValue(Metric.TASK_MUTATION_OUTCOME, { command: "edit", outcome: "refused" })).toBe(1);
  });

  it("still drops a value that is neither exported nor folded", () => {
    expect(observeHistogram("task_mutation_ms", { command: "edit", outcome: "exploded" as "committed" }, 10)).toBe(false);
    expect(observeHistogram("task_mutation_ms", { command: "edit", outcome: "toString" as "committed" }, 10)).toBe(false);
    expect(counterValue(Metric.TASK_MUTATION_OUTCOME, { command: "edit", outcome: "exploded" })).toBe(0);
  });

  it("is 32 label sets, and every family fits the 4,000-series budget", () => {
    expect(histogramSeriesBudget("task_mutation_ms")).toBe(8 * 4 * 17);
    const total = (Object.keys(HISTOGRAMS) as HistogramName[]).reduce((sum, name) => sum + histogramSeriesBudget(name), 0);
    expect(total).toBeLessThanOrEqual(4_000);
  });
});

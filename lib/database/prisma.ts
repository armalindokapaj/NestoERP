import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * A single Prisma client per process. Next.js hot-reloads modules in dev, so the
 * client is cached on globalThis to avoid exhausting database connections.
 */
/**
 * On Vercel the Supabase integration provides `POSTGRES_PRISMA_URL` (pooled,
 * pgbouncer-aware). It is used when `DATABASE_URL` is not a Postgres URL, so a
 * mis-set project variable cannot take every request down.
 */
function resolveDatasourceUrl(): string | undefined {
  const configured = process.env.DATABASE_URL;
  const url = configured && /^postgres(ql)?:\/\//.test(configured) ? configured : process.env.POSTGRES_PRISMA_URL;
  return url ? withServerlessPool(url) : undefined;
}

/**
 * Prisma's default pool is `num_cpus * 2 + 1` — five on a Vercel function —
 * and a dashboard fans out more queries than that at once, so requests timed
 * out waiting for a connection. Behind the pooler a function can hold more.
 * Anything the URL already says wins.
 */
function withServerlessPool(url: string): string {
  if (!process.env.VERCEL) return url;
  const parsed = new URL(url);
  if (!parsed.searchParams.has("connection_limit")) parsed.searchParams.set("connection_limit", "20");
  if (!parsed.searchParams.has("pool_timeout")) parsed.searchParams.set("pool_timeout", "8"); // inside the 10 s client read deadline (AUD-07 §7)
  return parsed.toString();
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * One client, and so one connection pool, per process — in production too
 * (NAV-02 PAR-02). A production Next.js server loads this module once for its
 * pages and again for its route handlers; kept only in development, each copy
 * opened a pool of its own, and one instance held two pools' worth of
 * connections (measured: 43 against a pool of 21).
 */
export const prisma = globalForPrisma.prisma ?? createClient();

function createClient(): PrismaClient {
  const log: Prisma.LogLevel[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  // AUD-07 §5, PS-04: an opt-in, test/perf-only statement counter. Off unless
  // NESTO_PERF_SQL_COUNT=1, and never on a deployment; off, the client is the plain one.
  if (!perfStatementCountingEnabled()) return new PrismaClient({ datasourceUrl: resolveDatasourceUrl(), log });
  const client = new PrismaClient({
    datasourceUrl: resolveDatasourceUrl(),
    log: [...log.map((level) => ({ emit: "stdout" as const, level })), { emit: "event" as const, level: "query" as const }],
  });
  return withStatementProbe(client);
}

/**
 * Whether this process counts statements (AUD-07 PS-04): `NESTO_PERF_SQL_COUNT=1`,
 * and never on Vercel or where APP_ENV says production or staging. The same
 * rule as `statementCountingEnabled` in lib/core/observability/statement-counter.ts,
 * which the tests hold to this one; stated here because the database layer
 * does not import observability (the domain-cycle gate).
 */
export function perfStatementCountingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NESTO_PERF_SQL_COUNT !== "1" || env.VERCEL === "1" || env.VERCEL_ENV) return false;
  const app = env.APP_ENV?.toLowerCase();
  return app !== "production" && app !== "staging";
}

/**
 * What the counter needs from the client, published by
 * lib/core/observability/statement-counter.ts on `globalThis` when it loads:
 * the client only reports, and the counter decides what a report belongs to.
 * Until it has loaded, a report goes nowhere.
 */
export type StatementProbe = {
  begin(model: string | undefined, operation: string): unknown;
  end(token: unknown, result: unknown): void;
  hold(): unknown;
  release(token: unknown): void;
  statement(event: { query: string; duration: number }): void;
};

const probe = () => (globalThis as unknown as { __nestoStatementProbe?: StatementProbe }).__nestoStatementProbe;

/** The client with every call, interactive transaction and engine-reported statement passed to the probe. */
export function withStatementProbe(client: PrismaClient): PrismaClient {
  (client as unknown as { $on(event: "query", listener: (event: Prisma.QueryEvent) => void): void }).$on("query", (event) => probe()?.statement(event));
  const extended = client.$extends({
    name: "aud07-statement-probe",
    query: {
      async $allOperations({ model, operation, args, query }) {
        const token = probe()?.begin(model, operation);
        let result: unknown;
        try {
          result = await query(args);
          return result;
        } finally {
          if (token !== undefined) probe()?.end(token, result);
        }
      },
    },
  });
  // An interactive transaction's BEGIN and COMMIT run outside any one call: the
  // caller holds the database for the transaction's whole life, so they are its.
  const transaction = (extended as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> }).$transaction;
  return new Proxy(extended, {
    get(target, property) {
      if (property !== "$transaction") return Reflect.get(target, property);
      return async (...args: unknown[]) => {
        const token = probe()?.hold();
        try {
          return await transaction.apply(target, args);
        } finally {
          if (token !== undefined) probe()?.release(token);
        }
      };
    },
  }) as unknown as PrismaClient;
}

globalForPrisma.prisma = prisma;

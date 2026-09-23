import { PrismaClient } from "@prisma/client";

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
  if (!parsed.searchParams.has("pool_timeout")) parsed.searchParams.set("pool_timeout", "30");
  return parsed.toString();
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: resolveDatasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

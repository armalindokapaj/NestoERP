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
  if (configured && /^postgres(ql)?:\/\//.test(configured)) return undefined;
  return process.env.POSTGRES_PRISMA_URL || undefined;
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

/**
 * Which database a schema or data tool is about to touch, and whether it may
 * (AUD-12 §5).
 *
 * Every destructive database command — a reset, a `migrate dev`, a
 * `db push`, the drift check's shadow database, the demo seed — asks here
 * before it starts, not inside a later step when the damage is already done.
 *
 * The rules:
 * - **Destructive commands run only against a disposable database**: on this
 *   machine (localhost, 127.0.0.1, ::1 or a Unix socket), named in
 *   `NESTO_DISPOSABLE_DATABASES`, and never while the environment says
 *   production or staging. An environment label alone never makes a target
 *   safe: a remote database is refused whatever the label.
 * - **The shadow database is disposable and distinct.** Prisma drops and
 *   rebuilds it, so `SHADOW_DATABASE_URL` must be local, marked disposable,
 *   and not any database the application reads or writes — compared after
 *   normalising host aliases, ports and schemas, and again by asking each
 *   server which database it is. The drift check then never hands Prisma that
 *   database itself: it creates a new, empty one beside it for the run and
 *   drops it afterwards (`scripts/db/drift.ts`).
 * - **A demo seed is bound to a named target**: a remote database is seeded
 *   only when `NESTO_SEED_TARGET` names exactly that database. A stray flag on
 *   another deployment seeds nothing.
 *
 * Messages name the host and database, never a user or password.
 */

export type DbTarget = {
  /** Normalised host: every loopback spelling becomes `localhost`. */
  host: string;
  port: number;
  database: string;
  schema: string;
  /** On this machine: loopback or a Unix socket. */
  local: boolean;
  /** Host, port, database and schema: two URLs with one key are one target. */
  key: string;
  /** For messages: no credentials. */
  label: string;
};

type Env = Record<string, string | undefined>;

export type Verdict = { ok: true } | { ok: false; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "localhost.localdomain"]);

/** Parses a PostgreSQL URL. Throws with a credential-free message when it is not one. */
export function parseTarget(url: string): DbTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The database URL cannot be read as a URL.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`Only PostgreSQL URLs are understood here (got ${parsed.protocol.replace(/:$/, "")}).`);
  }
  // A Unix socket is given as `?host=/path` with an empty or localhost host.
  const socket = parsed.searchParams.get("host");
  const rawHost = decodeURIComponent(parsed.hostname).toLowerCase();
  const local = LOOPBACK.has(rawHost) || rawHost === "" || Boolean(socket?.startsWith("/"));
  const host = local ? "localhost" : rawHost;
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
  const schema = parsed.searchParams.get("schema") || "public";
  return {
    host,
    port,
    database,
    schema,
    local,
    key: `${host}:${port}/${database}?schema=${schema}`,
    label: `database "${database}" on ${local ? "this machine" : host}${port === 5432 ? "" : `:${port}`}`,
  };
}

export function sameTarget(a: DbTarget, b: DbTarget): boolean {
  return a.key === b.key;
}

/** The deployment this process believes it is in. `APP_ENV` first, then Vercel's, then Node's. */
export function environmentOf(env: Env): string {
  const app = env.APP_ENV?.toLowerCase();
  if (app) return app;
  const vercel = env.VERCEL_ENV?.toLowerCase();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "staging";
  return env.NODE_ENV?.toLowerCase() || "development";
}

function isProtectedEnvironment(env: Env): boolean {
  const environment = environmentOf(env);
  return environment === "production" || environment === "staging" || env.VERCEL_ENV === "production";
}

/** The databases the operator has declared disposable, by name. */
export function disposableDatabases(env: Env): Set<string> {
  return new Set(
    (env.NESTO_DISPOSABLE_DATABASES ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

/** Whether a destructive command (reset, migrate dev, db push) may run against `target`. */
export function checkDestructiveTarget(target: DbTarget, env: Env): Verdict {
  if (isProtectedEnvironment(env)) {
    return { ok: false, reason: `the environment is ${environmentOf(env)}; destructive database commands never run there.` };
  }
  if (!target.local) {
    return { ok: false, reason: `${target.label} is not on this machine. Destructive commands run only against a local disposable database.` };
  }
  if (!disposableDatabases(env).has(target.database)) {
    return {
      ok: false,
      reason: `${target.label} is not marked disposable. Add "${target.database}" to NESTO_DISPOSABLE_DATABASES only if everything in it may be lost.`,
    };
  }
  return { ok: true };
}

/**
 * Whether `shadow` may serve as Prisma's shadow database, given every URL the
 * application uses. The emptiness and server-identity checks need a
 * connection: see `probeShadow`.
 */
export function checkShadowTarget(shadow: DbTarget, applicationTargets: DbTarget[], env: Env): Verdict {
  const same = applicationTargets.find((target) => sameTarget(target, shadow) || (target.host === shadow.host && target.port === shadow.port && target.database === shadow.database));
  if (same) {
    return { ok: false, reason: `the shadow database is ${same.label}, which the application uses. Prisma drops everything in its shadow database.` };
  }
  if (!shadow.local) {
    return { ok: false, reason: `the shadow ${shadow.label} is not on this machine. Use a local, disposable database.` };
  }
  if (!disposableDatabases(env).has(shadow.database)) {
    return { ok: false, reason: `the shadow ${shadow.label} is not marked disposable in NESTO_DISPOSABLE_DATABASES.` };
  }
  return { ok: true };
}

/**
 * Whether a demo seed may write to `target`: never in production or staging;
 * on this machine freely; anywhere else only when `NESTO_SEED_TARGET` names
 * this exact database (`host/database`).
 */
export function checkSeedTarget(target: DbTarget, env: Env): Verdict {
  if (environmentOf(env) === "production" || environmentOf(env) === "staging") {
    return { ok: false, reason: `the environment is ${environmentOf(env)}; demo data never goes there.` };
  }
  if (target.local) return { ok: true };
  const named = env.NESTO_SEED_TARGET?.trim().toLowerCase();
  if (named && named === `${target.host}/${target.database}`.toLowerCase()) return { ok: true };
  return {
    ok: false,
    reason: `${target.label} is not this machine and is not the seed target. Set NESTO_SEED_TARGET="${target.host}/${target.database}" on the one deployment that may hold demo data.`,
  };
}

/** Every URL the application may read or write, as targets. Unparseable ones are skipped. */
export function applicationTargets(env: Env): DbTarget[] {
  const urls = [env.DATABASE_URL, env.DIRECT_URL, env.POSTGRES_URL_NON_POOLING, env.POSTGRES_PRISMA_URL, env.POSTGRES_URL];
  const targets: DbTarget[] = [];
  for (const url of urls) {
    if (!url) continue;
    try {
      targets.push(parseTarget(url));
    } catch {
      // Not a PostgreSQL URL: nothing to compare.
    }
  }
  return targets;
}

export type ServerIdentity = { database: string; address: string | null; port: number | null; system: string | null };

type Probe = {
  identity(url: string): Promise<ServerIdentity>;
  tableCount(url: string): Promise<number>;
};

/** Asks a server which database a URL really reaches: aliases resolve to the same answer. */
export const postgresProbe: Probe = {
  async identity(url) {
    const client = await connect(url);
    try {
      const rows = await client.$queryRawUnsafe<{ database: string; address: string | null; port: number | null }[]>(
        "select current_database() as database, host(inet_server_addr()) as address, inet_server_port() as port",
      );
      let system: string | null = null;
      try {
        const control = await client.$queryRawUnsafe<{ system: string }[]>("select system_identifier::text as system from pg_control_system()");
        system = control[0]?.system ?? null;
      } catch {
        // Not every role may read the control data; the address and port still compare.
      }
      return { ...rows[0]!, system };
    } finally {
      await client.$disconnect();
    }
  },
  async tableCount(url) {
    const client = await connect(url);
    try {
      const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(
        "select count(*) as count from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')",
      );
      return Number(rows[0]?.count ?? 0);
    } finally {
      await client.$disconnect();
    }
  },
};

async function connect(url: string) {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

function sameServerDatabase(a: ServerIdentity, b: ServerIdentity): boolean {
  if (a.database !== b.database) return false;
  if (a.system && b.system) return a.system === b.system;
  return a.address === b.address && a.port === b.port;
}

/**
 * The check that needs a connection: the shadow URL does not reach any
 * application database under another name (a host alias, another port
 * forward).
 */
export async function probeDistinct(shadowUrl: string, applicationUrls: string[], probe: Probe = postgresProbe): Promise<Verdict> {
  const shadow = await probe.identity(shadowUrl);
  for (const url of applicationUrls) {
    let application: ServerIdentity;
    try {
      application = await probe.identity(url);
    } catch {
      // An application database that cannot be reached cannot be the shadow's server either.
      continue;
    }
    if (sameServerDatabase(shadow, application)) {
      return { ok: false, reason: `the shadow URL reaches database "${shadow.database}", the same database as an application URL under another name.` };
    }
  }
  return { ok: true };
}

/** Replaces the database in a URL, keeping credentials, host and parameters. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

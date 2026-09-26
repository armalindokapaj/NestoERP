#!/usr/bin/env bash
# Vercel production build: migrate, optionally seed, build, then trim routes.
#
# DATABASE WRITES (AUD-12 §5) — this build writes to the deployment's database:
#   1. `prisma migrate deploy`: applies pending migrations. Always. It never
#      resets, pushes or seeds, and it refuses on a failed migration.
#   2. The demo seed: only when ALL of these hold, checked before it starts:
#      - NESTO_SEED_ON_BUILD=1 (the opt-in);
#      - NESTO_SEED_TARGET names this database as "host/database" (a flag
#        copied to another deployment names the wrong database and seeds
#        nothing);
#      - the environment is not production or staging (APP_ENV, else
#        VERCEL_ENV): a hosted demo sets APP_ENV=demo;
#      - the database has no users yet (an extra check, never the only one).
#      The seed's own guard (prisma/seed/guard.ts) repeats the environment and
#      target checks.
#   Nothing else here writes to a database.
#
# Migrations and the seed go over the integration's non-pooling URL, because
# `migrate deploy` needs a session connection that pgbouncer cannot give.
set -euo pipefail

direct_url="${POSTGRES_URL_NON_POOLING:-${DATABASE_URL:-}}"

DATABASE_URL="$direct_url" npx prisma migrate deploy

if [ "${NESTO_SEED_ON_BUILD:-}" = "1" ]; then
  eligible=$(DATABASE_URL="$direct_url" npx tsx -e '
    import { checkSeedTarget, parseTarget } from "./lib/core/database/target";
    const target = parseTarget(process.env.DATABASE_URL ?? "");
    const named = (process.env.NESTO_SEED_TARGET ?? "").trim().toLowerCase();
    const verdict = checkSeedTarget(target, process.env);
    if (!named) console.log("NESTO_SEED_TARGET is not set");
    else if (named !== `${target.host}/${target.database}`.toLowerCase()) console.log("NESTO_SEED_TARGET names another database");
    else if (!verdict.ok) console.log(verdict.reason);
    else console.log("yes");
  ')
  if [ "$eligible" != "yes" ]; then
    echo "vercel-build: demo seed skipped: $eligible"
  else
    users=$(DATABASE_URL="$direct_url" node -e '
      const { PrismaClient } = require("@prisma/client");
      const p = new PrismaClient();
      p.user.count().then((n) => { console.log(n); return p.$disconnect(); });
    ')
    if [ "$users" = "0" ]; then
      DATABASE_URL="$direct_url" ALLOW_DEMO_SEED=true npx prisma db seed
    else
      echo "vercel-build: $users users present, seed skipped"
    fi
  fi
fi

NODE_OPTIONS=--max-old-space-size=6144 npx next build --turbopack
node scripts/vercel-app-type.mjs

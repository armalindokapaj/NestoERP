#!/usr/bin/env bash
# Vercel production build: migrate, optionally seed, build, then trim routes.
#
# Migrations and the seed go over the integration's non-pooling URL, because
# `migrate deploy` needs a session connection that pgbouncer cannot give.
# The demo seed runs only when NESTO_SEED_ON_BUILD=1 and the database has no
# users yet, so leaving the flag set can never reseed a live database.
set -euo pipefail

direct_url="${POSTGRES_URL_NON_POOLING:-${DATABASE_URL:-}}"

DATABASE_URL="$direct_url" npx prisma migrate deploy

if [ "${NESTO_SEED_ON_BUILD:-}" = "1" ]; then
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

NODE_OPTIONS=--max-old-space-size=6144 npx next build --turbopack
node scripts/vercel-app-type.mjs

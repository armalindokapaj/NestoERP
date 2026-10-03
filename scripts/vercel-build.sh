#!/usr/bin/env bash
# Vercel production build: migrate, sync access configuration, build, then trim routes.
#
# DATABASE WRITES (AUD-12 §5) — this build writes to the deployment's database:
#   1. `prisma migrate deploy`: applies pending migrations. Always. It never
#      resets, pushes or seeds, and it refuses on a failed migration.
#   2. `scripts/access-sync.ts`: rewrites roles, permissions, modules and the
#      role matrix from config/. Always. Configuration only, no business data.
#   Nothing else here writes to a database. No demo or sample data is ever
#   seeded on a build.
#
# Migrations and the sync go over the integration's non-pooling URL, because
# `migrate deploy` needs a session connection that pgbouncer cannot give.
set -euo pipefail

direct_url="${POSTGRES_URL_NON_POOLING:-${DATABASE_URL:-}}"

DATABASE_URL="$direct_url" npx prisma migrate deploy

# Access configuration (roles, permissions, modules and the role matrix) comes
# from config/, not from migrations, so every deploy brings the database level
# with the code. Idempotent; touches no company, person or business record.
DATABASE_URL="$direct_url" npx tsx scripts/access-sync.ts

NODE_OPTIONS=--max-old-space-size=6144 npx next build --turbopack
node scripts/vercel-app-type.mjs

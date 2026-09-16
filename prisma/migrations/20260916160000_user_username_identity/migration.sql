-- PRD #50 §6, §7, §16, §66, §67 — username becomes the login identifier and
-- email becomes optional contact metadata.
--
-- Written expand-and-contract (PRD #50 §127) because `ADD COLUMN username TEXT
-- NOT NULL` would fail against any row that already exists: the column arrives
-- nullable, is backfilled, and only then becomes required and unique.

-- 1. The new columns. `username` is nullable for the moment.
ALTER TABLE "users"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);

-- 2. Backfill from the address people already sign in with, so nobody has to
--    be told a new name they did not choose. The local part is lowercased and
--    anything outside the permitted set becomes a dot, matching the
--    normalisation the application applies from here on.
UPDATE "users"
   SET "username" = regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]+', '.', 'g')
 WHERE "username" IS NULL;

-- 3. Two addresses can share a local part across domains. Whoever was created
--    first keeps the plain name; the rest are numbered, deterministically by
--    creation order so a re-run lands the same way.
WITH ranked AS (
  SELECT "id",
         "username",
         row_number() OVER (PARTITION BY "username" ORDER BY "createdAt", "id") AS position
    FROM "users"
)
UPDATE "users" AS u
   SET "username" = ranked."username" || (ranked.position)::text
  FROM ranked
 WHERE u."id" = ranked."id"
   AND ranked.position > 1;

-- 4. A row with no address at all still needs a name it can sign in with.
UPDATE "users"
   SET "username" = 'user.' || lower("id")
 WHERE "username" IS NULL OR "username" = '';

-- 5. Now it can be required and unique.
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- 6. Email stops being required. The unique index stays: Postgres allows many
--    NULLs under one, so "at most one account per address" still holds for the
--    accounts that have one.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

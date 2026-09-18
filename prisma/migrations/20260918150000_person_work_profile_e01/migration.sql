-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "taxNumber" TEXT;

-- AlterTable
ALTER TABLE "person_profiles" ADD COLUMN     "officeLocation" TEXT,
ADD COLUMN     "professionalBio" TEXT,
ADD COLUMN     "workPhoneExtension" TEXT;


-- Backfill (E-01 §219, ADR 0002): every login that works in a group has a person
-- there. Re-runnable: it only touches logins with no person yet.
--
-- 1. A login whose group already holds an unlinked person with its email is that
--    person: link them, one login to one person.
WITH matches AS (
  SELECT u.id AS user_id,
         p.id AS person_id,
         row_number() OVER (PARTITION BY u.id ORDER BY cm."createdAt", p."createdAt") AS by_user,
         row_number() OVER (PARTITION BY p.id ORDER BY u."createdAt", cm."createdAt") AS by_person
  FROM "users" u
  JOIN "company_members" cm ON cm."userId" = u.id AND cm."status" = 'ACTIVE'
  JOIN "companies" c ON c.id = cm."companyId"
  JOIN "person_profiles" p ON p."parentGroupId" = c."parentGroupId" AND lower(p."workEmail") = lower(u."email")
  WHERE u."personProfileId" IS NULL
    AND u."email" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "users" linked WHERE linked."personProfileId" = p.id)
)
UPDATE "users" u
SET "personProfileId" = m.person_id
FROM matches m
WHERE u.id = m.user_id AND m.by_user = 1 AND m.by_person = 1 AND u."personProfileId" IS NULL;

-- 2. Everyone else gets a person made from the account, in the group of their
--    oldest active membership, as `personForMember` has always made one lazily.
INSERT INTO "person_profiles" ("id", "parentGroupId", "firstName", "lastName", "jobTitle", "workEmail", "workPhone", "lifecycleStatus", "createdAt", "updatedAt")
SELECT DISTINCT ON (u.id)
       'person_e01_' || md5(u.id),
       c."parentGroupId",
       u."firstName",
       u."lastName",
       cm."jobTitle",
       u."email",
       u."phone",
       'EMPLOYEE'::"PersonLifecycleStatus",
       now(),
       now()
FROM "users" u
JOIN "company_members" cm ON cm."userId" = u.id AND cm."status" = 'ACTIVE'
JOIN "companies" c ON c.id = cm."companyId"
WHERE u."personProfileId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "person_profiles" existing WHERE existing.id = 'person_e01_' || md5(u.id))
ORDER BY u.id, cm."createdAt";

UPDATE "users" u
SET "personProfileId" = 'person_e01_' || md5(u.id)
WHERE u."personProfileId" IS NULL
  AND EXISTS (SELECT 1 FROM "person_profiles" p WHERE p.id = 'person_e01_' || md5(u.id));

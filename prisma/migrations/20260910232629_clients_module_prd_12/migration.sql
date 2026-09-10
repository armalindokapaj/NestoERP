-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "preArchiveStatus" "ClientStatus";

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "preArchiveStatus" "ContactStatus";

-- CreateIndex
CREATE INDEX "clients_companyId_updatedAt_idx" ON "clients"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "clients_companyId_normalizedName_idx" ON "clients"("companyId", "normalizedName");

-- CreateIndex
CREATE INDEX "clients_email_idx" ON "clients"("email");

-- CreateIndex
CREATE INDEX "clients_country_idx" ON "clients"("country");

-- CreateIndex
CREATE INDEX "contacts_companyId_clientId_status_idx" ON "contacts"("companyId", "clientId", "status");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- Backfill the comparison key for clients that already exist, using the same
-- normalisation the service applies: lower-cased, punctuation folded to spaces
-- and whitespace collapsed (PRD #12 §55).
UPDATE "clients"
SET "normalizedName" = btrim(
  regexp_replace(
    regexp_replace(lower("name"), '[.,''"“”&()]', ' ', 'g'),
    '\s+', ' ', 'g'
  )
);

-- A client may hold at most one primary contact. Prisma cannot express a
-- partial unique index, so it is written here — the service switches the flag
-- inside a transaction, and this is what makes two simultaneous promotions
-- impossible rather than merely unlikely (PRD #12 §83, §85, §164).
CREATE UNIQUE INDEX "contacts_one_primary_per_client"
ON "contacts" ("clientId")
WHERE "isPrimary" = true AND "archivedAt" IS NULL;

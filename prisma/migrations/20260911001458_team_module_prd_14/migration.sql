-- CreateEnum
CREATE TYPE "CompanyInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "company_members" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedByMemberId" TEXT,
ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "invitedByMemberId" TEXT,
ADD COLUMN     "joinedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "archivedBy" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "preArchiveStatus" "DepartmentStatus",
ADD COLUMN     "updatedBy" TEXT;

-- CreateTable
CREATE TABLE "company_invites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "companyMemberId" TEXT,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "jobTitle" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "CompanyInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_invites_tokenHash_key" ON "company_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "company_invites_companyId_idx" ON "company_invites"("companyId");

-- CreateIndex
CREATE INDEX "company_invites_companyId_status_idx" ON "company_invites"("companyId", "status");

-- CreateIndex
CREATE INDEX "company_invites_companyId_email_idx" ON "company_invites"("companyId", "email");

-- CreateIndex
CREATE INDEX "company_invites_email_idx" ON "company_invites"("email");

-- CreateIndex
CREATE INDEX "company_invites_expiresAt_idx" ON "company_invites"("expiresAt");

-- CreateIndex
CREATE INDEX "company_invites_companyMemberId_idx" ON "company_invites"("companyMemberId");

-- CreateIndex
CREATE INDEX "company_members_companyId_status_idx" ON "company_members"("companyId", "status");

-- CreateIndex
CREATE INDEX "company_members_companyId_departmentId_idx" ON "company_members"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "company_members_companyId_roleId_idx" ON "company_members"("companyId", "roleId");

-- CreateIndex
CREATE INDEX "departments_companyId_status_idx" ON "departments"("companyId", "status");

-- AddForeignKey
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing memberships predate the lifecycle columns. Their creation date is
-- the only honest answer to "when did they join", so it is the one used
-- (PRD #14 §12). Nothing is invented for invitedAt or deactivatedAt: an
-- unknown date stays null rather than becoming a plausible-looking lie.
UPDATE "company_members"
SET "joinedAt" = "createdAt"
WHERE "joinedAt" IS NULL AND "status" = 'ACTIVE';

-- One live invitation per address per company (PRD #14 §79, §136).
--
-- The service already retires a stale pending invite before issuing a new one;
-- this is the same rule stated where two concurrent invitations would actually
-- race. Prisma cannot express a partial index, so it is written here by hand.
CREATE UNIQUE INDEX "company_invites_one_pending_per_email"
ON "company_invites" ("companyId", "email")
WHERE "status" = 'PENDING';

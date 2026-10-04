-- Company access policy of a group seat (PRD #10): NONE, ALL or SELECTED, with
-- the selected companies as relational rows. company_members.groupDerived marks
-- the rows a seat's policy owns, so a policy change never touches a direct membership.
-- CreateEnum
CREATE TYPE "CompanyAccessMode" AS ENUM ('NONE', 'ALL', 'SELECTED');

-- AlterTable
ALTER TABLE "company_members" ADD COLUMN     "groupDerived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "parent_group_members" ADD COLUMN     "accessVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "companyAccessMode" "CompanyAccessMode" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "parent_group_member_companies" (
    "id" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_group_member_companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parent_group_member_companies_companyId_idx" ON "parent_group_member_companies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_group_member_companies_seatId_companyId_key" ON "parent_group_member_companies"("seatId", "companyId");

-- AddForeignKey
ALTER TABLE "parent_group_member_companies" ADD CONSTRAINT "parent_group_member_companies_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "parent_group_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_group_member_companies" ADD CONSTRAINT "parent_group_member_companies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "parent_group_member_companies" ENABLE ROW LEVEL SECURITY;

-- Seats that exist today reach every company of their group through memberships
-- of the seat's role: that is ALL, and those memberships are the policy's.
UPDATE "parent_group_members" SET "companyAccessMode" = 'ALL' WHERE "roleId" IS NOT NULL;

UPDATE "company_members" AS member
SET "groupDerived" = true
FROM "parent_group_members" AS seat, "companies" AS company
WHERE seat."roleId" IS NOT NULL
  AND member."userId" = seat."userId"
  AND member."roleId" = seat."roleId"
  AND company."id" = member."companyId"
  AND company."parentGroupId" = seat."parentGroupId";

-- The company's one CEO (PRD #12): a unique pointer to the direct membership that
-- holds the CEO role. Existing companies with exactly one active, direct CEO
-- membership are pointed at it; anything ambiguous is left unassigned.
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "ceoMemberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "companies_ceoMemberId_key" ON "companies"("ceoMemberId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ceoMemberId_fkey" FOREIGN KEY ("ceoMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill
UPDATE "companies" c SET "ceoMemberId" = m.id
FROM (
  SELECT cm."companyId", MIN(cm.id) AS id
  FROM "company_members" cm
  JOIN "roles" r ON r.id = cm."roleId" AND r."key" = 'CEO'
  WHERE cm."status" = 'ACTIVE' AND cm."archivedAt" IS NULL AND cm."groupDerived" = false
  GROUP BY cm."companyId"
  HAVING COUNT(*) = 1
) m
WHERE c.id = m."companyId";

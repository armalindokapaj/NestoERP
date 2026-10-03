-- AlterEnum
ALTER TYPE "CompanyStatus" ADD VALUE 'DELETED';

-- AlterEnum
ALTER TYPE "ParentGroupStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletedWithGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purgeAfter" TIMESTAMP(3),
ADD COLUMN     "statusBeforeDelete" "CompanyStatus";

-- AlterTable
ALTER TABLE "parent_groups" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "purgeAfter" TIMESTAMP(3),
ADD COLUMN     "statusBeforeDelete" "ParentGroupStatus";


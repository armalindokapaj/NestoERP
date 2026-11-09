-- AlterTable
ALTER TABLE "company_members" ADD COLUMN     "ceoAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ceoAccessGrantedAt" TIMESTAMP(3),
ADD COLUMN     "ceoAccessGrantedByMemberId" TEXT;


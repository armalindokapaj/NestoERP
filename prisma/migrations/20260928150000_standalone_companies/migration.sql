-- CreateEnum
CREATE TYPE "ParentGroupKind" AS ENUM ('GROUP', 'STANDALONE');

-- AlterTable
ALTER TABLE "parent_groups" ADD COLUMN "kind" "ParentGroupKind" NOT NULL DEFAULT 'GROUP';

-- CreateIndex
CREATE INDEX "parent_groups_kind_idx" ON "parent_groups"("kind");

-- Attaching a company to a group, or detaching it, moves the company and its
-- root's rows in one transaction. The composite (id, parentGroupId) keys point
-- in both directions between those rows, so their checks wait for the commit
-- inside that transaction (SET CONSTRAINTS ... DEFERRED). Everywhere else they
-- stay immediate.
ALTER TABLE "department_assignments" ALTER CONSTRAINT "department_assignments_companyId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "department_assignments" ALTER CONSTRAINT "department_assignments_groupDepartmentId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "candidate_profiles" ALTER CONSTRAINT "candidate_profiles_targetCompanyId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "candidate_profiles" ALTER CONSTRAINT "candidate_profiles_personProfileId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "user_provisioning_requests" ALTER CONSTRAINT "user_provisioning_requests_personProfileId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "user_provisioning_requests" ALTER CONSTRAINT "user_provisioning_requests_companyId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "person_qualifications" ALTER CONSTRAINT "person_qualifications_companyId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "person_qualifications" ALTER CONSTRAINT "person_qualifications_personProfileId_parentGroupId_fkey" DEFERRABLE INITIALLY IMMEDIATE;

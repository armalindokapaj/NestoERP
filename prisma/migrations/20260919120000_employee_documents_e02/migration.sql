-- E-02: Employee documents and qualifications (ADR 0007).
--
-- Additive. Two tables — what HR files a document on an employment as, and a
-- person's qualifications — and a provider identity on documents for a later
-- OneDrive/SharePoint integration (nothing writes it yet). Every employee
-- document already on file gets its link, so no file changes hands and no file
-- is copied (E-02 §2, §12).
--
-- Rollback: release-readiness §29.

-- CreateEnum
CREATE TYPE "EmployeeDocumentCategory" AS ENUM ('EMPLOYMENT_CONTRACT', 'CONTRACT_AMENDMENT', 'EMPLOYMENT_LETTER', 'POSITION_CHANGE', 'SALARY_CHANGE_DOCUMENT', 'SALARY_HISTORY_DOCUMENT', 'COMPENSATION_STATEMENT', 'DIPLOMA', 'DEGREE', 'TRANSCRIPT', 'PROFESSIONAL_CERTIFICATE', 'SKILLS_CERTIFICATE', 'PROFESSIONAL_LICENSE', 'SAFETY_CERTIFICATE', 'TRAINING_CERTIFICATE', 'LANGUAGE_CERTIFICATE', 'DRIVING_LICENSE', 'EQUIPMENT_LICENSE', 'WORK_PERMIT', 'CV', 'IDENTITY_DOCUMENT', 'OTHER_HR', 'OTHER_PROFESSIONAL');

-- CreateEnum
CREATE TYPE "EmployeeDocumentVisibility" AS ENUM ('PRIVATE_EMPLOYEE', 'EMPLOYEE_AND_HR', 'HR_ONLY', 'EMPLOYEE_HR_FINANCE', 'RESTRICTED_MANAGEMENT', 'GROUP_SUMMARY');

-- CreateEnum
CREATE TYPE "CredentialVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QualificationType" AS ENUM ('SKILL', 'DIPLOMA', 'DEGREE', 'PROFESSIONAL_CERTIFICATE', 'SKILLS_CERTIFICATE', 'PROFESSIONAL_LICENSE', 'SAFETY_CERTIFICATE', 'TRAINING_CERTIFICATE', 'LANGUAGE_CERTIFICATE', 'DRIVING_LICENSE', 'EQUIPMENT_LICENSE', 'WORK_PERMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "SkillProficiency" AS ENUM ('BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "QualificationVisibility" AS ENUM ('PRIVATE', 'EMPLOYEE_AND_HR', 'HR_ONLY', 'GROUP_SUMMARY', 'RESTRICTED');

-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "externalVersionId" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "etag" TEXT,
ADD COLUMN     "externalDriveId" TEXT,
ADD COLUMN     "externalItemId" TEXT,
ADD COLUMN     "externalParentId" TEXT,
ADD COLUMN     "externalProvider" TEXT,
ADD COLUMN     "externalVersionId" TEXT,
ADD COLUMN     "lastProviderSyncAt" TIMESTAMP(3),
ADD COLUMN     "providerPath" TEXT,
ADD COLUMN     "webUrl" TEXT;

-- CreateTable
CREATE TABLE "employee_document_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "category" "EmployeeDocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" "EmployeeDocumentVisibility" NOT NULL,
    "verificationStatus" "CredentialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "issuer" TEXT,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersededById" TEXT,
    "amendsId" TEXT,
    "verifiedByMemberId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "verifiedDocumentVersionId" TEXT,
    "createdByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedByMemberId" TEXT,
    "archiveReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_qualifications" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "personProfileId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "QualificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "documentNumber" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "proficiency" "SkillProficiency",
    "verificationStatus" "CredentialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "visibility" "QualificationVisibility" NOT NULL DEFAULT 'EMPLOYEE_AND_HR',
    "supportingDocumentId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersededById" TEXT,
    "verifiedByMemberId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "verifiedDocumentVersionId" TEXT,
    "createdByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedByMemberId" TEXT,
    "archiveReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_document_links_companyId_employeeProfileId_categor_idx" ON "employee_document_links"("companyId", "employeeProfileId", "category");

-- CreateIndex
CREATE INDEX "employee_document_links_companyId_verificationStatus_idx" ON "employee_document_links"("companyId", "verificationStatus");

-- CreateIndex
CREATE INDEX "employee_document_links_companyId_expiryDate_idx" ON "employee_document_links"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "employee_document_links_amendsId_idx" ON "employee_document_links"("amendsId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_document_links_id_companyId_key" ON "employee_document_links"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_document_links_documentId_companyId_key" ON "employee_document_links"("documentId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_document_links_id_employeeProfileId_key" ON "employee_document_links"("id", "employeeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_document_links_supersededById_employeeProfileId_key" ON "employee_document_links"("supersededById", "employeeProfileId");

-- CreateIndex
CREATE INDEX "person_qualifications_parentGroupId_personProfileId_idx" ON "person_qualifications"("parentGroupId", "personProfileId");

-- CreateIndex
CREATE INDEX "person_qualifications_companyId_verificationStatus_idx" ON "person_qualifications"("companyId", "verificationStatus");

-- CreateIndex
CREATE INDEX "person_qualifications_companyId_expiryDate_idx" ON "person_qualifications"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "person_qualifications_supportingDocumentId_idx" ON "person_qualifications"("supportingDocumentId");

-- CreateIndex
CREATE INDEX "person_qualifications_parentGroupId_type_verificationStatus_idx" ON "person_qualifications"("parentGroupId", "type", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "person_qualifications_id_personProfileId_key" ON "person_qualifications"("id", "personProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "person_qualifications_supersededById_personProfileId_key" ON "person_qualifications"("supersededById", "personProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_companyId_externalProvider_externalDriveId_extern_key" ON "documents"("companyId", "externalProvider", "externalDriveId", "externalItemId");

-- AddForeignKey
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_employeeProfileId_companyId_fkey" FOREIGN KEY ("employeeProfileId", "companyId") REFERENCES "employee_profiles"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_documentId_companyId_fkey" FOREIGN KEY ("documentId", "companyId") REFERENCES "documents"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_supersededById_employeeProfileId_fkey" FOREIGN KEY ("supersededById", "employeeProfileId") REFERENCES "employee_document_links"("id", "employeeProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_amendsId_employeeProfileId_fkey" FOREIGN KEY ("amendsId", "employeeProfileId") REFERENCES "employee_document_links"("id", "employeeProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_personProfileId_parentGroupId_fkey" FOREIGN KEY ("personProfileId", "parentGroupId") REFERENCES "person_profiles"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_companyId_parentGroupId_fkey" FOREIGN KEY ("companyId", "parentGroupId") REFERENCES "companies"("id", "parentGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_supportingDocumentId_companyId_fkey" FOREIGN KEY ("supportingDocumentId", "companyId") REFERENCES "documents"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_supersededById_personProfileId_fkey" FOREIGN KEY ("supersededById", "personProfileId") REFERENCES "person_qualifications"("id", "personProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants the schema language cannot say (E-02 §133).
-- ---------------------------------------------------------------------------

ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_expiry_check" CHECK ("expiryDate" IS NULL OR "issueDate" IS NULL OR "expiryDate" >= "issueDate");
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_effective_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" >= "effectiveFrom");
-- Replaced by itself would be a loop of one; an amendment does not amend itself.
ALTER TABLE "employee_document_links" ADD CONSTRAINT "employee_document_links_not_self_check" CHECK ("supersededById" IS DISTINCT FROM "id" AND "amendsId" IS DISTINCT FROM "id");
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_expiry_check" CHECK ("expiryDate" IS NULL OR "issueDate" IS NULL OR "expiryDate" >= "issueDate");
ALTER TABLE "person_qualifications" ADD CONSTRAINT "person_qualifications_not_self_check" CHECK ("supersededById" IS DISTINCT FROM "id");
-- An item is either both halves of an external identity or neither: a drive without an item names nothing.
ALTER TABLE "documents" ADD CONSTRAINT "documents_external_identity_check" CHECK (("externalProvider" IS NULL) = ("externalItemId" IS NULL));

-- ---------------------------------------------------------------------------
-- Data: every document already filed on an employment gets its link (E-02 §232,
-- E-02A). What it is was never recorded, so it is "Other HR document" — or
-- "Position change" where E-03 history already cites it — and it keeps the
-- reach it had: the employee and HR (EMPLOYEE_AND_HR). HR files it properly
-- from the employee's Documents tab. Deterministic ids; a rerun adds nothing.
-- ---------------------------------------------------------------------------

INSERT INTO "employee_document_links" (
    "id", "companyId", "employeeProfileId", "documentId", "category", "title", "visibility",
    "verificationStatus", "isCurrent", "createdByMemberId", "archivedAt", "archiveReason", "createdAt", "updatedAt"
)
SELECT
    'edl_' || substr(md5(d."id"), 1, 24),
    d."companyId",
    e."id",
    d."id",
    CASE
        WHEN EXISTS (SELECT 1 FROM "employment_changes" c WHERE c."sourceDocumentId" = d."id")
          OR EXISTS (SELECT 1 FROM "employment_assignments" a WHERE a."sourceDocumentId" = d."id")
          OR EXISTS (SELECT 1 FROM "employment_status_history" h WHERE h."sourceDocumentId" = d."id")
        THEN 'POSITION_CHANGE'::"EmployeeDocumentCategory"
        ELSE 'OTHER_HR'::"EmployeeDocumentCategory"
    END,
    d."name",
    'EMPLOYEE_AND_HR'::"EmployeeDocumentVisibility",
    'UNVERIFIED'::"CredentialVerificationStatus",
    true,
    d."uploadedByMemberId",
    CASE WHEN d."status" = 'ARCHIVED' THEN COALESCE(d."archivedAt", d."updatedAt") END,
    CASE WHEN d."status" = 'ARCHIVED' THEN 'Archived before employee documents were categorised' END,
    d."createdAt",
    now() AT TIME ZONE 'UTC'
FROM "documents" d
JOIN "employee_profiles" e ON e."id" = d."entityId" AND e."companyId" = d."companyId"
WHERE d."entityType" = 'employee'
  AND NOT EXISTS (SELECT 1 FROM "employee_document_links" l WHERE l."documentId" = d."id");

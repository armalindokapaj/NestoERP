-- Contractor management, engineering and legal integration (PRD #46).

-- CreateEnum
CREATE TYPE "ContractorStatus" AS ENUM ('PROSPECTIVE', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'OFFBOARDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractorContactRole" AS ENUM ('PROJECT_MANAGER', 'ENGINEER', 'SITE_ENGINEER', 'DOCUMENT_CONTROLLER', 'COMMERCIAL', 'LEGAL', 'HSE', 'QAQC', 'FINANCE', 'MANAGEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectContractorStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "WorkPackageStatus" AS ENUM ('PLANNED', 'ACTIVE', 'AT_RISK', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EngineeringDiscipline" AS ENUM ('GENERAL', 'ARCHITECTURE', 'STRUCTURAL', 'CIVIL', 'MECHANICAL', 'ELECTRICAL', 'PLUMBING', 'FIRE_PROTECTION', 'FACADE', 'INTERIORS', 'LANDSCAPE', 'INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractorComplianceType" AS ENUM ('INSURANCE', 'LICENSE', 'CERTIFICATION', 'PERFORMANCE_GUARANTEE', 'ADVANCE_PAYMENT_GUARANTEE', 'BOND', 'TAX_DOCUMENT', 'HSE_CERTIFICATION', 'QA_CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractorComplianceStatus" AS ENUM ('VALID', 'EXPIRING', 'EXPIRED', 'MISSING', 'WAIVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EngineeringDocumentType" AS ENUM ('DRAWING', 'SHOP_DRAWING', 'SPECIFICATION', 'CALCULATION', 'METHOD_STATEMENT', 'MATERIAL_SUBMITTAL', 'PRODUCT_DATA', 'AS_BUILT', 'TECHNICAL_REPORT', 'SAMPLE', 'OTHER');

-- CreateEnum
CREATE TYPE "EngineeringDocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_COMMENTS', 'REVISION_REQUIRED', 'REJECTED', 'SUPERSEDED', 'VOID');

-- CreateEnum
CREATE TYPE "EngineeringRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FINALIZED', 'SUPERSEDED', 'VOID');

-- CreateEnum
CREATE TYPE "EngineeringReviewDecision" AS ENUM ('APPROVED', 'APPROVED_WITH_COMMENTS', 'REVISION_REQUIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RfiStatus" AS ENUM ('DRAFT', 'OPEN', 'ANSWERED', 'CLARIFICATION_REQUIRED', 'CLOSED', 'VOID');

-- CreateEnum
CREATE TYPE "RfiPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RfiReferenceType" AS ENUM ('ENGINEERING_DOCUMENT', 'DRAWING', 'SUBMITTAL', 'MEETING', 'DAILY_LOG', 'TASK', 'DOCUMENT', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "TechnicalSubmittalType" AS ENUM ('SHOP_DRAWING', 'MATERIAL_SUBMITTAL', 'METHOD_STATEMENT', 'TECHNICAL_SUBMITTAL', 'SAMPLE', 'PRODUCT_DATA', 'CALCULATION', 'OTHER');

-- CreateEnum
CREATE TYPE "TechnicalSubmittalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_COMMENTS', 'REVISION_REQUIRED', 'REJECTED', 'CLOSED', 'VOID');

-- CreateEnum
CREATE TYPE "SubmittalRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FINALIZED', 'SUPERSEDED', 'VOID');

-- CreateEnum
CREATE TYPE "TransmittalDirection" AS ENUM ('OUTGOING', 'INCOMING', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TransmittalPurpose" AS ENUM ('FOR_INFORMATION', 'FOR_REVIEW', 'FOR_APPROVAL', 'FOR_CONSTRUCTION', 'AS_BUILT', 'OTHER');

-- CreateEnum
CREATE TYPE "TransmittalStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "DocumentSharingClassification" AS ENUM ('INTERNAL_ONLY', 'EXTERNAL_SHAREABLE', 'EXTERNAL_SHARED', 'CONTRACTOR_SUBMITTED');

-- AlterTable
ALTER TABLE "daily_log_work_activities" ADD COLUMN     "contractorId" TEXT,
ADD COLUMN     "workPackageId" TEXT;

-- AlterTable
ALTER TABLE "daily_log_workforce_entries" ADD COLUMN     "contractorId" TEXT,
ADD COLUMN     "workPackageId" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "sharingClassification" "DocumentSharingClassification" NOT NULL DEFAULT 'INTERNAL_ONLY';

-- CreateTable
CREATE TABLE "contractor_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "vatNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" VARCHAR(2),
    "status" "ContractorStatus" NOT NULL DEFAULT 'PROSPECTIVE',
    "statusChangedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "supplierId" TEXT,
    "primaryContactName" TEXT,
    "primaryContactEmail" TEXT,
    "primaryContactPhone" TEXT,
    "notes" TEXT,
    "normalizedName" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleTitle" TEXT,
    "contactRole" "ContractorContactRole",
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_contractor_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "status" "ProjectContractorStatus" NOT NULL DEFAULT 'PLANNED',
    "scopeSummary" TEXT,
    "contractId" TEXT,
    "internalManagerMemberId" TEXT,
    "primaryContractorContactId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "terminatedByMemberId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contractor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_packages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT,
    "projectContractorAssignmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discipline" "EngineeringDiscipline",
    "status" "WorkPackageStatus" NOT NULL DEFAULT 'PLANNED',
    "contractId" TEXT,
    "responsibleMemberId" TEXT,
    "plannedStartDate" TIMESTAMP(3),
    "plannedFinishDate" TIMESTAMP(3),
    "forecastStartDate" TIMESTAMP(3),
    "forecastFinishDate" TIMESTAMP(3),
    "actualStartDate" TIMESTAMP(3),
    "actualFinishDate" TIMESTAMP(3),
    "value" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "completedAt" TIMESTAMP(3),
    "completedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_compliance_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "type" "ContractorComplianceType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContractorComplianceStatus" NOT NULL DEFAULT 'VALID',
    "documentId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "issuer" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "waivedReason" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedByMemberId" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_compliance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workPackageId" TEXT,
    "contractorId" TEXT,
    "documentNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" "EngineeringDocumentType" NOT NULL,
    "discipline" "EngineeringDiscipline" NOT NULL DEFAULT 'GENERAL',
    "status" "EngineeringDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "authorText" TEXT,
    "responsibleMemberId" TEXT,
    "reviewerMemberId" TEXT,
    "reviewDueAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_document_revisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "engineeringDocumentId" TEXT NOT NULL,
    "revisionCode" TEXT NOT NULL,
    "revisionNumber" INTEGER,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "notes" TEXT,
    "status" "EngineeringRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedByMemberId" TEXT,
    "reviewStartedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByMemberId" TEXT,
    "reviewDecision" "EngineeringReviewDecision",
    "reviewComment" TEXT,
    "supersededAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfis" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workPackageId" TEXT,
    "contractorId" TEXT,
    "rfiNumber" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "discipline" "EngineeringDiscipline",
    "status" "RfiStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "RfiPriority" NOT NULL DEFAULT 'NORMAL',
    "raisedByText" TEXT,
    "raisedByMemberId" TEXT,
    "assignedToMemberId" TEXT,
    "dueAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closureNote" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfi_responses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfiId" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "respondedByMemberId" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalResponse" BOOLEAN NOT NULL DEFAULT false,
    "clarificationRequest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfi_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfi_references" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfiId" TEXT NOT NULL,
    "referenceType" "RfiReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "note" TEXT,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfi_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_submittals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT,
    "workPackageId" TEXT,
    "submittalNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "submittalType" "TechnicalSubmittalType" NOT NULL,
    "discipline" "EngineeringDiscipline",
    "status" "TechnicalSubmittalStatus" NOT NULL DEFAULT 'DRAFT',
    "assignedReviewerMemberId" TEXT,
    "dueAt" TIMESTAMP(3),
    "currentRevisionId" TEXT,
    "specificationReference" TEXT,
    "manufacturer" TEXT,
    "productName" TEXT,
    "modelNumber" TEXT,
    "supplierId" TEXT,
    "activity" TEXT,
    "workArea" TEXT,
    "closedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technical_submittals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_submittal_revisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "submittalId" TEXT NOT NULL,
    "revisionCode" TEXT NOT NULL,
    "revisionNumber" INTEGER,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "notes" TEXT,
    "status" "SubmittalRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedByMemberId" TEXT,
    "reviewStartedAt" TIMESTAMP(3),
    "reviewDecision" "EngineeringReviewDecision",
    "reviewedByMemberId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "supersededAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technical_submittal_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_transmittals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "transmittalNumber" TEXT NOT NULL,
    "direction" "TransmittalDirection" NOT NULL,
    "purpose" "TransmittalPurpose" NOT NULL,
    "status" "TransmittalStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "contractorId" TEXT,
    "workPackageId" TEXT,
    "senderText" TEXT,
    "recipientText" TEXT,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedByMemberId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByMemberId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_transmittals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_transmittal_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "engineeringDocumentId" TEXT,
    "engineeringRevisionId" TEXT,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_transmittal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfiDefaultDueDays" INTEGER NOT NULL DEFAULT 7,
    "submittalDefaultReviewDays" INTEGER NOT NULL DEFAULT 14,
    "contractorComplianceReminderDays" INTEGER NOT NULL DEFAULT 30,
    "dueSoonDays" INTEGER NOT NULL DEFAULT 2,
    "allowSelfReview" BOOLEAN NOT NULL DEFAULT false,
    "requireSubmittalDueDate" BOOLEAN NOT NULL DEFAULT false,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_profiles_companyId_status_idx" ON "contractor_profiles"("companyId", "status");

-- CreateIndex
CREATE INDEX "contractor_profiles_companyId_legalName_idx" ON "contractor_profiles"("companyId", "legalName");

-- CreateIndex
CREATE INDEX "contractor_profiles_companyId_supplierId_idx" ON "contractor_profiles"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "contractor_profiles_companyId_normalizedName_idx" ON "contractor_profiles"("companyId", "normalizedName");

-- CreateIndex
CREATE INDEX "contractor_profiles_companyId_registrationNumber_idx" ON "contractor_profiles"("companyId", "registrationNumber");

-- CreateIndex
CREATE INDEX "contractor_profiles_companyId_vatNumber_idx" ON "contractor_profiles"("companyId", "vatNumber");

-- CreateIndex
CREATE INDEX "contractor_contacts_companyId_contractorId_active_idx" ON "contractor_contacts"("companyId", "contractorId", "active");

-- CreateIndex
CREATE INDEX "project_contractor_assignments_companyId_projectId_status_idx" ON "project_contractor_assignments"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "project_contractor_assignments_companyId_contractorId_statu_idx" ON "project_contractor_assignments"("companyId", "contractorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_contractor_assignments_projectId_contractorId_key" ON "project_contractor_assignments"("projectId", "contractorId");

-- CreateIndex
CREATE INDEX "work_packages_companyId_projectId_status_idx" ON "work_packages"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "work_packages_companyId_contractorId_status_idx" ON "work_packages"("companyId", "contractorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_packages_companyId_projectId_code_key" ON "work_packages"("companyId", "projectId", "code");

-- CreateIndex
CREATE INDEX "contractor_compliance_items_companyId_contractorId_status_idx" ON "contractor_compliance_items"("companyId", "contractorId", "status");

-- CreateIndex
CREATE INDEX "contractor_compliance_items_companyId_expiresAt_idx" ON "contractor_compliance_items"("companyId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_documents_currentRevisionId_key" ON "engineering_documents"("currentRevisionId");

-- CreateIndex
CREATE INDEX "engineering_documents_companyId_projectId_status_idx" ON "engineering_documents"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "engineering_documents_companyId_contractorId_status_idx" ON "engineering_documents"("companyId", "contractorId", "status");

-- CreateIndex
CREATE INDEX "engineering_documents_companyId_workPackageId_status_idx" ON "engineering_documents"("companyId", "workPackageId", "status");

-- CreateIndex
CREATE INDEX "engineering_documents_companyId_projectId_documentType_idx" ON "engineering_documents"("companyId", "projectId", "documentType");

-- CreateIndex
CREATE INDEX "engineering_documents_companyId_reviewerMemberId_status_idx" ON "engineering_documents"("companyId", "reviewerMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_documents_companyId_projectId_documentNumber_key" ON "engineering_documents"("companyId", "projectId", "documentNumber");

-- CreateIndex
CREATE INDEX "engineering_document_revisions_companyId_engineeringDocumen_idx" ON "engineering_document_revisions"("companyId", "engineeringDocumentId");

-- CreateIndex
CREATE INDEX "engineering_document_revisions_companyId_status_idx" ON "engineering_document_revisions"("companyId", "status");

-- CreateIndex
CREATE INDEX "engineering_document_revisions_documentId_idx" ON "engineering_document_revisions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_document_revisions_engineeringDocumentId_revisi_key" ON "engineering_document_revisions"("engineeringDocumentId", "revisionCode");

-- CreateIndex
CREATE INDEX "rfis_companyId_projectId_status_idx" ON "rfis"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "rfis_companyId_assignedToMemberId_status_idx" ON "rfis"("companyId", "assignedToMemberId", "status");

-- CreateIndex
CREATE INDEX "rfis_companyId_dueAt_status_idx" ON "rfis"("companyId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "rfis_companyId_contractorId_status_idx" ON "rfis"("companyId", "contractorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rfis_companyId_projectId_rfiNumber_key" ON "rfis"("companyId", "projectId", "rfiNumber");

-- CreateIndex
CREATE INDEX "rfi_responses_companyId_rfiId_idx" ON "rfi_responses"("companyId", "rfiId");

-- CreateIndex
CREATE INDEX "rfi_references_companyId_rfiId_idx" ON "rfi_references"("companyId", "rfiId");

-- CreateIndex
CREATE INDEX "rfi_references_companyId_referenceType_referenceId_idx" ON "rfi_references"("companyId", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "rfi_references_rfiId_referenceType_referenceId_key" ON "rfi_references"("rfiId", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "technical_submittals_currentRevisionId_key" ON "technical_submittals"("currentRevisionId");

-- CreateIndex
CREATE INDEX "technical_submittals_companyId_projectId_status_idx" ON "technical_submittals"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "technical_submittals_companyId_contractorId_status_idx" ON "technical_submittals"("companyId", "contractorId", "status");

-- CreateIndex
CREATE INDEX "technical_submittals_companyId_dueAt_status_idx" ON "technical_submittals"("companyId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "technical_submittals_companyId_assignedReviewerMemberId_sta_idx" ON "technical_submittals"("companyId", "assignedReviewerMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "technical_submittals_companyId_projectId_submittalNumber_key" ON "technical_submittals"("companyId", "projectId", "submittalNumber");

-- CreateIndex
CREATE INDEX "technical_submittal_revisions_companyId_submittalId_idx" ON "technical_submittal_revisions"("companyId", "submittalId");

-- CreateIndex
CREATE INDEX "technical_submittal_revisions_companyId_status_idx" ON "technical_submittal_revisions"("companyId", "status");

-- CreateIndex
CREATE INDEX "technical_submittal_revisions_documentId_idx" ON "technical_submittal_revisions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "technical_submittal_revisions_submittalId_revisionCode_key" ON "technical_submittal_revisions"("submittalId", "revisionCode");

-- CreateIndex
CREATE INDEX "document_transmittals_companyId_projectId_issuedAt_idx" ON "document_transmittals"("companyId", "projectId", "issuedAt");

-- CreateIndex
CREATE INDEX "document_transmittals_companyId_projectId_status_idx" ON "document_transmittals"("companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_transmittals_companyId_projectId_transmittalNumber_key" ON "document_transmittals"("companyId", "projectId", "transmittalNumber");

-- CreateIndex
CREATE INDEX "document_transmittal_items_companyId_transmittalId_idx" ON "document_transmittal_items"("companyId", "transmittalId");

-- CreateIndex
CREATE INDEX "document_transmittal_items_companyId_engineeringDocumentId_idx" ON "document_transmittal_items"("companyId", "engineeringDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_transmittal_items_transmittalId_documentId_key" ON "document_transmittal_items"("transmittalId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_settings_companyId_key" ON "engineering_settings"("companyId");

-- CreateIndex
CREATE INDEX "daily_log_work_activities_companyId_contractorId_idx" ON "daily_log_work_activities"("companyId", "contractorId");

-- CreateIndex
CREATE INDEX "daily_log_work_activities_companyId_workPackageId_idx" ON "daily_log_work_activities"("companyId", "workPackageId");

-- CreateIndex
CREATE INDEX "daily_log_workforce_entries_companyId_contractorId_idx" ON "daily_log_workforce_entries"("companyId", "contractorId");

-- CreateIndex
CREATE INDEX "daily_log_workforce_entries_companyId_workPackageId_idx" ON "daily_log_workforce_entries"("companyId", "workPackageId");

-- AddForeignKey
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_contacts" ADD CONSTRAINT "contractor_contacts_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractor_assignments" ADD CONSTRAINT "project_contractor_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractor_assignments" ADD CONSTRAINT "project_contractor_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractor_assignments" ADD CONSTRAINT "project_contractor_assignments_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractor_assignments" ADD CONSTRAINT "project_contractor_assignments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractor_assignments" ADD CONSTRAINT "project_contractor_assignments_primaryContractorContactId_fkey" FOREIGN KEY ("primaryContractorContactId") REFERENCES "contractor_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_projectContractorAssignmentId_fkey" FOREIGN KEY ("projectContractorAssignmentId") REFERENCES "project_contractor_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_compliance_items" ADD CONSTRAINT "contractor_compliance_items_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_compliance_items" ADD CONSTRAINT "contractor_compliance_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_documents" ADD CONSTRAINT "engineering_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_documents" ADD CONSTRAINT "engineering_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_documents" ADD CONSTRAINT "engineering_documents_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "work_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_documents" ADD CONSTRAINT "engineering_documents_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_documents" ADD CONSTRAINT "engineering_documents_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "engineering_document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_document_revisions" ADD CONSTRAINT "engineering_document_revisions_engineeringDocumentId_fkey" FOREIGN KEY ("engineeringDocumentId") REFERENCES "engineering_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_document_revisions" ADD CONSTRAINT "engineering_document_revisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "work_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_responses" ADD CONSTRAINT "rfi_responses_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "rfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfi_references" ADD CONSTRAINT "rfi_references_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "rfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittals" ADD CONSTRAINT "technical_submittals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittals" ADD CONSTRAINT "technical_submittals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittals" ADD CONSTRAINT "technical_submittals_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittals" ADD CONSTRAINT "technical_submittals_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "work_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittals" ADD CONSTRAINT "technical_submittals_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittals" ADD CONSTRAINT "technical_submittals_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "technical_submittal_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittal_revisions" ADD CONSTRAINT "technical_submittal_revisions_submittalId_fkey" FOREIGN KEY ("submittalId") REFERENCES "technical_submittals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_submittal_revisions" ADD CONSTRAINT "technical_submittal_revisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "work_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittal_items" ADD CONSTRAINT "document_transmittal_items_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "document_transmittals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittal_items" ADD CONSTRAINT "document_transmittal_items_engineeringDocumentId_fkey" FOREIGN KEY ("engineeringDocumentId") REFERENCES "engineering_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittal_items" ADD CONSTRAINT "document_transmittal_items_engineeringRevisionId_fkey" FOREIGN KEY ("engineeringRevisionId") REFERENCES "engineering_document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_transmittal_items" ADD CONSTRAINT "document_transmittal_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_settings" ADD CONSTRAINT "engineering_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


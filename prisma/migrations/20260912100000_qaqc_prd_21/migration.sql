-- CreateEnum
CREATE TYPE "QualityInspectionType" AS ENUM ('MATERIAL', 'WORK', 'GENERAL');

-- CreateEnum
CREATE TYPE "QualityPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InspectionRequestStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InspectionResponseType" AS ENUM ('PASS_FAIL', 'PASS_FAIL_NA', 'TEXT', 'NUMBER', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "QualityInspectionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityInspectionResult" AS ENUM ('NOT_SET', 'PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "ChecklistItemResult" AS ENUM ('PASS', 'FAIL', 'NA');

-- CreateEnum
CREATE TYPE "QualitySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "QualityDefectStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "NCRCategory" AS ENUM ('MATERIAL', 'WORKMANSHIP', 'DOCUMENTATION', 'PROCESS', 'SUPPLIER', 'DESIGN', 'OTHER');

-- CreateEnum
CREATE TYPE "NCRStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED_FOR_CLOSE', 'CLOSED', 'REJECTED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "QualityApprovalRecordType" AS ENUM ('INSPECTION', 'NCR');

-- CreateEnum
CREATE TYPE "QualityApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaterialReleaseStatus" AS ENUM ('RELEASED', 'PARTIALLY_RELEASED', 'HELD', 'REJECTED', 'REVOKED');

-- CreateTable
CREATE TABLE "inspection_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inspectionType" "QualityInspectionType" NOT NULL,
    "projectId" TEXT,
    "goodsReceiptId" TEXT,
    "goodsReceiptItemId" TEXT,
    "requestedByMemberId" TEXT NOT NULL,
    "assignedInspectorMemberId" TEXT,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "requiredByDate" TIMESTAMP(3),
    "priority" "QualityPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "InspectionRequestStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT,
    "locationText" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inspectionType" "QualityInspectionType" NOT NULL,
    "description" TEXT,
    "status" "InspectionTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_template_items" (
    "id" TEXT NOT NULL,
    "inspectionTemplateId" TEXT NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "responseType" "InspectionResponseType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "passCriteriaText" TEXT,
    "requiresEvidenceOnFail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionNumber" TEXT NOT NULL,
    "inspectionType" "QualityInspectionType" NOT NULL,
    "requestId" TEXT,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "parentInspectionId" TEXT,
    "reinspectionSequence" INTEGER,
    "projectId" TEXT,
    "goodsReceiptId" TEXT,
    "goodsReceiptItemId" TEXT,
    "assignedInspectorMemberId" TEXT NOT NULL,
    "executedByMemberId" TEXT,
    "status" "QualityInspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "QualityInspectionResult" NOT NULL DEFAULT 'NOT_SET',
    "inspectionDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByMemberId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "locationText" TEXT,
    "workReference" TEXT,
    "drawingReference" TEXT,
    "specificationReference" TEXT,
    "summary" TEXT,
    "decisionNote" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_checklist_items" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "templateItemId" TEXT,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "responseType" "InspectionResponseType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "responseValue" TEXT,
    "result" "ChecklistItemResult",
    "note" TEXT,
    "requiresEvidenceOnFail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_inspection_decisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "goodsReceiptItemId" TEXT NOT NULL,
    "inspectedQuantity" DECIMAL(18,4) NOT NULL,
    "acceptedQuantity" DECIMAL(18,4) NOT NULL,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL,
    "conditionalQuantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_inspection_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_material_releases" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "goodsReceiptItemId" TEXT NOT NULL,
    "releasedQuantity" DECIMAL(18,4) NOT NULL,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL,
    "heldQuantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "status" "MaterialReleaseStatus" NOT NULL,
    "releasedByMemberId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByMemberId" TEXT,
    "revocationReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_material_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_defects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "defectNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "severity" "QualitySeverity" NOT NULL,
    "status" "QualityDefectStatus" NOT NULL DEFAULT 'OPEN',
    "locationText" TEXT,
    "assignedToMemberId" TEXT,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByMemberId" TEXT,
    "resolutionNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_conformance_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ncrNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT,
    "inspectionId" TEXT,
    "goodsReceiptId" TEXT,
    "goodsReceiptItemId" TEXT,
    "sourceDefectId" TEXT,
    "category" "NCRCategory" NOT NULL,
    "severity" "QualitySeverity" NOT NULL,
    "status" "NCRStatus" NOT NULL DEFAULT 'DRAFT',
    "assignedToMemberId" TEXT,
    "ownerMemberId" TEXT,
    "immediateAction" TEXT,
    "rootCause" TEXT,
    "correctiveActionSummary" TEXT,
    "dueDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByMemberId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "closureNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_conformance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actionNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ncrId" TEXT,
    "defectId" TEXT,
    "inspectionId" TEXT,
    "projectId" TEXT,
    "assignedToMemberId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "completionNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByMemberId" TEXT,
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "QualityApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "QualityApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_requests_companyId_idx" ON "inspection_requests"("companyId");

-- CreateIndex
CREATE INDEX "inspection_requests_companyId_status_idx" ON "inspection_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "inspection_requests_projectId_idx" ON "inspection_requests"("projectId");

-- CreateIndex
CREATE INDEX "inspection_requests_goodsReceiptId_idx" ON "inspection_requests"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "inspection_requests_goodsReceiptItemId_idx" ON "inspection_requests"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "inspection_requests_requestedByMemberId_idx" ON "inspection_requests"("requestedByMemberId");

-- CreateIndex
CREATE INDEX "inspection_requests_assignedInspectorMemberId_idx" ON "inspection_requests"("assignedInspectorMemberId");

-- CreateIndex
CREATE INDEX "inspection_requests_requiredByDate_idx" ON "inspection_requests"("requiredByDate");

-- CreateIndex
CREATE INDEX "inspection_requests_priority_idx" ON "inspection_requests"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_requests_companyId_requestNumber_key" ON "inspection_requests"("companyId", "requestNumber");

-- CreateIndex
CREATE INDEX "inspection_templates_companyId_idx" ON "inspection_templates"("companyId");

-- CreateIndex
CREATE INDEX "inspection_templates_companyId_status_idx" ON "inspection_templates"("companyId", "status");

-- CreateIndex
CREATE INDEX "inspection_templates_inspectionType_idx" ON "inspection_templates"("inspectionType");

-- CreateIndex
CREATE INDEX "inspection_templates_code_idx" ON "inspection_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_companyId_code_version_key" ON "inspection_templates"("companyId", "code", "version");

-- CreateIndex
CREATE INDEX "inspection_template_items_inspectionTemplateId_idx" ON "inspection_template_items"("inspectionTemplateId");

-- CreateIndex
CREATE INDEX "inspection_template_items_sortOrder_idx" ON "inspection_template_items"("sortOrder");

-- CreateIndex
CREATE INDEX "quality_inspections_companyId_idx" ON "quality_inspections"("companyId");

-- CreateIndex
CREATE INDEX "quality_inspections_companyId_status_idx" ON "quality_inspections"("companyId", "status");

-- CreateIndex
CREATE INDEX "quality_inspections_companyId_result_idx" ON "quality_inspections"("companyId", "result");

-- CreateIndex
CREATE INDEX "quality_inspections_projectId_idx" ON "quality_inspections"("projectId");

-- CreateIndex
CREATE INDEX "quality_inspections_requestId_idx" ON "quality_inspections"("requestId");

-- CreateIndex
CREATE INDEX "quality_inspections_templateId_idx" ON "quality_inspections"("templateId");

-- CreateIndex
CREATE INDEX "quality_inspections_parentInspectionId_idx" ON "quality_inspections"("parentInspectionId");

-- CreateIndex
CREATE INDEX "quality_inspections_goodsReceiptId_idx" ON "quality_inspections"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "quality_inspections_goodsReceiptItemId_idx" ON "quality_inspections"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "quality_inspections_assignedInspectorMemberId_idx" ON "quality_inspections"("assignedInspectorMemberId");

-- CreateIndex
CREATE INDEX "quality_inspections_inspectionDate_idx" ON "quality_inspections"("inspectionDate");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_companyId_inspectionNumber_key" ON "quality_inspections"("companyId", "inspectionNumber");

-- CreateIndex
CREATE INDEX "inspection_checklist_items_inspectionId_idx" ON "inspection_checklist_items"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_checklist_items_sortOrder_idx" ON "inspection_checklist_items"("sortOrder");

-- CreateIndex
CREATE INDEX "inspection_checklist_items_result_idx" ON "inspection_checklist_items"("result");

-- CreateIndex
CREATE INDEX "material_inspection_decisions_companyId_idx" ON "material_inspection_decisions"("companyId");

-- CreateIndex
CREATE INDEX "material_inspection_decisions_inspectionId_idx" ON "material_inspection_decisions"("inspectionId");

-- CreateIndex
CREATE INDEX "material_inspection_decisions_goodsReceiptItemId_idx" ON "material_inspection_decisions"("goodsReceiptItemId");

-- CreateIndex
CREATE UNIQUE INDEX "material_inspection_decisions_inspectionId_goodsReceiptItem_key" ON "material_inspection_decisions"("inspectionId", "goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "quality_material_releases_companyId_idx" ON "quality_material_releases"("companyId");

-- CreateIndex
CREATE INDEX "quality_material_releases_inspectionId_idx" ON "quality_material_releases"("inspectionId");

-- CreateIndex
CREATE INDEX "quality_material_releases_goodsReceiptItemId_idx" ON "quality_material_releases"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "quality_material_releases_status_idx" ON "quality_material_releases"("status");

-- CreateIndex
CREATE INDEX "quality_material_releases_releasedAt_idx" ON "quality_material_releases"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quality_material_releases_inspectionId_goodsReceiptItemId_key" ON "quality_material_releases"("inspectionId", "goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "quality_defects_companyId_idx" ON "quality_defects"("companyId");

-- CreateIndex
CREATE INDEX "quality_defects_companyId_status_idx" ON "quality_defects"("companyId", "status");

-- CreateIndex
CREATE INDEX "quality_defects_projectId_idx" ON "quality_defects"("projectId");

-- CreateIndex
CREATE INDEX "quality_defects_inspectionId_idx" ON "quality_defects"("inspectionId");

-- CreateIndex
CREATE INDEX "quality_defects_severity_idx" ON "quality_defects"("severity");

-- CreateIndex
CREATE INDEX "quality_defects_assignedToMemberId_idx" ON "quality_defects"("assignedToMemberId");

-- CreateIndex
CREATE INDEX "quality_defects_dueDate_idx" ON "quality_defects"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "quality_defects_companyId_defectNumber_key" ON "quality_defects"("companyId", "defectNumber");

-- CreateIndex
CREATE INDEX "non_conformance_reports_companyId_idx" ON "non_conformance_reports"("companyId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_companyId_status_idx" ON "non_conformance_reports"("companyId", "status");

-- CreateIndex
CREATE INDEX "non_conformance_reports_projectId_idx" ON "non_conformance_reports"("projectId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_inspectionId_idx" ON "non_conformance_reports"("inspectionId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_goodsReceiptId_idx" ON "non_conformance_reports"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_goodsReceiptItemId_idx" ON "non_conformance_reports"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_sourceDefectId_idx" ON "non_conformance_reports"("sourceDefectId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_category_idx" ON "non_conformance_reports"("category");

-- CreateIndex
CREATE INDEX "non_conformance_reports_severity_idx" ON "non_conformance_reports"("severity");

-- CreateIndex
CREATE INDEX "non_conformance_reports_assignedToMemberId_idx" ON "non_conformance_reports"("assignedToMemberId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_ownerMemberId_idx" ON "non_conformance_reports"("ownerMemberId");

-- CreateIndex
CREATE INDEX "non_conformance_reports_dueDate_idx" ON "non_conformance_reports"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "non_conformance_reports_companyId_ncrNumber_key" ON "non_conformance_reports"("companyId", "ncrNumber");

-- CreateIndex
CREATE INDEX "corrective_actions_companyId_idx" ON "corrective_actions"("companyId");

-- CreateIndex
CREATE INDEX "corrective_actions_companyId_status_idx" ON "corrective_actions"("companyId", "status");

-- CreateIndex
CREATE INDEX "corrective_actions_ncrId_idx" ON "corrective_actions"("ncrId");

-- CreateIndex
CREATE INDEX "corrective_actions_defectId_idx" ON "corrective_actions"("defectId");

-- CreateIndex
CREATE INDEX "corrective_actions_inspectionId_idx" ON "corrective_actions"("inspectionId");

-- CreateIndex
CREATE INDEX "corrective_actions_projectId_idx" ON "corrective_actions"("projectId");

-- CreateIndex
CREATE INDEX "corrective_actions_assignedToMemberId_idx" ON "corrective_actions"("assignedToMemberId");

-- CreateIndex
CREATE INDEX "corrective_actions_dueDate_idx" ON "corrective_actions"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "corrective_actions_companyId_actionNumber_key" ON "corrective_actions"("companyId", "actionNumber");

-- CreateIndex
CREATE INDEX "quality_approvals_companyId_idx" ON "quality_approvals"("companyId");

-- CreateIndex
CREATE INDEX "quality_approvals_companyId_status_idx" ON "quality_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "quality_approvals_recordType_recordId_idx" ON "quality_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "quality_approvals_submittedByMemberId_idx" ON "quality_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "quality_approvals_decidedByMemberId_idx" ON "quality_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "quality_approvals_submittedAt_idx" ON "quality_approvals"("submittedAt");

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_requestedByMemberId_fkey" FOREIGN KEY ("requestedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_assignedInspectorMemberId_fkey" FOREIGN KEY ("assignedInspectorMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_template_items" ADD CONSTRAINT "inspection_template_items_inspectionTemplateId_fkey" FOREIGN KEY ("inspectionTemplateId") REFERENCES "inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "inspection_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_assignedInspectorMemberId_fkey" FOREIGN KEY ("assignedInspectorMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_executedByMemberId_fkey" FOREIGN KEY ("executedByMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_parentInspectionId_fkey" FOREIGN KEY ("parentInspectionId") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_checklist_items" ADD CONSTRAINT "inspection_checklist_items_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inspection_decisions" ADD CONSTRAINT "material_inspection_decisions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inspection_decisions" ADD CONSTRAINT "material_inspection_decisions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_inspection_decisions" ADD CONSTRAINT "material_inspection_decisions_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_material_releases" ADD CONSTRAINT "quality_material_releases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_material_releases" ADD CONSTRAINT "quality_material_releases_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_material_releases" ADD CONSTRAINT "quality_material_releases_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_material_releases" ADD CONSTRAINT "quality_material_releases_releasedByMemberId_fkey" FOREIGN KEY ("releasedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_sourceDefectId_fkey" FOREIGN KEY ("sourceDefectId") REFERENCES "quality_defects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "non_conformance_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "quality_defects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_approvals" ADD CONSTRAINT "quality_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_approvals" ADD CONSTRAINT "quality_approvals_submittedByMemberId_fkey" FOREIGN KEY ("submittedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_approvals" ADD CONSTRAINT "quality_approvals_decidedByMemberId_fkey" FOREIGN KEY ("decidedByMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;


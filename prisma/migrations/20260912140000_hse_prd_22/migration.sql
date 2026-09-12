-- CreateEnum
CREATE TYPE "HseInspectionType" AS ENUM ('SITE_SAFETY', 'PPE', 'HOUSEKEEPING', 'WORK_AT_HEIGHT', 'ELECTRICAL', 'FIRE_SAFETY', 'EXCAVATION', 'LIFTING', 'ENVIRONMENTAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "HseInspectionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HseInspectionResult" AS ENUM ('NOT_SET', 'PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "HseTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HseChecklistResponseType" AS ENUM ('PASS_FAIL', 'PASS_FAIL_NA', 'BOOLEAN', 'TEXT', 'NUMBER');

-- CreateEnum
CREATE TYPE "HseChecklistResult" AS ENUM ('PASS', 'FAIL', 'NA');

-- CreateEnum
CREATE TYPE "HseHazardCategory" AS ENUM ('WORK_AT_HEIGHT', 'ELECTRICAL', 'FIRE', 'EXCAVATION', 'LIFTING', 'MACHINERY', 'VEHICLE', 'HOUSEKEEPING', 'PPE', 'CHEMICAL', 'ENVIRONMENTAL', 'ERGONOMIC', 'OTHER');

-- CreateEnum
CREATE TYPE "HseRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HseHazardStatus" AS ENUM ('OPEN', 'CONTROLLED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'CLOSED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "HseIncidentType" AS ENUM ('INCIDENT', 'NEAR_MISS', 'FIRST_AID', 'PROPERTY_DAMAGE', 'ENVIRONMENTAL_EVENT', 'VEHICLE_EVENT', 'FIRE_EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "HseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HseIncidentStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'ACTIONS_OPEN', 'PENDING_CLOSE', 'CLOSED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "HseRiskAssessmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HsePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HseActionType" AS ENUM ('CORRECTIVE', 'PREVENTIVE', 'IMMEDIATE', 'FOLLOW_UP', 'OTHER');

-- CreateEnum
CREATE TYPE "HseActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ToolboxTalkStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ToolboxAttendanceStatus" AS ENUM ('ATTENDED', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "HsePermitType" AS ENUM ('HOT_WORK', 'WORK_AT_HEIGHT', 'CONFINED_SPACE', 'EXCAVATION', 'ELECTRICAL', 'LIFTING', 'GENERAL', 'OTHER');

-- CreateEnum
CREATE TYPE "HsePermitStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PpeCheckResult" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "EnvironmentalCategory" AS ENUM ('SPILL', 'WASTE', 'DUST', 'NOISE', 'WATER', 'SOIL', 'EMISSIONS', 'BIODIVERSITY', 'OTHER');

-- CreateEnum
CREATE TYPE "EnvironmentalStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'CLOSED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "StopWorkStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HseApprovalRecordType" AS ENUM ('INSPECTION', 'RISK_ASSESSMENT', 'WORK_PERMIT', 'INCIDENT_CLOSE');

-- CreateEnum
CREATE TYPE "HseApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "hse_inspection_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inspectionType" "HseInspectionType" NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "HseTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_inspection_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "responseType" "HseChecklistResponseType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "riskIfFailed" "HseSeverity",
    "requiresNoteOnFail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_inspection_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_inspections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionNumber" TEXT NOT NULL,
    "inspectionType" "HseInspectionType" NOT NULL,
    "projectId" TEXT,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "assignedInspectorMemberId" TEXT NOT NULL,
    "executedByMemberId" TEXT,
    "status" "HseInspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "HseInspectionResult" NOT NULL DEFAULT 'NOT_SET',
    "scheduledDate" TIMESTAMP(3),
    "inspectionDate" TIMESTAMP(3),
    "locationText" TEXT,
    "summary" TEXT,
    "decisionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByMemberId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_inspection_checklist_items" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "templateItemId" TEXT,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "responseType" "HseChecklistResponseType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "responseValue" TEXT,
    "result" "HseChecklistResult",
    "note" TEXT,
    "riskIfFailed" "HseSeverity",
    "requiresNoteOnFail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_inspection_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_hazards" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hazardNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT,
    "inspectionId" TEXT,
    "hazardCategory" "HseHazardCategory" NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "severityScore" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "HseRiskLevel" NOT NULL,
    "residualLikelihood" INTEGER,
    "residualSeverity" INTEGER,
    "residualRiskScore" INTEGER,
    "residualRiskLevel" "HseRiskLevel",
    "status" "HseHazardStatus" NOT NULL DEFAULT 'OPEN',
    "locationText" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "reportedByMemberId" TEXT NOT NULL,
    "assignedToMemberId" TEXT,
    "immediateControl" TEXT,
    "controlMeasure" TEXT,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "closureNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_hazards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_incidents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "incidentNumber" TEXT NOT NULL,
    "incidentType" "HseIncidentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationText" TEXT,
    "severity" "HseSeverity" NOT NULL,
    "status" "HseIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "reportedByMemberId" TEXT NOT NULL,
    "investigatorMemberId" TEXT,
    "injuryOccurred" BOOLEAN NOT NULL DEFAULT false,
    "firstAidRequired" BOOLEAN NOT NULL DEFAULT false,
    "medicalTreatmentRequired" BOOLEAN NOT NULL DEFAULT false,
    "lostTime" BOOLEAN NOT NULL DEFAULT false,
    "propertyDamage" BOOLEAN NOT NULL DEFAULT false,
    "environmentalImpact" BOOLEAN NOT NULL DEFAULT false,
    "immediateAction" TEXT,
    "investigationSummary" TEXT,
    "rootCause" TEXT,
    "lessonsLearned" TEXT,
    "dueDate" TIMESTAMP(3),
    "submittedForCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "closureNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_risk_assessments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assessmentNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT,
    "activityType" TEXT,
    "locationText" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "HseRiskAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerMemberId" TEXT,
    "assessmentDate" TIMESTAMP(3) NOT NULL,
    "reviewDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_risk_assessment_items" (
    "id" TEXT NOT NULL,
    "riskAssessmentId" TEXT NOT NULL,
    "hazardDescription" TEXT NOT NULL,
    "existingControls" TEXT,
    "likelihood" INTEGER NOT NULL,
    "severityScore" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "HseRiskLevel" NOT NULL,
    "additionalControls" TEXT,
    "residualLikelihood" INTEGER,
    "residualSeverity" INTEGER,
    "residualRiskScore" INTEGER,
    "residualRiskLevel" "HseRiskLevel",
    "responsibleMemberId" TEXT,
    "dueDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_risk_assessment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_actions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actionNumber" TEXT NOT NULL,
    "actionType" "HseActionType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT,
    "hazardId" TEXT,
    "incidentId" TEXT,
    "inspectionId" TEXT,
    "riskAssessmentId" TEXT,
    "environmentalObservationId" TEXT,
    "stopWorkId" TEXT,
    "permitId" TEXT,
    "assignedToMemberId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "priority" "HsePriority" NOT NULL,
    "status" "HseActionStatus" NOT NULL DEFAULT 'OPEN',
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

    CONSTRAINT "hse_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toolbox_talks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "talkNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "projectId" TEXT,
    "talkDate" TIMESTAMP(3) NOT NULL,
    "locationText" TEXT,
    "conductedByMemberId" TEXT NOT NULL,
    "status" "ToolboxTalkStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toolbox_talks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toolbox_talk_participants" (
    "id" TEXT NOT NULL,
    "toolboxTalkId" TEXT NOT NULL,
    "companyMemberId" TEXT,
    "externalName" TEXT,
    "attendanceStatus" "ToolboxAttendanceStatus" NOT NULL,
    "signatureRecorded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toolbox_talk_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_work_permits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "permitNumber" TEXT NOT NULL,
    "permitType" "HsePermitType" NOT NULL,
    "title" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "locationText" TEXT NOT NULL,
    "riskAssessmentId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "requestedByMemberId" TEXT NOT NULL,
    "responsibleMemberId" TEXT,
    "status" "HsePermitStatus" NOT NULL DEFAULT 'DRAFT',
    "hazardsSummary" TEXT,
    "controlsSummary" TEXT,
    "ppeRequirements" TEXT,
    "specialConditions" TEXT,
    "suspensionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_work_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_checks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checkNumber" TEXT NOT NULL,
    "projectId" TEXT,
    "checkDate" TIMESTAMP(3) NOT NULL,
    "locationText" TEXT,
    "checkedByMemberId" TEXT NOT NULL,
    "subjectMemberId" TEXT,
    "externalSubjectName" TEXT,
    "helmetOk" BOOLEAN,
    "eyeProtectionOk" BOOLEAN,
    "glovesOk" BOOLEAN,
    "footwearOk" BOOLEAN,
    "harnessOk" BOOLEAN,
    "hearingProtectionOk" BOOLEAN,
    "respiratoryProtectionOk" BOOLEAN,
    "otherPpeNote" TEXT,
    "result" "PpeCheckResult" NOT NULL,
    "notes" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppe_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environmental_observations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "observationNumber" TEXT NOT NULL,
    "projectId" TEXT,
    "category" "EnvironmentalCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "locationText" TEXT,
    "severity" "HseSeverity" NOT NULL,
    "status" "EnvironmentalStatus" NOT NULL DEFAULT 'OPEN',
    "reportedByMemberId" TEXT NOT NULL,
    "assignedToMemberId" TEXT,
    "immediateAction" TEXT,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByMemberId" TEXT,
    "closureNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environmental_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stop_work_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stopWorkNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "locationText" TEXT,
    "hazardId" TEXT,
    "incidentId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "issuedByMemberId" TEXT NOT NULL,
    "status" "StopWorkStatus" NOT NULL DEFAULT 'ACTIVE',
    "releasedAt" TIMESTAMP(3),
    "releasedByMemberId" TEXT,
    "releaseReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stop_work_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "HseApprovalRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "HseApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMemberId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hse_inspection_templates_companyId_idx" ON "hse_inspection_templates"("companyId");

-- CreateIndex
CREATE INDEX "hse_inspection_templates_companyId_status_idx" ON "hse_inspection_templates"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_inspection_templates_inspectionType_idx" ON "hse_inspection_templates"("inspectionType");

-- CreateIndex
CREATE INDEX "hse_inspection_templates_code_idx" ON "hse_inspection_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hse_inspection_templates_companyId_code_version_key" ON "hse_inspection_templates"("companyId", "code", "version");

-- CreateIndex
CREATE INDEX "hse_inspection_template_items_templateId_idx" ON "hse_inspection_template_items"("templateId");

-- CreateIndex
CREATE INDEX "hse_inspection_template_items_sortOrder_idx" ON "hse_inspection_template_items"("sortOrder");

-- CreateIndex
CREATE INDEX "hse_inspections_companyId_idx" ON "hse_inspections"("companyId");

-- CreateIndex
CREATE INDEX "hse_inspections_companyId_status_idx" ON "hse_inspections"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_inspections_companyId_result_idx" ON "hse_inspections"("companyId", "result");

-- CreateIndex
CREATE INDEX "hse_inspections_projectId_idx" ON "hse_inspections"("projectId");

-- CreateIndex
CREATE INDEX "hse_inspections_templateId_idx" ON "hse_inspections"("templateId");

-- CreateIndex
CREATE INDEX "hse_inspections_assignedInspectorMemberId_idx" ON "hse_inspections"("assignedInspectorMemberId");

-- CreateIndex
CREATE INDEX "hse_inspections_scheduledDate_idx" ON "hse_inspections"("scheduledDate");

-- CreateIndex
CREATE INDEX "hse_inspections_inspectionDate_idx" ON "hse_inspections"("inspectionDate");

-- CreateIndex
CREATE UNIQUE INDEX "hse_inspections_companyId_inspectionNumber_key" ON "hse_inspections"("companyId", "inspectionNumber");

-- CreateIndex
CREATE INDEX "hse_inspection_checklist_items_inspectionId_idx" ON "hse_inspection_checklist_items"("inspectionId");

-- CreateIndex
CREATE INDEX "hse_inspection_checklist_items_sortOrder_idx" ON "hse_inspection_checklist_items"("sortOrder");

-- CreateIndex
CREATE INDEX "hse_inspection_checklist_items_result_idx" ON "hse_inspection_checklist_items"("result");

-- CreateIndex
CREATE INDEX "hse_hazards_companyId_idx" ON "hse_hazards"("companyId");

-- CreateIndex
CREATE INDEX "hse_hazards_companyId_status_idx" ON "hse_hazards"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_hazards_companyId_riskLevel_idx" ON "hse_hazards"("companyId", "riskLevel");

-- CreateIndex
CREATE INDEX "hse_hazards_projectId_idx" ON "hse_hazards"("projectId");

-- CreateIndex
CREATE INDEX "hse_hazards_inspectionId_idx" ON "hse_hazards"("inspectionId");

-- CreateIndex
CREATE INDEX "hse_hazards_hazardCategory_idx" ON "hse_hazards"("hazardCategory");

-- CreateIndex
CREATE INDEX "hse_hazards_assignedToMemberId_idx" ON "hse_hazards"("assignedToMemberId");

-- CreateIndex
CREATE INDEX "hse_hazards_dueDate_idx" ON "hse_hazards"("dueDate");

-- CreateIndex
CREATE INDEX "hse_hazards_observedAt_idx" ON "hse_hazards"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "hse_hazards_companyId_hazardNumber_key" ON "hse_hazards"("companyId", "hazardNumber");

-- CreateIndex
CREATE INDEX "hse_incidents_companyId_idx" ON "hse_incidents"("companyId");

-- CreateIndex
CREATE INDEX "hse_incidents_companyId_status_idx" ON "hse_incidents"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_incidents_companyId_incidentType_idx" ON "hse_incidents"("companyId", "incidentType");

-- CreateIndex
CREATE INDEX "hse_incidents_companyId_severity_idx" ON "hse_incidents"("companyId", "severity");

-- CreateIndex
CREATE INDEX "hse_incidents_projectId_idx" ON "hse_incidents"("projectId");

-- CreateIndex
CREATE INDEX "hse_incidents_reportedByMemberId_idx" ON "hse_incidents"("reportedByMemberId");

-- CreateIndex
CREATE INDEX "hse_incidents_investigatorMemberId_idx" ON "hse_incidents"("investigatorMemberId");

-- CreateIndex
CREATE INDEX "hse_incidents_occurredAt_idx" ON "hse_incidents"("occurredAt");

-- CreateIndex
CREATE INDEX "hse_incidents_dueDate_idx" ON "hse_incidents"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "hse_incidents_companyId_incidentNumber_key" ON "hse_incidents"("companyId", "incidentNumber");

-- CreateIndex
CREATE INDEX "hse_risk_assessments_companyId_idx" ON "hse_risk_assessments"("companyId");

-- CreateIndex
CREATE INDEX "hse_risk_assessments_companyId_status_idx" ON "hse_risk_assessments"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_risk_assessments_projectId_idx" ON "hse_risk_assessments"("projectId");

-- CreateIndex
CREATE INDEX "hse_risk_assessments_ownerMemberId_idx" ON "hse_risk_assessments"("ownerMemberId");

-- CreateIndex
CREATE INDEX "hse_risk_assessments_assessmentDate_idx" ON "hse_risk_assessments"("assessmentDate");

-- CreateIndex
CREATE INDEX "hse_risk_assessments_reviewDate_idx" ON "hse_risk_assessments"("reviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "hse_risk_assessments_companyId_assessmentNumber_version_key" ON "hse_risk_assessments"("companyId", "assessmentNumber", "version");

-- CreateIndex
CREATE INDEX "hse_risk_assessment_items_riskAssessmentId_idx" ON "hse_risk_assessment_items"("riskAssessmentId");

-- CreateIndex
CREATE INDEX "hse_risk_assessment_items_riskLevel_idx" ON "hse_risk_assessment_items"("riskLevel");

-- CreateIndex
CREATE INDEX "hse_risk_assessment_items_responsibleMemberId_idx" ON "hse_risk_assessment_items"("responsibleMemberId");

-- CreateIndex
CREATE INDEX "hse_risk_assessment_items_dueDate_idx" ON "hse_risk_assessment_items"("dueDate");

-- CreateIndex
CREATE INDEX "hse_actions_companyId_idx" ON "hse_actions"("companyId");

-- CreateIndex
CREATE INDEX "hse_actions_companyId_status_idx" ON "hse_actions"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_actions_projectId_idx" ON "hse_actions"("projectId");

-- CreateIndex
CREATE INDEX "hse_actions_hazardId_idx" ON "hse_actions"("hazardId");

-- CreateIndex
CREATE INDEX "hse_actions_incidentId_idx" ON "hse_actions"("incidentId");

-- CreateIndex
CREATE INDEX "hse_actions_inspectionId_idx" ON "hse_actions"("inspectionId");

-- CreateIndex
CREATE INDEX "hse_actions_riskAssessmentId_idx" ON "hse_actions"("riskAssessmentId");

-- CreateIndex
CREATE INDEX "hse_actions_environmentalObservationId_idx" ON "hse_actions"("environmentalObservationId");

-- CreateIndex
CREATE INDEX "hse_actions_stopWorkId_idx" ON "hse_actions"("stopWorkId");

-- CreateIndex
CREATE INDEX "hse_actions_permitId_idx" ON "hse_actions"("permitId");

-- CreateIndex
CREATE INDEX "hse_actions_assignedToMemberId_idx" ON "hse_actions"("assignedToMemberId");

-- CreateIndex
CREATE INDEX "hse_actions_priority_idx" ON "hse_actions"("priority");

-- CreateIndex
CREATE INDEX "hse_actions_dueDate_idx" ON "hse_actions"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "hse_actions_companyId_actionNumber_key" ON "hse_actions"("companyId", "actionNumber");

-- CreateIndex
CREATE INDEX "toolbox_talks_companyId_idx" ON "toolbox_talks"("companyId");

-- CreateIndex
CREATE INDEX "toolbox_talks_companyId_status_idx" ON "toolbox_talks"("companyId", "status");

-- CreateIndex
CREATE INDEX "toolbox_talks_projectId_idx" ON "toolbox_talks"("projectId");

-- CreateIndex
CREATE INDEX "toolbox_talks_talkDate_idx" ON "toolbox_talks"("talkDate");

-- CreateIndex
CREATE INDEX "toolbox_talks_conductedByMemberId_idx" ON "toolbox_talks"("conductedByMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "toolbox_talks_companyId_talkNumber_key" ON "toolbox_talks"("companyId", "talkNumber");

-- CreateIndex
CREATE INDEX "toolbox_talk_participants_toolboxTalkId_idx" ON "toolbox_talk_participants"("toolboxTalkId");

-- CreateIndex
CREATE INDEX "toolbox_talk_participants_companyMemberId_idx" ON "toolbox_talk_participants"("companyMemberId");

-- CreateIndex
CREATE INDEX "toolbox_talk_participants_attendanceStatus_idx" ON "toolbox_talk_participants"("attendanceStatus");

-- CreateIndex
CREATE INDEX "hse_work_permits_companyId_idx" ON "hse_work_permits"("companyId");

-- CreateIndex
CREATE INDEX "hse_work_permits_companyId_status_idx" ON "hse_work_permits"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_work_permits_projectId_idx" ON "hse_work_permits"("projectId");

-- CreateIndex
CREATE INDEX "hse_work_permits_permitType_idx" ON "hse_work_permits"("permitType");

-- CreateIndex
CREATE INDEX "hse_work_permits_riskAssessmentId_idx" ON "hse_work_permits"("riskAssessmentId");

-- CreateIndex
CREATE INDEX "hse_work_permits_validFrom_idx" ON "hse_work_permits"("validFrom");

-- CreateIndex
CREATE INDEX "hse_work_permits_validUntil_idx" ON "hse_work_permits"("validUntil");

-- CreateIndex
CREATE INDEX "hse_work_permits_requestedByMemberId_idx" ON "hse_work_permits"("requestedByMemberId");

-- CreateIndex
CREATE INDEX "hse_work_permits_responsibleMemberId_idx" ON "hse_work_permits"("responsibleMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "hse_work_permits_companyId_permitNumber_key" ON "hse_work_permits"("companyId", "permitNumber");

-- CreateIndex
CREATE INDEX "ppe_checks_companyId_idx" ON "ppe_checks"("companyId");

-- CreateIndex
CREATE INDEX "ppe_checks_projectId_idx" ON "ppe_checks"("projectId");

-- CreateIndex
CREATE INDEX "ppe_checks_checkDate_idx" ON "ppe_checks"("checkDate");

-- CreateIndex
CREATE INDEX "ppe_checks_checkedByMemberId_idx" ON "ppe_checks"("checkedByMemberId");

-- CreateIndex
CREATE INDEX "ppe_checks_subjectMemberId_idx" ON "ppe_checks"("subjectMemberId");

-- CreateIndex
CREATE INDEX "ppe_checks_result_idx" ON "ppe_checks"("result");

-- CreateIndex
CREATE UNIQUE INDEX "ppe_checks_companyId_checkNumber_key" ON "ppe_checks"("companyId", "checkNumber");

-- CreateIndex
CREATE INDEX "environmental_observations_companyId_idx" ON "environmental_observations"("companyId");

-- CreateIndex
CREATE INDEX "environmental_observations_companyId_status_idx" ON "environmental_observations"("companyId", "status");

-- CreateIndex
CREATE INDEX "environmental_observations_projectId_idx" ON "environmental_observations"("projectId");

-- CreateIndex
CREATE INDEX "environmental_observations_category_idx" ON "environmental_observations"("category");

-- CreateIndex
CREATE INDEX "environmental_observations_severity_idx" ON "environmental_observations"("severity");

-- CreateIndex
CREATE INDEX "environmental_observations_reportedByMemberId_idx" ON "environmental_observations"("reportedByMemberId");

-- CreateIndex
CREATE INDEX "environmental_observations_assignedToMemberId_idx" ON "environmental_observations"("assignedToMemberId");

-- CreateIndex
CREATE INDEX "environmental_observations_dueDate_idx" ON "environmental_observations"("dueDate");

-- CreateIndex
CREATE INDEX "environmental_observations_observedAt_idx" ON "environmental_observations"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "environmental_observations_companyId_observationNumber_key" ON "environmental_observations"("companyId", "observationNumber");

-- CreateIndex
CREATE INDEX "stop_work_records_companyId_idx" ON "stop_work_records"("companyId");

-- CreateIndex
CREATE INDEX "stop_work_records_companyId_status_idx" ON "stop_work_records"("companyId", "status");

-- CreateIndex
CREATE INDEX "stop_work_records_projectId_idx" ON "stop_work_records"("projectId");

-- CreateIndex
CREATE INDEX "stop_work_records_hazardId_idx" ON "stop_work_records"("hazardId");

-- CreateIndex
CREATE INDEX "stop_work_records_incidentId_idx" ON "stop_work_records"("incidentId");

-- CreateIndex
CREATE INDEX "stop_work_records_issuedAt_idx" ON "stop_work_records"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "stop_work_records_companyId_stopWorkNumber_key" ON "stop_work_records"("companyId", "stopWorkNumber");

-- CreateIndex
CREATE INDEX "hse_approvals_companyId_idx" ON "hse_approvals"("companyId");

-- CreateIndex
CREATE INDEX "hse_approvals_companyId_status_idx" ON "hse_approvals"("companyId", "status");

-- CreateIndex
CREATE INDEX "hse_approvals_recordType_recordId_idx" ON "hse_approvals"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "hse_approvals_submittedByMemberId_idx" ON "hse_approvals"("submittedByMemberId");

-- CreateIndex
CREATE INDEX "hse_approvals_decidedByMemberId_idx" ON "hse_approvals"("decidedByMemberId");

-- CreateIndex
CREATE INDEX "hse_approvals_submittedAt_idx" ON "hse_approvals"("submittedAt");

-- AddForeignKey
ALTER TABLE "hse_inspection_templates" ADD CONSTRAINT "hse_inspection_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspection_template_items" ADD CONSTRAINT "hse_inspection_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "hse_inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "hse_inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_assignedInspectorMemberId_fkey" FOREIGN KEY ("assignedInspectorMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspections" ADD CONSTRAINT "hse_inspections_executedByMemberId_fkey" FOREIGN KEY ("executedByMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_inspection_checklist_items" ADD CONSTRAINT "hse_inspection_checklist_items_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "hse_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_hazards" ADD CONSTRAINT "hse_hazards_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_hazards" ADD CONSTRAINT "hse_hazards_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_hazards" ADD CONSTRAINT "hse_hazards_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "hse_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_hazards" ADD CONSTRAINT "hse_hazards_reportedByMemberId_fkey" FOREIGN KEY ("reportedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_hazards" ADD CONSTRAINT "hse_hazards_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_reportedByMemberId_fkey" FOREIGN KEY ("reportedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_investigatorMemberId_fkey" FOREIGN KEY ("investigatorMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_risk_assessments" ADD CONSTRAINT "hse_risk_assessments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_risk_assessments" ADD CONSTRAINT "hse_risk_assessments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_risk_assessments" ADD CONSTRAINT "hse_risk_assessments_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_risk_assessment_items" ADD CONSTRAINT "hse_risk_assessment_items_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "hse_risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "hse_hazards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "hse_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "hse_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "hse_risk_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_environmentalObservationId_fkey" FOREIGN KEY ("environmentalObservationId") REFERENCES "environmental_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_stopWorkId_fkey" FOREIGN KEY ("stopWorkId") REFERENCES "stop_work_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "hse_work_permits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_actions" ADD CONSTRAINT "hse_actions_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talks" ADD CONSTRAINT "toolbox_talks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talks" ADD CONSTRAINT "toolbox_talks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talks" ADD CONSTRAINT "toolbox_talks_conductedByMemberId_fkey" FOREIGN KEY ("conductedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talk_participants" ADD CONSTRAINT "toolbox_talk_participants_toolboxTalkId_fkey" FOREIGN KEY ("toolboxTalkId") REFERENCES "toolbox_talks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talk_participants" ADD CONSTRAINT "toolbox_talk_participants_companyMemberId_fkey" FOREIGN KEY ("companyMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permits" ADD CONSTRAINT "hse_work_permits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permits" ADD CONSTRAINT "hse_work_permits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permits" ADD CONSTRAINT "hse_work_permits_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "hse_risk_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permits" ADD CONSTRAINT "hse_work_permits_requestedByMemberId_fkey" FOREIGN KEY ("requestedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_work_permits" ADD CONSTRAINT "hse_work_permits_responsibleMemberId_fkey" FOREIGN KEY ("responsibleMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_checks" ADD CONSTRAINT "ppe_checks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_checks" ADD CONSTRAINT "ppe_checks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_checks" ADD CONSTRAINT "ppe_checks_checkedByMemberId_fkey" FOREIGN KEY ("checkedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_checks" ADD CONSTRAINT "ppe_checks_subjectMemberId_fkey" FOREIGN KEY ("subjectMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environmental_observations" ADD CONSTRAINT "environmental_observations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environmental_observations" ADD CONSTRAINT "environmental_observations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environmental_observations" ADD CONSTRAINT "environmental_observations_reportedByMemberId_fkey" FOREIGN KEY ("reportedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environmental_observations" ADD CONSTRAINT "environmental_observations_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_work_records" ADD CONSTRAINT "stop_work_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_work_records" ADD CONSTRAINT "stop_work_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_work_records" ADD CONSTRAINT "stop_work_records_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "hse_hazards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_work_records" ADD CONSTRAINT "stop_work_records_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "hse_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_work_records" ADD CONSTRAINT "stop_work_records_issuedByMemberId_fkey" FOREIGN KEY ("issuedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_work_records" ADD CONSTRAINT "stop_work_records_releasedByMemberId_fkey" FOREIGN KEY ("releasedByMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_approvals" ADD CONSTRAINT "hse_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_approvals" ADD CONSTRAINT "hse_approvals_submittedByMemberId_fkey" FOREIGN KEY ("submittedByMemberId") REFERENCES "company_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_approvals" ADD CONSTRAINT "hse_approvals_decidedByMemberId_fkey" FOREIGN KEY ("decidedByMemberId") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Risk is a 5x5 matrix and the database says so too (PRD #22 §237).
--
-- The services derive and validate every one of these, but a score is the input
-- to which hazards get escalated and which get filed: a likelihood of 9 that
-- reached a row through a seed script or a repair query would quietly outrank
-- every real critical hazard in the register. Prisma cannot express CHECK, so
-- these are written here by hand.
ALTER TABLE "hse_hazards"
  ADD CONSTRAINT "hse_hazards_likelihood_range" CHECK ("likelihood" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_hazards_severity_range" CHECK ("severityScore" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_hazards_risk_score_range" CHECK ("riskScore" BETWEEN 1 AND 25),
  ADD CONSTRAINT "hse_hazards_residual_likelihood_range" CHECK ("residualLikelihood" IS NULL OR "residualLikelihood" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_hazards_residual_severity_range" CHECK ("residualSeverity" IS NULL OR "residualSeverity" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_hazards_residual_score_range" CHECK ("residualRiskScore" IS NULL OR "residualRiskScore" BETWEEN 1 AND 25);

ALTER TABLE "hse_risk_assessment_items"
  ADD CONSTRAINT "hse_ra_items_likelihood_range" CHECK ("likelihood" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_ra_items_severity_range" CHECK ("severityScore" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_ra_items_risk_score_range" CHECK ("riskScore" BETWEEN 1 AND 25),
  ADD CONSTRAINT "hse_ra_items_residual_likelihood_range" CHECK ("residualLikelihood" IS NULL OR "residualLikelihood" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_ra_items_residual_severity_range" CHECK ("residualSeverity" IS NULL OR "residualSeverity" BETWEEN 1 AND 5),
  ADD CONSTRAINT "hse_ra_items_residual_score_range" CHECK ("residualRiskScore" IS NULL OR "residualRiskScore" BETWEEN 1 AND 25);

-- A permit whose window runs backwards authorises nothing (PRD #22 §147).
ALTER TABLE "hse_work_permits"
  ADD CONSTRAINT "hse_work_permits_validity_order" CHECK ("validUntil" > "validFrom");

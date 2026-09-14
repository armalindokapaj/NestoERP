-- PRD #43: construction daily logs / site diary — the log, its sections, links, corrections and settings.

-- CreateEnum
CREATE TYPE "DailyLogStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'LOCKED', 'CORRECTION_REQUIRED', 'VOID');

-- CreateEnum
CREATE TYPE "DailyLogWeatherCondition" AS ENUM ('CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'SNOW', 'WINDY', 'FOG', 'EXTREME_HEAT', 'EXTREME_COLD', 'OTHER');

-- CreateEnum
CREATE TYPE "DailyLogSiteCondition" AS ENUM ('DRY', 'WET', 'MUDDY', 'FLOODED', 'RESTRICTED_ACCESS', 'HIGH_WIND', 'DUSTY', 'OTHER');

-- CreateEnum
CREATE TYPE "DailyLogEquipmentStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'IDLE', 'OUT_OF_SERVICE', 'BREAKDOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "DailyLogDelayCategory" AS ENUM ('WEATHER', 'LABOR', 'MATERIAL', 'EQUIPMENT', 'DESIGN', 'ACCESS', 'INSPECTION', 'CLIENT', 'SUBCONTRACTOR', 'UTILITY', 'SAFETY', 'QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DailyLogDelayImpact" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DailyLogTaskLinkType" AS ENUM ('RELATED', 'CREATED_FROM_LOG', 'FOLLOW_UP', 'DELAY_ACTION', 'INSTRUCTION_ACTION');

-- CreateEnum
CREATE TYPE "DailyLogDocumentCategory" AS ENUM ('PHOTO', 'DELIVERY_TICKET', 'SKETCH', 'REPORT', 'INSTRUCTION', 'OTHER');

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "status" "DailyLogStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMemberId" TEXT NOT NULL,
    "submittedByMemberId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewerMemberId" TEXT,
    "reviewedByMemberId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "lockedByMemberId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "returnedByMemberId" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "voidedByMemberId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "summary" TEXT,
    "generalNotes" TEXT,
    "delaySummary" TEXT,
    "instructionSummary" TEXT,
    "weatherSummary" TEXT,
    "siteCondition" "DailyLogSiteCondition",
    "siteConditionNotes" TEXT,
    "lateEntry" BOOLEAN NOT NULL DEFAULT false,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_weather_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "temperatureC" DECIMAL(5,2),
    "condition" "DailyLogWeatherCondition",
    "precipitationMm" DECIMAL(8,2),
    "windKph" DECIMAL(8,2),
    "humidityPct" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_weather_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_workforce_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "supplierId" TEXT,
    "trade" TEXT,
    "crewName" TEXT,
    "headcount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_workforce_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_work_activities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectArea" TEXT,
    "floorZone" TEXT,
    "trade" TEXT,
    "progressPercent" DECIMAL(5,2),
    "linkedTaskId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_work_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_equipment_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "equipmentName" TEXT NOT NULL,
    "equipmentCode" TEXT,
    "supplierId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "hoursUsed" DECIMAL(8,2),
    "status" "DailyLogEquipmentStatus",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_equipment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_delivery_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "goodsReceiptId" TEXT,
    "inventoryReceiptId" TEXT,
    "quantityText" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "conditionNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_delivery_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_visitor_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "purpose" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "escortedByMemberId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_visitor_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_delay_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "category" "DailyLogDelayCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "responsiblePartyText" TEXT,
    "impact" "DailyLogDelayImpact",
    "linkedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_delay_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_instruction_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "issuedByText" TEXT,
    "issuedByMemberId" TEXT,
    "recipientText" TEXT,
    "issuedAt" TIMESTAMP(3),
    "requiresAction" BOOLEAN NOT NULL DEFAULT false,
    "linkedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_instruction_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_task_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "linkType" "DailyLogTaskLinkType" NOT NULL DEFAULT 'RELATED',
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_log_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_document_links" (
    "dailyLogId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" "DailyLogDocumentCategory" NOT NULL DEFAULT 'PHOTO',
    "caption" TEXT,
    "takenAt" TIMESTAMP(3),
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_document_links_pkey" PRIMARY KEY ("dailyLogId","documentId")
);

-- CreateTable
CREATE TABLE "daily_log_corrections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "correctionSummary" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "approvedByMemberId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_log_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "logsRequired" BOOLEAN NOT NULL DEFAULT false,
    "backdateDays" INTEGER NOT NULL DEFAULT 7,
    "reviewerRequired" BOOLEAN NOT NULL DEFAULT true,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_log_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_daily_log_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "logsRequired" BOOLEAN,
    "reviewerMemberId" TEXT,
    "workingDays" INTEGER[],
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_daily_log_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_logs_companyId_status_workDate_idx" ON "daily_logs"("companyId", "status", "workDate");

-- CreateIndex
CREATE INDEX "daily_logs_companyId_reviewerMemberId_status_idx" ON "daily_logs"("companyId", "reviewerMemberId", "status");

-- CreateIndex
CREATE INDEX "daily_logs_companyId_workDate_idx" ON "daily_logs"("companyId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_logs_companyId_projectId_workDate_key" ON "daily_logs"("companyId", "projectId", "workDate");

-- CreateIndex
CREATE INDEX "daily_log_weather_entries_companyId_dailyLogId_idx" ON "daily_log_weather_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_workforce_entries_companyId_dailyLogId_idx" ON "daily_log_workforce_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_workforce_entries_companyId_supplierId_idx" ON "daily_log_workforce_entries"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "daily_log_work_activities_companyId_dailyLogId_idx" ON "daily_log_work_activities"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_work_activities_companyId_linkedTaskId_idx" ON "daily_log_work_activities"("companyId", "linkedTaskId");

-- CreateIndex
CREATE INDEX "daily_log_equipment_entries_companyId_dailyLogId_idx" ON "daily_log_equipment_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_delivery_entries_companyId_dailyLogId_idx" ON "daily_log_delivery_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_delivery_entries_companyId_purchaseOrderId_idx" ON "daily_log_delivery_entries"("companyId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "daily_log_delivery_entries_companyId_goodsReceiptId_idx" ON "daily_log_delivery_entries"("companyId", "goodsReceiptId");

-- CreateIndex
CREATE INDEX "daily_log_visitor_entries_companyId_dailyLogId_idx" ON "daily_log_visitor_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_delay_entries_companyId_dailyLogId_idx" ON "daily_log_delay_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_delay_entries_companyId_category_idx" ON "daily_log_delay_entries"("companyId", "category");

-- CreateIndex
CREATE INDEX "daily_log_instruction_entries_companyId_dailyLogId_idx" ON "daily_log_instruction_entries"("companyId", "dailyLogId");

-- CreateIndex
CREATE INDEX "daily_log_task_links_companyId_taskId_idx" ON "daily_log_task_links"("companyId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_log_task_links_dailyLogId_taskId_key" ON "daily_log_task_links"("dailyLogId", "taskId");

-- CreateIndex
CREATE INDEX "daily_log_corrections_companyId_dailyLogId_idx" ON "daily_log_corrections"("companyId", "dailyLogId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_log_settings_companyId_key" ON "daily_log_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_daily_log_settings_projectId_key" ON "project_daily_log_settings"("projectId");

-- CreateIndex
CREATE INDEX "project_daily_log_settings_companyId_idx" ON "project_daily_log_settings"("companyId");

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_weather_entries" ADD CONSTRAINT "daily_log_weather_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_workforce_entries" ADD CONSTRAINT "daily_log_workforce_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_work_activities" ADD CONSTRAINT "daily_log_work_activities_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_equipment_entries" ADD CONSTRAINT "daily_log_equipment_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_delivery_entries" ADD CONSTRAINT "daily_log_delivery_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_visitor_entries" ADD CONSTRAINT "daily_log_visitor_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_delay_entries" ADD CONSTRAINT "daily_log_delay_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_instruction_entries" ADD CONSTRAINT "daily_log_instruction_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_task_links" ADD CONSTRAINT "daily_log_task_links_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_document_links" ADD CONSTRAINT "daily_log_document_links_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_corrections" ADD CONSTRAINT "daily_log_corrections_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_log_settings" ADD CONSTRAINT "daily_log_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_daily_log_settings" ADD CONSTRAINT "project_daily_log_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- PRD #44: project phases, milestones, dependencies, blockers, task links and planning settings. Additive only.

-- CreateEnum
CREATE TYPE "ProjectPhaseStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'AT_RISK', 'DELAYED', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectMilestoneType" AS ENUM ('PROJECT_START', 'DESIGN', 'APPROVAL', 'PROCUREMENT', 'CONSTRUCTION', 'INSPECTION', 'COMMISSIONING', 'HANDOVER', 'PAYMENT', 'CONTRACTUAL', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectMilestoneStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'AT_RISK', 'DELAYED', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MilestoneDependencyType" AS ENUM ('FINISH_TO_START');

-- CreateEnum
CREATE TYPE "MilestoneBlockerSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MilestoneTaskLinkType" AS ENUM ('SUPPORTS', 'BLOCKS', 'DELIVERS', 'RELATED');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "planningBaselineLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "planningTemplateKey" TEXT;

-- CreateTable
CREATE TABLE "project_phases" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "plannedStartDate" TIMESTAMP(3),
    "plannedEndDate" TIMESTAMP(3),
    "forecastStartDate" TIMESTAMP(3),
    "forecastEndDate" TIMESTAMP(3),
    "actualStartDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "status" "ProjectPhaseStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progressPercent" DECIMAL(5,2),
    "ownerMemberId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "milestoneType" "ProjectMilestoneType" NOT NULL DEFAULT 'OTHER',
    "status" "ProjectMilestoneStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "ownerMemberId" TEXT,
    "baselineDate" TIMESTAMP(3),
    "plannedDate" TIMESTAMP(3),
    "forecastDate" TIMESTAMP(3),
    "actualDate" TIMESTAMP(3),
    "progressPercent" DECIMAL(5,2),
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "externallyCommitted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "statusChangedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "completedByMemberId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByMemberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestone_dependencies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorMilestoneId" TEXT NOT NULL,
    "successorMilestoneId" TEXT NOT NULL,
    "dependencyType" "MilestoneDependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_milestone_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestone_blockers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "MilestoneBlockerSeverity" NOT NULL DEFAULT 'MEDIUM',
    "ownerMemberId" TEXT,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByMemberId" TEXT,
    "resolutionNote" TEXT,
    "linkedTaskId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_milestone_blockers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestone_task_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "linkType" "MilestoneTaskLinkType" NOT NULL DEFAULT 'SUPPORTS',
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_milestone_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_planning_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "milestoneReminderDays" INTEGER NOT NULL DEFAULT 7,
    "baselineChangeReasonRequired" BOOLEAN NOT NULL DEFAULT true,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_planning_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_phases_companyId_projectId_sortOrder_idx" ON "project_phases"("companyId", "projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "project_phases_companyId_projectId_status_idx" ON "project_phases"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "project_milestones_companyId_projectId_sortOrder_idx" ON "project_milestones"("companyId", "projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "project_milestones_companyId_projectId_status_idx" ON "project_milestones"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "project_milestones_companyId_forecastDate_idx" ON "project_milestones"("companyId", "forecastDate");

-- CreateIndex
CREATE INDEX "project_milestones_companyId_ownerMemberId_status_idx" ON "project_milestones"("companyId", "ownerMemberId", "status");

-- CreateIndex
CREATE INDEX "project_milestones_phaseId_idx" ON "project_milestones"("phaseId");

-- CreateIndex
CREATE INDEX "project_milestone_dependencies_companyId_projectId_idx" ON "project_milestone_dependencies"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_milestone_dependencies_successorMilestoneId_idx" ON "project_milestone_dependencies"("successorMilestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestone_dependencies_predecessorMilestoneId_succe_key" ON "project_milestone_dependencies"("predecessorMilestoneId", "successorMilestoneId");

-- CreateIndex
CREATE INDEX "project_milestone_blockers_companyId_milestoneId_resolvedAt_idx" ON "project_milestone_blockers"("companyId", "milestoneId", "resolvedAt");

-- CreateIndex
CREATE INDEX "project_milestone_blockers_companyId_severity_resolvedAt_idx" ON "project_milestone_blockers"("companyId", "severity", "resolvedAt");

-- CreateIndex
CREATE INDEX "project_milestone_task_links_companyId_taskId_idx" ON "project_milestone_task_links"("companyId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestone_task_links_milestoneId_taskId_key" ON "project_milestone_task_links"("milestoneId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "project_planning_settings_companyId_key" ON "project_planning_settings"("companyId");

-- AddForeignKey
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "project_phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_dependencies" ADD CONSTRAINT "project_milestone_dependencies_predecessorMilestoneId_fkey" FOREIGN KEY ("predecessorMilestoneId") REFERENCES "project_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_dependencies" ADD CONSTRAINT "project_milestone_dependencies_successorMilestoneId_fkey" FOREIGN KEY ("successorMilestoneId") REFERENCES "project_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_blockers" ADD CONSTRAINT "project_milestone_blockers_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "project_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestone_task_links" ADD CONSTRAINT "project_milestone_task_links_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "project_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_planning_settings" ADD CONSTRAINT "project_planning_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


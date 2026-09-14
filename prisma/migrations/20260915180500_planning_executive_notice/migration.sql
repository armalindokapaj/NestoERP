-- PRD #44: the company's choice to tell executives about critical committed milestones.

-- AlterTable
ALTER TABLE "project_planning_settings" ADD COLUMN     "notifyExecutivesOnCriticalChanges" BOOLEAN NOT NULL DEFAULT false;


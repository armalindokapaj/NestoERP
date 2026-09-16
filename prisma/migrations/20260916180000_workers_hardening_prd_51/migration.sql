-- CreateEnum
CREATE TYPE "WorkerProcessStatus" AS ENUM ('RUNNING', 'STOPPING', 'STOPPED');

-- AlterTable
ALTER TABLE "notification_event_outbox" ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "manualRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "worker_heartbeats" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCorrelationId" TEXT,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runStartedAt" TIMESTAMP(3),
ADD COLUMN     "started" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "successes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timeouts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "worker_processes" (
    "workerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "groups" TEXT[],
    "status" "WorkerProcessStatus" NOT NULL DEFAULT 'RUNNING',
    "currentJob" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "worker_processes_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
CREATE TABLE "job_failures" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "attempt" INTEGER NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL,
    "correlationId" TEXT,
    "workerId" TEXT,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retriedAt" TIMESTAMP(3),
    "retriedBy" TEXT,

    CONSTRAINT "job_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_idempotency_keys" (
    "companyId" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_idempotency_keys_pkey" PRIMARY KEY ("companyId","jobKey","key")
);

-- CreateIndex
CREATE INDEX "worker_processes_lastHeartbeatAt_idx" ON "worker_processes"("lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "job_failures_jobKey_failedAt_idx" ON "job_failures"("jobKey", "failedAt");

-- CreateIndex
CREATE INDEX "job_failures_sourceType_sourceId_idx" ON "job_failures"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "job_failures_failedAt_idx" ON "job_failures"("failedAt");

-- CreateIndex
CREATE INDEX "job_idempotency_keys_createdAt_idx" ON "job_idempotency_keys"("createdAt");

-- AddForeignKey
ALTER TABLE "job_idempotency_keys" ADD CONSTRAINT "job_idempotency_keys_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


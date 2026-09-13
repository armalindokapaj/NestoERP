-- AlterTable
ALTER TABLE "worker_heartbeats" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "nextRunAt" TIMESTAMP(3);


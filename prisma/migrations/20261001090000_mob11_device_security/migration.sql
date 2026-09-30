-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DeviceTrustState" AS ENUM ('UNKNOWN', 'TRUSTED', 'AT_RISK', 'NON_COMPLIANT');

-- CreateEnum
CREATE TYPE "DeviceManagedState" AS ENUM ('PERSONAL', 'COMPANY_MANAGED', 'MDM_MANAGED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeviceComplianceState" AS ENUM ('COMPLIANT', 'WARNING', 'NON_COMPLIANT', 'BLOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeviceComplianceAction" AS ENUM ('ALLOW', 'WARN', 'REQUIRE_UPDATE', 'REQUIRE_REAUTH', 'BLOCK');

-- CreateEnum
CREATE TYPE "DeviceDataRemovalMode" AS ENUM ('NONE', 'CACHE_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "MobilePolicyScope" AS ENUM ('PLATFORM', 'PARENT_GROUP', 'COMPANY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_REGISTERED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_REVOKED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_BLOCKED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_RESTORED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_LOST_REPORTED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_DATA_REMOVAL_CONFIRMED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_REAUTH_REQUIRED';
ALTER TYPE "AuthEventType" ADD VALUE 'BIOMETRIC_ENABLED';
ALTER TYPE "AuthEventType" ADD VALUE 'BIOMETRIC_DISABLED';
ALTER TYPE "AuthEventType" ADD VALUE 'POLICY_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'SECURITY_UPDATE_REQUIRED';
ALTER TYPE "AuthEventType" ADD VALUE 'SENSITIVE_REAUTH';

-- DropForeignKey
ALTER TABLE "device_registrations" DROP CONSTRAINT "device_registrations_sessionId_fkey";

-- AlterTable
ALTER TABLE "device_registrations" ADD COLUMN     "appLockEnabled" BOOLEAN,
ADD COLUMN     "complianceAction" "DeviceComplianceAction" NOT NULL DEFAULT 'ALLOW',
ADD COLUMN     "complianceReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "complianceState" "DeviceComplianceState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "dataRemovalConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "dataRemovalMode" "DeviceDataRemovalMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "dataRemovalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deviceClass" TEXT,
ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "installId" TEXT,
ADD COLUMN     "lastSecurityCheckAt" TIMESTAMP(3),
ADD COLUMN     "lostReportedAt" TIMESTAMP(3),
ADD COLUMN     "managedState" "DeviceManagedState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "osVersion" TEXT,
ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "reportedRisk" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" TEXT,
ADD COLUMN     "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trustState" "DeviceTrustState" NOT NULL DEFAULT 'UNKNOWN',
ALTER COLUMN "pushToken" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "recentAuthAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "mobile_security_policies" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scope" "MobilePolicyScope" NOT NULL,
    "parentGroupId" TEXT,
    "companyId" TEXT,
    "settings" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_security_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_security_policies_scopeKey_key" ON "mobile_security_policies"("scopeKey");

-- CreateIndex
CREATE INDEX "mobile_security_policies_parentGroupId_idx" ON "mobile_security_policies"("parentGroupId");

-- CreateIndex
CREATE INDEX "mobile_security_policies_companyId_idx" ON "mobile_security_policies"("companyId");

-- CreateIndex
CREATE INDEX "device_registrations_userId_status_idx" ON "device_registrations"("userId", "status");

-- CreateIndex
CREATE INDEX "device_registrations_lastSeenAt_idx" ON "device_registrations"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_userId_installId_key" ON "device_registrations"("userId", "installId");

-- CreateIndex
CREATE INDEX "sessions_deviceId_idx" ON "sessions"("deviceId");

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_security_policies" ADD CONSTRAINT "mobile_security_policies_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "parent_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_security_policies" ADD CONSTRAINT "mobile_security_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


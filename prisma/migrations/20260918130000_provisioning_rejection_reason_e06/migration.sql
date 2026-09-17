-- E-06 stage 2: why an account request was refused. Additive.

-- AlterTable
ALTER TABLE "user_provisioning_requests" ADD COLUMN     "rejectionReason" TEXT;

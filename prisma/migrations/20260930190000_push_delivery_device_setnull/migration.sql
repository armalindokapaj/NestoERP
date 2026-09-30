-- DropForeignKey
ALTER TABLE "push_deliveries" DROP CONSTRAINT "push_deliveries_deviceRegistrationId_fkey";

-- AlterTable
ALTER TABLE "push_deliveries" ALTER COLUMN "deviceRegistrationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_deviceRegistrationId_fkey" FOREIGN KEY ("deviceRegistrationId") REFERENCES "device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


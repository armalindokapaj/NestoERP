-- E-08 §43, §93: the person's profile photo. Additive: five nullable columns and
-- a check that the object, its type and its checksum are set together. The file
-- is the person's across the group, so it is not a company document; its object
-- sits under `people/<parentGroupId>/<personId>/`.

-- AlterTable
ALTER TABLE "person_profiles" ADD COLUMN     "photoChecksum" TEXT,
ADD COLUMN     "photoContentType" TEXT,
ADD COLUMN     "photoSizeBytes" INTEGER,
ADD COLUMN     "photoStorageKey" TEXT,
ADD COLUMN     "photoUpdatedAt" TIMESTAMP(3);

ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_photo_complete_check"
  CHECK (("photoStorageKey" IS NULL) = ("photoChecksum" IS NULL) AND ("photoStorageKey" IS NULL) = ("photoContentType" IS NULL));

-- CreateEnum
CREATE TYPE "Project3DVisibility" AS ENUM ('OFFLINE', 'PUBLIC', 'COMPANY_ONLY');

-- CreateEnum
CREATE TYPE "Project3DPurgeStatus" AS ENUM ('SCHEDULED', 'CLAIMED', 'PURGED', 'FAILED');

-- AlterTable
ALTER TABLE "project_3d_configs" ADD COLUMN     "accessEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "controlVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "previousVisibility" "Project3DVisibility",
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "purgeAfter" TIMESTAMP(3),
ADD COLUMN     "purgeClaimedAt" TIMESTAMP(3),
ADD COLUMN     "purgeError" TEXT,
ADD COLUMN     "purgeStatus" "Project3DPurgeStatus",
ADD COLUMN     "purgedAt" TIMESTAMP(3),
ADD COLUMN     "visibility" "Project3DVisibility" NOT NULL DEFAULT 'OFFLINE';

-- AlterTable
ALTER TABLE "project_3d_releases" ADD COLUMN     "publicApprovedAt" TIMESTAMP(3),
ADD COLUMN     "publicApprovedByUserId" TEXT,
ADD COLUMN     "publicArtifactKeys" JSONB,
ADD COLUMN     "publicManifest" JSONB,
ADD COLUMN     "publicManifestHash" TEXT,
ADD COLUMN     "publicSchemaVersion" INTEGER;

-- CreateTable
CREATE TABLE "project_3d_mutation_requests" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "outcome" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_3d_mutation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_3d_mutation_requests_createdAt_idx" ON "project_3d_mutation_requests"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_mutation_requests_actorUserId_operation_projectI_key" ON "project_3d_mutation_requests"("actorUserId", "operation", "projectId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_configs_publicId_key" ON "project_3d_configs"("publicId");

-- CreateIndex
CREATE INDEX "project_3d_configs_deletedAt_purgeAfter_idx" ON "project_3d_configs"("deletedAt", "purgeAfter");


-- Every existing experience gets its opaque share identifier.
UPDATE "project_3d_configs"
SET "publicId" = substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 12) || substr(md5(random()::text || "id" || clock_timestamp()::text), 1, 12)
WHERE "publicId" IS NULL;
ALTER TABLE "project_3d_configs" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "project_3d_configs" ALTER COLUMN "publicId" SET DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 24);

-- ADM-04A §12 Part A: keep today's Company-only availability. An experience a
-- company user can open now — a published active release, an active viewer
-- entitlement inside its dates, a live project, company and group — becomes
-- COMPANY_ONLY; everything else stays OFFLINE. Nothing becomes PUBLIC.
UPDATE "project_3d_configs" c
SET "visibility" = 'COMPANY_ONLY'
FROM "project_3d_releases" r, "project_3d_entitlements" e, "projects" p, "companies" co, "parent_groups" g
WHERE r."id" = c."activeReleaseId" AND r."status" = 'PUBLISHED'
  AND e."projectId" = c."projectId" AND e."status" = 'ACTIVE' AND e."viewerEnabled" = true
  AND (e."activatedAt" IS NULL OR e."activatedAt" <= (now() AT TIME ZONE 'UTC'))
  AND (e."expiresAt" IS NULL OR e."expiresAt" > (now() AT TIME ZONE 'UTC'))
  AND p."id" = c."projectId" AND p."archivedAt" IS NULL
  AND co."id" = c."companyId" AND co."status" = 'ACTIVE'
  AND g."id" = co."parentGroupId" AND g."status" IN ('ACTIVE', 'IMPLEMENTING', 'READY_FOR_VALIDATION');

-- ADM-04A §9: nothing under a deleted experience changes — no upload,
-- processing result, binding, slot or release, whichever code path it comes
-- from and however late it runs. The purge job alone opts out, per
-- transaction, to clean up what it owns.
CREATE OR REPLACE FUNCTION project_3d_refuse_deleted() RETURNS trigger AS $$
DECLARE
  target_project text;
BEGIN
  IF current_setting('nesto.project3d_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  target_project := CASE WHEN TG_OP = 'DELETE' THEN OLD."projectId" ELSE NEW."projectId" END;
  IF EXISTS (SELECT 1 FROM "project_3d_configs" WHERE "projectId" = target_project AND "deletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'PROJECT_3D_EXPERIENCE_DELETED' USING ERRCODE = 'P3D01';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_3d_slots_refuse_deleted BEFORE INSERT OR UPDATE OR DELETE ON "project_3d_model_slots" FOR EACH ROW EXECUTE FUNCTION project_3d_refuse_deleted();
CREATE TRIGGER project_3d_versions_refuse_deleted BEFORE INSERT OR UPDATE OR DELETE ON "project_3d_model_versions" FOR EACH ROW EXECUTE FUNCTION project_3d_refuse_deleted();
CREATE TRIGGER project_3d_bindings_refuse_deleted BEFORE INSERT OR UPDATE OR DELETE ON "project_3d_unit_mesh_bindings" FOR EACH ROW EXECUTE FUNCTION project_3d_refuse_deleted();
CREATE TRIGGER project_3d_releases_refuse_deleted BEFORE INSERT OR UPDATE OR DELETE ON "project_3d_releases" FOR EACH ROW EXECUTE FUNCTION project_3d_refuse_deleted();

-- A deleted configuration keeps its draft, release pointer and audience frozen:
-- only restoration (clearing deletedAt) and the purge bookkeeping may change it.
CREATE OR REPLACE FUNCTION project_3d_config_refuse_deleted() RETURNS trigger AS $$
BEGIN
  IF OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS NOT NULL AND (
    NEW."authoringDocument" IS DISTINCT FROM OLD."authoringDocument"
    OR NEW."activeReleaseId" IS DISTINCT FROM OLD."activeReleaseId"
    OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
    OR NEW."experienceName" IS DISTINCT FROM OLD."experienceName"
  ) THEN
    RAISE EXCEPTION 'PROJECT_3D_EXPERIENCE_DELETED' USING ERRCODE = 'P3D01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_3d_configs_refuse_deleted BEFORE UPDATE ON "project_3d_configs" FOR EACH ROW EXECUTE FUNCTION project_3d_config_refuse_deleted();

-- CreateEnum
CREATE TYPE "Project3DEntitlementStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Project3DModelSlotKind" AS ENUM ('MAP', 'DETAIL');

-- CreateEnum
CREATE TYPE "Project3DModelSlotRole" AS ENUM ('BUILDING', 'UNITS', 'SURROUNDINGS', 'CONTEXT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "Project3DModelVersionStatus" AS ENUM ('DRAFT', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Project3DValidationStatus" AS ENUM ('PENDING', 'READY', 'WARNING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Project3DUnitMappingStatus" AS ENUM ('MAPPED', 'CARRIED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "Project3DReleaseStatus" AS ENUM ('PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "project_3d_entitlements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "Project3DEntitlementStatus" NOT NULL DEFAULT 'INACTIVE',
    "planKey" TEXT,
    "viewerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "provisionedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_3d_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_3d_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "authoringDocument" JSONB NOT NULL,
    "activeReleaseId" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_3d_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_3d_model_slots" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "kind" "Project3DModelSlotKind" NOT NULL DEFAULT 'DETAIL',
    "role" "Project3DModelSlotRole" NOT NULL,
    "slotKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "transformParentSlotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_3d_model_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_3d_model_versions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "sourceStorageKey" TEXT NOT NULL,
    "runtimeStorageKey" TEXT,
    "storageProvider" TEXT NOT NULL,
    "sourceSizeBytes" BIGINT NOT NULL,
    "runtimeSizeBytes" BIGINT,
    "sourceContentType" TEXT NOT NULL,
    "runtimeContentType" TEXT,
    "sourceChecksum" TEXT,
    "runtimeChecksum" TEXT,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rotationDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "altitudeOffset" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotationXDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotationZDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "castShadow" BOOLEAN NOT NULL DEFAULT true,
    "receiveShadow" BOOLEAN NOT NULL DEFAULT true,
    "selectable" BOOLEAN NOT NULL DEFAULT true,
    "transformLocked" BOOLEAN NOT NULL DEFAULT false,
    "validationStatus" "Project3DValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validationIssues" JSONB,
    "processingDiagnostics" JSONB,
    "sceneManifest" JSONB,
    "nodeOverrides" JSONB,
    "experienceSnapshot" JSONB,
    "status" "Project3DModelVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "uploadedByUserId" TEXT NOT NULL,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_3d_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_3d_unit_mesh_bindings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "projectUnitId" TEXT NOT NULL,
    "meshName" TEXT NOT NULL,
    "mappingStatus" "Project3DUnitMappingStatus" NOT NULL DEFAULT 'MAPPED',
    "poiYawDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "poiDistanceOverride" DOUBLE PRECISION,
    "poiHeightOverride" DOUBLE PRECISION,
    "mappedByUserId" TEXT NOT NULL,
    "mappedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_3d_unit_mesh_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_3d_releases" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "releaseNumber" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "experienceSnapshot" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "status" "Project3DReleaseStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedByUserId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_3d_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_3d_environment_presets" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "configuration" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_3d_environment_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_entitlements_projectId_key" ON "project_3d_entitlements"("projectId");

-- CreateIndex
CREATE INDEX "project_3d_entitlements_companyId_status_idx" ON "project_3d_entitlements"("companyId", "status");

-- CreateIndex
CREATE INDEX "project_3d_entitlements_status_expiresAt_idx" ON "project_3d_entitlements"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_entitlements_projectId_companyId_key" ON "project_3d_entitlements"("projectId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_configs_projectId_key" ON "project_3d_configs"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_configs_activeReleaseId_key" ON "project_3d_configs"("activeReleaseId");

-- CreateIndex
CREATE INDEX "project_3d_configs_companyId_idx" ON "project_3d_configs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_configs_id_projectId_companyId_key" ON "project_3d_configs"("id", "projectId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_configs_projectId_companyId_key" ON "project_3d_configs"("projectId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_configs_activeReleaseId_projectId_companyId_key" ON "project_3d_configs"("activeReleaseId", "projectId", "companyId");

-- CreateIndex
CREATE INDEX "project_3d_model_slots_companyId_projectId_isActive_idx" ON "project_3d_model_slots"("companyId", "projectId", "isActive");

-- CreateIndex
CREATE INDEX "project_3d_model_slots_configId_sortOrder_idx" ON "project_3d_model_slots"("configId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_model_slots_projectId_slotKey_key" ON "project_3d_model_slots"("projectId", "slotKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_model_slots_id_projectId_companyId_key" ON "project_3d_model_slots"("id", "projectId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_model_versions_sourceStorageKey_key" ON "project_3d_model_versions"("sourceStorageKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_model_versions_runtimeStorageKey_key" ON "project_3d_model_versions"("runtimeStorageKey");

-- CreateIndex
CREATE INDEX "project_3d_model_versions_companyId_projectId_status_idx" ON "project_3d_model_versions"("companyId", "projectId", "status");

-- CreateIndex
CREATE INDEX "project_3d_model_versions_slotId_status_idx" ON "project_3d_model_versions"("slotId", "status");

-- CreateIndex
CREATE INDEX "project_3d_model_versions_validationStatus_idx" ON "project_3d_model_versions"("validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_model_versions_slotId_version_key" ON "project_3d_model_versions"("slotId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_model_versions_id_projectId_companyId_key" ON "project_3d_model_versions"("id", "projectId", "companyId");

-- CreateIndex
CREATE INDEX "project_3d_unit_mesh_bindings_companyId_projectId_idx" ON "project_3d_unit_mesh_bindings"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_3d_unit_mesh_bindings_projectUnitId_idx" ON "project_3d_unit_mesh_bindings"("projectUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_unit_mesh_bindings_modelVersionId_meshName_key" ON "project_3d_unit_mesh_bindings"("modelVersionId", "meshName");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_unit_mesh_bindings_modelVersionId_projectUnitId_key" ON "project_3d_unit_mesh_bindings"("modelVersionId", "projectUnitId");

-- CreateIndex
CREATE INDEX "project_3d_releases_companyId_projectId_publishedAt_idx" ON "project_3d_releases"("companyId", "projectId", "publishedAt");

-- CreateIndex
CREATE INDEX "project_3d_releases_configId_idx" ON "project_3d_releases"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_releases_projectId_releaseNumber_key" ON "project_3d_releases"("projectId", "releaseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "project_3d_releases_id_projectId_companyId_key" ON "project_3d_releases"("id", "projectId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_3d_environment_presets_key_key" ON "platform_3d_environment_presets"("key");

-- CreateIndex
CREATE INDEX "platform_3d_environment_presets_isActive_name_idx" ON "platform_3d_environment_presets"("isActive", "name");

-- AddForeignKey
ALTER TABLE "project_3d_entitlements" ADD CONSTRAINT "project_3d_entitlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_entitlements" ADD CONSTRAINT "project_3d_entitlements_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_configs" ADD CONSTRAINT "project_3d_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_configs" ADD CONSTRAINT "project_3d_configs_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_configs" ADD CONSTRAINT "project_3d_configs_activeReleaseId_projectId_companyId_fkey" FOREIGN KEY ("activeReleaseId", "projectId", "companyId") REFERENCES "project_3d_releases"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_slots" ADD CONSTRAINT "project_3d_model_slots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_slots" ADD CONSTRAINT "project_3d_model_slots_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_slots" ADD CONSTRAINT "project_3d_model_slots_configId_projectId_companyId_fkey" FOREIGN KEY ("configId", "projectId", "companyId") REFERENCES "project_3d_configs"("id", "projectId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_slots" ADD CONSTRAINT "project_3d_model_slots_transformParentSlotId_fkey" FOREIGN KEY ("transformParentSlotId") REFERENCES "project_3d_model_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_versions" ADD CONSTRAINT "project_3d_model_versions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_versions" ADD CONSTRAINT "project_3d_model_versions_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_model_versions" ADD CONSTRAINT "project_3d_model_versions_slotId_projectId_companyId_fkey" FOREIGN KEY ("slotId", "projectId", "companyId") REFERENCES "project_3d_model_slots"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_unit_mesh_bindings" ADD CONSTRAINT "project_3d_unit_mesh_bindings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_unit_mesh_bindings" ADD CONSTRAINT "project_3d_unit_mesh_bindings_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_unit_mesh_bindings" ADD CONSTRAINT "project_3d_unit_mesh_bindings_modelVersionId_projectId_com_fkey" FOREIGN KEY ("modelVersionId", "projectId", "companyId") REFERENCES "project_3d_model_versions"("id", "projectId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_unit_mesh_bindings" ADD CONSTRAINT "project_3d_unit_mesh_bindings_projectUnitId_projectId_comp_fkey" FOREIGN KEY ("projectUnitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_releases" ADD CONSTRAINT "project_3d_releases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_releases" ADD CONSTRAINT "project_3d_releases_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_3d_releases" ADD CONSTRAINT "project_3d_releases_configId_projectId_companyId_fkey" FOREIGN KEY ("configId", "projectId", "companyId") REFERENCES "project_3d_configs"("id", "projectId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

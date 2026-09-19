-- CreateEnum
CREATE TYPE "FeatureFlagState" AS ENUM ('OFF', 'ON', 'BETA');

-- CreateEnum
CREATE TYPE "FeatureFlagScopeType" AS ENUM ('PLATFORM', 'GROUP', 'COMPANY', 'USER');

-- CreateEnum
CREATE TYPE "ThreeDProjectStatus" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR');

-- CreateEnum
CREATE TYPE "ThreeDModelStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultState" "FeatureFlagState" NOT NULL DEFAULT 'OFF',
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag_overrides" (
    "id" TEXT NOT NULL,
    "featureFlagId" TEXT NOT NULL,
    "scopeType" "FeatureFlagScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "state" "FeatureFlagState" NOT NULL,
    "reason" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "support_access_sessions" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "parentGroupId" TEXT,
    "companyId" TEXT,
    "projectId" TEXT,
    "targetUserId" TEXT,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_access_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "three_d_project_configurations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ThreeDProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "sceneConfiguration" JSONB,
    "publishedVersionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "three_d_project_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "three_d_model_versions" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "storageKey" TEXT,
    "checksum" TEXT,
    "status" "ThreeDModelStatus" NOT NULL DEFAULT 'UPLOADED',
    "diagnostics" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "three_d_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "feature_flags_archivedAt_idx" ON "feature_flags"("archivedAt");

-- CreateIndex
CREATE INDEX "feature_flag_overrides_scopeType_scopeId_idx" ON "feature_flag_overrides"("scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_overrides_featureFlagId_scopeType_scopeId_key" ON "feature_flag_overrides"("featureFlagId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "platform_settings_category_idx" ON "platform_settings"("category");

-- CreateIndex
CREATE INDEX "support_access_sessions_actorUserId_expiresAt_idx" ON "support_access_sessions"("actorUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "support_access_sessions_parentGroupId_idx" ON "support_access_sessions"("parentGroupId");

-- CreateIndex
CREATE INDEX "support_access_sessions_companyId_idx" ON "support_access_sessions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "three_d_project_configurations_projectId_key" ON "three_d_project_configurations"("projectId");

-- CreateIndex
CREATE INDEX "three_d_project_configurations_status_idx" ON "three_d_project_configurations"("status");

-- CreateIndex
CREATE INDEX "three_d_model_versions_status_idx" ON "three_d_model_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "three_d_model_versions_configurationId_version_key" ON "three_d_model_versions"("configurationId", "version");

-- AddForeignKey
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_d_project_configurations" ADD CONSTRAINT "three_d_project_configurations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_d_model_versions" ADD CONSTRAINT "three_d_model_versions_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "three_d_project_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

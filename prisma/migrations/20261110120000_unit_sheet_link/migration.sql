-- CreateTable
CREATE TABLE "project_unit_sheet_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetGid" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT,
    "linkedByMemberId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedByMemberId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_unit_sheet_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_unit_sheet_baselines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_unit_sheet_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_unit_sheet_links_companyId_idx" ON "project_unit_sheet_links"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_unit_sheet_links_projectId_key" ON "project_unit_sheet_links"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_unit_sheet_links_id_projectId_companyId_key" ON "project_unit_sheet_links"("id", "projectId", "companyId");

-- CreateIndex
CREATE INDEX "project_unit_sheet_baselines_unitId_idx" ON "project_unit_sheet_baselines"("unitId");

-- CreateIndex
CREATE INDEX "project_unit_sheet_baselines_companyId_projectId_idx" ON "project_unit_sheet_baselines"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_unit_sheet_baselines_linkId_unitId_key" ON "project_unit_sheet_baselines"("linkId", "unitId");

-- AddForeignKey
ALTER TABLE "project_unit_sheet_links" ADD CONSTRAINT "project_unit_sheet_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_unit_sheet_links" ADD CONSTRAINT "project_unit_sheet_links_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_unit_sheet_baselines" ADD CONSTRAINT "project_unit_sheet_baselines_linkId_projectId_companyId_fkey" FOREIGN KEY ("linkId", "projectId", "companyId") REFERENCES "project_unit_sheet_links"("id", "projectId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_unit_sheet_baselines" ADD CONSTRAINT "project_unit_sheet_baselines_unitId_projectId_companyId_fkey" FOREIGN KEY ("unitId", "projectId", "companyId") REFERENCES "project_units"("id", "projectId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;


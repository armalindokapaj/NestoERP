-- CreateEnum
CREATE TYPE "ProjectMediaType" AS ENUM ('RENDER', 'ANIMATION');

-- CreateEnum
CREATE TYPE "ProjectMediaVisibility" AS ENUM ('PROJECT');

-- CreateTable
CREATE TABLE "project_media" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" "ProjectMediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailDocumentId" TEXT,
    "durationSeconds" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "ProjectMediaVisibility" NOT NULL DEFAULT 'PROJECT',
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_media_projectId_documentId_key" ON "project_media"("projectId", "documentId");

-- At most one ProjectMedia row is the cover for a project. PostgreSQL's
-- partial unique index models the 0..1 rule without making false values unique.
CREATE UNIQUE INDEX "project_media_one_cover_per_project" ON "project_media"("projectId") WHERE "isCover" = true;

-- CreateIndex
CREATE INDEX "project_media_companyId_projectId_type_sortOrder_idx" ON "project_media"("companyId", "projectId", "type", "sortOrder");

-- CreateIndex
CREATE INDEX "project_media_documentId_idx" ON "project_media"("documentId");

-- CreateIndex
CREATE INDEX "project_media_thumbnailDocumentId_idx" ON "project_media"("thumbnailDocumentId");

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_thumbnailDocumentId_fkey" FOREIGN KEY ("thumbnailDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

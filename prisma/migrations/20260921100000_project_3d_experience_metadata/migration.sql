ALTER TABLE "project_3d_configs"
ADD COLUMN "experienceName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "internalNotes" TEXT;

UPDATE "project_3d_configs" AS config
SET "experienceName" = project."name" || ' 3D Experience'
FROM "projects" AS project
WHERE project."id" = config."projectId"
  AND config."experienceName" = '';

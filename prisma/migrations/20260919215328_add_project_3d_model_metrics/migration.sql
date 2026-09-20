-- AlterTable
ALTER TABLE "project_3d_model_versions" ADD COLUMN     "materialCount" INTEGER,
ADD COLUMN     "meshCount" INTEGER,
ADD COLUMN     "textureCount" INTEGER,
ADD COLUMN     "triangleCount" INTEGER,
ADD COLUMN     "unitNodeNames" JSONB;

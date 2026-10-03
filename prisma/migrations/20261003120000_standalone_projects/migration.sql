-- Standalone projects (Standalone Project & Deferred Company Assignment PRD).
-- A project may exist with no company: companyId NULL is the unassigned state.
-- Every existing project keeps its company; nothing here rewrites a row.
ALTER TABLE "projects" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "projects" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN "assignedBy" TEXT;

-- (companyId, code) cannot guard unassigned projects: NULLs never collide.
-- Their codes are unique among themselves instead (PRD §48).
CREATE UNIQUE INDEX "projects_unassigned_code_key" ON "projects"("code") WHERE "companyId" IS NULL;

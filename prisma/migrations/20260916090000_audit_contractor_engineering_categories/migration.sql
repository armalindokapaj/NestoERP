-- Audit categories for contractor and engineering records (PRD #46 §229).
-- Enum values are added in their own migration so later ones can use them.
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'CONTRACTOR';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'ENGINEERING';

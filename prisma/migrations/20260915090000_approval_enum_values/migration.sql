-- PRD #41: a RETURNED outcome for module approvals, and an APPROVAL audit category.
-- Enum values are added on their own, ahead of anything that could use them.

ALTER TYPE "AuditCategory" ADD VALUE 'APPROVAL';
ALTER TYPE "ContractApprovalStatus" ADD VALUE 'RETURNED';
ALTER TYPE "FinanceApprovalStatus" ADD VALUE 'RETURNED';
ALTER TYPE "ProcurementApprovalStatus" ADD VALUE 'RETURNED';
ALTER TYPE "SalesApprovalStatus" ADD VALUE 'RETURNED';

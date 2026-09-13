-- Sales quote to invoice (PRD #35 §180).
--
-- An invoice drawn from an accepted proposal records which one. Nullable
-- because most invoices have no proposal behind them, and SET NULL because an
-- invoice outlives the proposal that prompted it: losing the provenance is
-- acceptable, losing the invoice is not.
--
-- Purely additive. Nothing is dropped and no existing row changes.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "sourceProposalId" TEXT;

-- CreateIndex
CREATE INDEX "invoices_sourceProposalId_idx" ON "invoices"("sourceProposalId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sourceProposalId_fkey" FOREIGN KEY ("sourceProposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "commitments_companyId_sourceModule_sourceEntityType_sourceE_key" ON "commitments"("companyId", "sourceModule", "sourceEntityType", "sourceEntityId");


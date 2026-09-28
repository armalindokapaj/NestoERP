-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recoveryEmail" TEXT,
ADD COLUMN     "recoveryEmailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "recovery_email_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_email_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_challenges_tokenHash_key" ON "recovery_email_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "recovery_email_challenges_userId_idx" ON "recovery_email_challenges"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_recoveryEmail_key" ON "users"("recoveryEmail");

-- AddForeignKey
ALTER TABLE "recovery_email_challenges" ADD CONSTRAINT "recovery_email_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


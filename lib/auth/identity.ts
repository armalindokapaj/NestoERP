import type { Prisma, UserStatus } from "@prisma/client";

import { hashPassword } from "./password";

/**
 * Writes to the identity itself (PRD #48 §11, §300).
 *
 * `User` is Auth's record. Three other places need to change one — a person
 * changing their own password, a person who forgot it, and somebody accepting
 * an invitation — and each of them was hashing and writing on its own. A
 * credential is exactly the wrong thing to have three implementations of: the
 * cost factor, the fields cleared alongside the hash, and the invalidation of
 * outstanding reset links all have to agree, every time (PRD #48 §14, §251).
 *
 * All of these take the caller's transaction, because a password change is
 * never the only thing happening: it commits with the audit entry that records
 * it and with the sessions it ends (PRD #48 §24, §120).
 */

/**
 * Sets a password and voids every outstanding reset link for that account.
 *
 * A reset link is a way back into the account. Leaving one live after the
 * password has changed leaves the previous holder a door (PRD #6 §58).
 *
 * The caller decides what else must happen — revoking sessions, recording the
 * audit entry — because who is signed out differs between "I changed my own
 * password" and "I had forgotten it".
 */
export async function setPassword(
  tx: Prisma.TransactionClient,
  userId: string,
  plainPassword: string,
): Promise<void> {
  const passwordHash = await hashPassword(plainPassword);
  await tx.user.update({ where: { id: userId }, data: { passwordHash } });
  await voidResetTokens(tx, userId);
}

/** Every unused reset link for an account, spent (PRD #6 §58). */
export async function voidResetTokens(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
}

/**
 * The account behind a newly accepted invitation.
 *
 * The invitation decided the address; nothing else about this differs from any
 * other account, which is the point of it being written here.
 */
export async function createUserForInvite(
  tx: Prisma.TransactionClient,
  input: { email: string; firstName: string; lastName: string; password: string },
): Promise<{ id: string; status: UserStatus; firstName: string; lastName: string }> {
  return tx.user.create({
    data: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: await hashPassword(input.password),
      status: "ACTIVE",
    },
    select: { id: true, status: true, firstName: true, lastName: true },
  });
}

/** The sign-in stamp. Written by the credentials flow and nowhere else. */
export async function recordSignIn(
  client: Pick<Prisma.TransactionClient, "user">,
  userId: string,
): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

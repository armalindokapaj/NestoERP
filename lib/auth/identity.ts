import { randomUUID } from "node:crypto";

import { suggestUsername, usernameProblem } from "./username";
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
  // Choosing a password clears whatever forced the choice: the temporary one
  // is spent, and the account is no longer held at the change screen
  // (PRD #50 §19, §270).
  await tx.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, temporaryPasswordExpiresAt: null },
  });
  await voidResetTokens(tx, userId);
}

/**
 * A password somebody else chose, which its holder must replace
 * (PRD #50 §16, §17, §20).
 *
 * Auth's door for an administrator resetting an account: the credential, the
 * forced change and the expiry are one write, because an account left holding
 * a temporary password with no expiry and no obligation to change it is just
 * an account whose password an administrator knows.
 */
export async function setTemporaryPassword(
  tx: Prisma.TransactionClient,
  userId: string,
  plainPassword: string,
  expiresAt: Date,
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(plainPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      temporaryPasswordExpiresAt: expiresAt,
    },
  });
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
 * A username nobody else holds (PRD #50 §7).
 *
 * The suggestion comes from the person's name; where it is taken, a number is
 * appended until one is free. The loop is bounded because the caller is inside
 * a transaction and an unbounded search under contention is a lock held for
 * however long it takes — past the bound the account gets a name derived from
 * nothing, which is ugly and always available.
 */
export async function allocateUsername(
  tx: Prisma.TransactionClient,
  firstName: string,
  lastName: string,
): Promise<string> {
  const base = suggestUsername(firstName, lastName);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    if (usernameProblem(candidate)) continue;
    const taken = await tx.user.count({ where: { username: candidate } });
    if (taken === 0) return candidate;
  }
  return `user.${randomUUID().slice(0, 12)}`;
}

/**
 * The account behind a newly accepted invitation.
 *
 * The invitation decided the address, which is now contact metadata rather
 * than the way in (PRD #50 §66, §67): the account gets a username derived from
 * the person's name, and that is what they sign in with.
 */
export async function createUserForInvite(
  tx: Prisma.TransactionClient,
  input: { email: string; firstName: string; lastName: string; password: string },
): Promise<{ id: string; username: string; status: UserStatus; firstName: string; lastName: string }> {
  return tx.user.create({
    data: {
      username: await allocateUsername(tx, input.firstName, input.lastName),
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: await hashPassword(input.password),
      status: "ACTIVE",
    },
    select: { id: true, username: true, status: true, firstName: true, lastName: true },
  });
}

/** The sign-in stamp. Written by the credentials flow and nowhere else. */
export async function recordSignIn(
  client: Pick<Prisma.TransactionClient, "user">,
  userId: string,
): Promise<void> {
  await client.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

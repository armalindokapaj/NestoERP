import bcrypt from "bcryptjs";

/**
 * Password hashing (PRD #6 §29).
 *
 * bcrypt with a cost of 12. The PRD names Argon2id as its example; bcrypt is
 * used here because it needs no native build step, which keeps `pnpm install`
 * working identically on every developer machine and in CI. Swapping the
 * implementation means changing this file only — nothing else touches a hash.
 */
const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

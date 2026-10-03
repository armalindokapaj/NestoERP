import { randomInt } from "node:crypto";

/**
 * Temporary passwords (PRD #50 §16, §17).
 *
 * Generated here rather than chosen by the administrator issuing it, so the
 * credential is not something a person invented under time pressure and is not
 * one they can predict for somebody else's account.
 *
 * The alphabet leaves out the characters people confuse when a password is
 * being read down a telephone or copied off a screen — `0`/`O`, `1`/`l`/`I` —
 * because that is exactly how these get delivered (§18).
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * The password every new account starts with. Platform decision: new users sign
 * in with it, are warned on every sign-in until they choose their own, and it
 * never lapses. Resets still issue a generated one-off password.
 */
export const DEFAULT_PASSWORD = "nesto1234";

/** Four groups of four, hyphenated: long enough to resist guessing, short enough to dictate. */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let group = 0; group < 4; group += 1) {
    let chunk = "";
    for (let index = 0; index < 4; index += 1) {
      chunk += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(chunk);
  }
  return groups.join("-");
}

/** How long one stays usable (§17). Long enough to pass on, short enough to matter. */
export const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

export function temporaryPasswordExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TEMPORARY_PASSWORD_TTL_MS);
}

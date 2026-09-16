/**
 * The login identifier (PRD #50 §6-§9).
 *
 * A username is stored already normalised, so "Owner", " owner " and "owner"
 * are the same account rather than three. Normalisation happens once, on the
 * way in; every lookup normalises the input the same way and compares exactly,
 * which keeps the unique index doing the work rather than a case-insensitive
 * scan.
 */

/** Letters, digits, and the three separators people actually use. */
const SHAPE = /^[a-z0-9]([a-z0-9._-]{1,30})[a-z0-9]$/;

/**
 * Names the platform keeps for itself (§9).
 *
 * The risk is impersonation: a person signing messages as `support` or
 * `system` is claiming to be NESTO. The list governs what may be *chosen* —
 * accounts that predate it keep the name they were migrated with, which is
 * why the demo's company administrator still signs in as `admin`.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "root", "system", "support", "nesto", "api",
  "worker", "help", "security", "billing", "postmaster", "webmaster", "noreply",
]);

/**
 * Trim, NFKC, lowercase (§8).
 *
 * NFKC first, so visually identical characters from different Unicode blocks
 * collapse to one form before the comparison — otherwise `admin` written with
 * a fullwidth `ａ` would be a second, different account that looks the same in
 * every list it appears in.
 */
export function normaliseUsername(input: string): string {
  return input.normalize("NFKC").trim().toLowerCase();
}

export type UsernameProblem = "EMPTY" | "SHAPE" | "RESERVED";

/** What is wrong with a username, or null when nothing is (§7). */
export function usernameProblem(input: string): UsernameProblem | null {
  const normalised = normaliseUsername(input);
  if (normalised.length === 0) return "EMPTY";
  if (!SHAPE.test(normalised)) return "SHAPE";
  if (RESERVED_USERNAMES.has(normalised)) return "RESERVED";
  return null;
}

export const USERNAME_MESSAGES: Record<UsernameProblem, string> = {
  EMPTY: "Enter a username.",
  SHAPE: "Use 3 to 32 characters: letters, numbers, and . _ - between them.",
  RESERVED: "That username is kept for the system. Choose another.",
};

/**
 * A username derived from somebody's name, for an administrator creating an
 * account who has not been given one to use (§58).
 *
 * Accents are folded rather than dropped: Krasniqi and Ünal are ordinary names
 * where this is deployed, and `ünal` must suggest `unal`, not `nal`. That is a
 * different operation from `normaliseUsername`, which compares what somebody
 * typed and must not quietly turn one name into another.
 *
 * Returns a candidate; the caller still has to find out whether it is taken,
 * because only the database can answer that.
 */
export function suggestUsername(firstName: string, lastName: string): string {
  const clean = (part: string) =>
    part
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const parts = [clean(firstName), clean(lastName)].filter(Boolean);
  const joined = parts.join(".");
  // Nothing usable came out of the name — an account still needs a name, and
  // the caller resolves the collision this will almost certainly have.
  if (joined.length === 0) return "user.account";
  return (joined.length >= 3 ? joined : `${joined}.user`).slice(0, 32).replace(/[._-]+$/, "");
}

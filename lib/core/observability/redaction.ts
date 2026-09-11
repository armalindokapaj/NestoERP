/**
 * Log redaction (PRD #32 §46-§51).
 *
 * Logs are read by engineers, so they must not contain what an engineer has no
 * business seeing: credentials, bearer capabilities, or the contents of a
 * customer's confidential record (PRD #32 §47).
 */

const SECRET_KEYS = [
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "resettoken",
  "invitetoken",
  "authorization",
  "cookie",
  "secret",
  "apikey",
  "signedurl",
  "url",
  "privatekey",
  "credentials",
];

export const MASK = "[redacted]";

function isSecret(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, "");
  return SECRET_KEYS.some((secret) => normalised === secret || normalised.endsWith(secret));
}

/** Recursive, cycle-safe, and bounded so a logger can never crash a request. */
export function redact(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecret(key) ? MASK : redact(entry, seen, depth + 1);
  }
  return out;
}

/**
 * Audit redaction (PRD #28 §37-§44).
 *
 * Audit must not become a second copy of the database holding every sensitive
 * value. Anything on the denylist never reaches storage at all, and fields a
 * policy marks sensitive are recorded as "this changed" without the value.
 */

/** Never stored, whatever a caller passes (PRD #28 §38). */
const NEVER_STORE = [
  "password",
  "passwordhash",
  "passwordconfirmation",
  "token",
  "tokenhash",
  "sessiontoken",
  "resettoken",
  "invitetoken",
  "secret",
  "apikey",
  "apisecret",
  "authorization",
  "cookie",
  "privatekey",
  "signedurl",
  "storagekey",
  "cardnumber",
  "iban",
  "bankaccount",
  "medicaldiagnosis",
  "diagnosis",
];

export const REDACTED = "[REDACTED]";

function isForbidden(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, "");
  return NEVER_STORE.some((forbidden) => normalised.includes(forbidden));
}

/**
 * Reduces an object to the fields a policy allows, dropping forbidden keys
 * outright and masking the ones it marks sensitive.
 */
export function applyRedaction(
  source: Record<string, unknown> | null | undefined,
  allowFields: string[],
  redactFields: string[] = [],
): Record<string, unknown> | null {
  if (!source) return null;

  const out: Record<string, unknown> = {};
  for (const field of allowFields) {
    if (!(field in source)) continue;
    if (isForbidden(field)) continue;
    out[field] = redactFields.includes(field) ? REDACTED : normalise(source[field]);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Decimal and Date reach audit as exact strings: a float would lose money and a
 * Date would serialise differently per runtime (PRD #28 §199, §200).
 */
function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toFixed" in value) return String(value);
  if (typeof value === "object") return JSON.parse(JSON.stringify(value));
  return value;
}

export { normalise };

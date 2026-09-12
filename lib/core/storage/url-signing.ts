import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived URL signing for the local storage adapter (PRD #29 §72).
 *
 * A signed URL is a bearer token: whoever holds it can perform exactly one
 * operation on exactly one object until it expires. That is true of an S3
 * presigned URL and it is true here, which is the point — the local adapter
 * behaves the way the production one does, so the upload flow under test is
 * the upload flow that ships (PRD #29 §117, §118).
 *
 * What the signature covers is what makes it safe:
 *
 *   the method     an upload grant cannot be replayed as a download
 *   the key        a grant for one object cannot address another (§360)
 *   the expiry     rewriting it invalidates the signature (§370)
 *   the size cap   the browser cannot send more than was authorised (§310)
 *
 * The full URL never reaches a log (PRD #29 §73, §257).
 */

const CLOCK_SKEW_MS = 5_000;

export type SignedUrlClaims = {
  method: "PUT" | "GET";
  storageKey: string;
  expiresAt: number;
  maxBytes?: number;
  contentType?: string;
  disposition?: "inline" | "attachment";
  fileName?: string;
};

/**
 * The signing secret.
 *
 * Deliberately a dedicated variable falling back to the auth secret, so a
 * deployment can rotate storage grants without invalidating every session
 * (PRD #29 §113).
 */
function signingSecret(): string {
  const secret =
    process.env.STORAGE_URL_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;

  if (!secret || secret.length < 16) {
    throw new Error("Storage URL signing requires STORAGE_URL_SECRET or AUTH_SECRET.");
  }
  return secret;
}

/** A stable, ordered serialisation. Field order cannot drift between sign and verify. */
function canonicalise(claims: SignedUrlClaims): string {
  return [
    claims.method,
    claims.storageKey,
    String(claims.expiresAt),
    String(claims.maxBytes ?? ""),
    claims.contentType ?? "",
    claims.disposition ?? "",
    claims.fileName ?? "",
  ].join("\n");
}

export function signClaims(claims: SignedUrlClaims): string {
  return createHmac("sha256", signingSecret()).update(canonicalise(claims)).digest("hex");
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "SIGNATURE_INVALID" | "EXPIRED" };

/**
 * Verifies a presented signature against the claims in the same URL.
 *
 * Compared in constant time, because a signature check that leaks how many
 * leading bytes matched is a signature check that can be walked
 * (PRD #29 §365).
 */
export function verifyClaims(
  claims: SignedUrlClaims,
  signature: string,
  now: number = Date.now(),
): VerifyResult {
  let expected: string;
  try {
    expected = signClaims(claims);
  } catch {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  const presented = Buffer.from(signature ?? "", "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (presented.length !== computed.length || !timingSafeEqual(presented, computed)) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  // The expiry is checked after the signature, so an attacker cannot use the
  // response to distinguish a forged URL from a stale one.
  if (claims.expiresAt + CLOCK_SKEW_MS < now) return { ok: false, reason: "EXPIRED" };

  return { ok: true };
}

/** Builds the query string carrying a grant. Never logged whole (§73). */
export function encodeClaims(claims: SignedUrlClaims): URLSearchParams {
  const params = new URLSearchParams({
    m: claims.method,
    exp: String(claims.expiresAt),
    sig: signClaims(claims),
  });
  if (claims.maxBytes !== undefined) params.set("max", String(claims.maxBytes));
  if (claims.contentType) params.set("ct", claims.contentType);
  if (claims.disposition) params.set("cd", claims.disposition);
  if (claims.fileName) params.set("fn", claims.fileName);
  return params;
}

/** Reads a grant back out of a request URL. */
export function decodeClaims(
  storageKey: string,
  params: URLSearchParams,
): { claims: SignedUrlClaims; signature: string } | null {
  const method = params.get("m");
  const expiresAt = Number(params.get("exp"));
  const signature = params.get("sig");

  if ((method !== "PUT" && method !== "GET") || !Number.isFinite(expiresAt) || !signature) {
    return null;
  }

  const maxRaw = params.get("max");
  const disposition = params.get("cd");

  return {
    claims: {
      method,
      storageKey,
      expiresAt,
      maxBytes: maxRaw === null ? undefined : Number(maxRaw),
      contentType: params.get("ct") ?? undefined,
      disposition: disposition === "inline" || disposition === "attachment" ? disposition : undefined,
      fileName: params.get("fn") ?? undefined,
    },
    signature,
  };
}

import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, query-string form (PRD #29 §5, §359).
 *
 * Written out rather than pulled in as an SDK: presigning is a hash chain over
 * a canonical request, it is a few dozen lines, and it is verifiable against
 * AWS's own published test vectors — which the unit tests do. That keeps the
 * dependency surface of the storage layer at zero and works unchanged against
 * S3, R2, MinIO, B2 and Spaces (PRD #29 §5, §6).
 */

export type SigV4Config = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
};

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const sha256Hex = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const hmac = (key: Uint8Array | string, value: string): Buffer =>
  createHmac("sha256", key).update(value, "utf8").digest();

/**
 * RFC 3986 encoding.
 *
 * `encodeURIComponent` leaves `!'()*` alone and AWS does not, so those are
 * finished by hand. Getting this wrong produces a signature mismatch on
 * exactly the keys with unusual characters, which is the worst kind of bug to
 * find in production.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return encodeSlash ? encoded : encoded.replace(/%2F/g, "/");
}

/** `20130524T000000Z` and `20130524`. */
export function amzDates(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function signingKey(config: SigV4Config, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, config.service);
  return hmac(kService, "aws4_request");
}

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  host: string;
  /** Absolute object path, already prefixed with the bucket for path-style. */
  path: string;
  /** Extra query parameters to bind into the signature. */
  query?: Record<string, string>;
  expiresInSeconds: number;
  now?: Date;
};

/**
 * Produces the signed query string for one request.
 *
 * Only `host` is signed. Binding more headers would mean the browser had to
 * reproduce them exactly, and a mismatch there is indistinguishable from an
 * attack — so the size and type conditions are enforced on verification
 * instead (PRD #29 §311).
 */
export function presignQuery(config: SigV4Config, input: PresignInput): string {
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = amzDates(now);
  const scope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;

  const params: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  if (config.sessionToken) params["X-Amz-Security-Token"] = config.sessionToken;

  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(params[key])}`)
    .join("&");

  const canonicalRequest = [
    input.method,
    uriEncode(input.path, false),
    canonicalQuery,
    `host:${input.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(config, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** The full presigned URL for one object operation. */
export function presignUrl(
  config: SigV4Config,
  input: PresignInput & { protocol?: "https" | "http" },
): string {
  const protocol = input.protocol ?? "https";
  return `${protocol}://${input.host}${uriEncode(input.path, false)}?${presignQuery(config, input)}`;
}

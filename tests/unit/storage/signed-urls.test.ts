import { beforeAll, describe, expect, it } from "vitest";

import {
  decodeClaims,
  encodeClaims,
  signClaims,
  verifyClaims,
  type SignedUrlClaims,
} from "@/lib/core/storage/url-signing";
import { amzDates, presignQuery, presignUrl, uriEncode } from "@/lib/core/storage/providers/sigv4";

/**
 * Signed URLs (PRD #29 §72, §310, §312, §360, §370).
 *
 * A signed URL is a bearer token, so what the signature covers *is* the
 * security boundary. These tests hold that boundary in place: one method, one
 * key, one expiry, and nothing that can be edited in the address bar.
 */

beforeAll(() => {
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
});

const claims = (overrides: Partial<SignedUrlClaims> = {}): SignedUrlClaims => ({
  method: "PUT",
  storageKey: "companies/company_a/documents/doc_1/abc.pdf",
  expiresAt: Date.now() + 60_000,
  maxBytes: 1024,
  contentType: "application/pdf",
  ...overrides,
});

describe("local signed URLs (PRD #29 §72)", () => {
  it("accepts a signature it produced", () => {
    const value = claims();
    expect(verifyClaims(value, signClaims(value))).toEqual({ ok: true });
  });

  /**
   * The one that matters: an upload grant for one object must not be usable
   * against another (PRD #29 §360).
   */
  it("refuses a grant redirected at a different key", () => {
    const granted = claims();
    const signature = signClaims(granted);

    const redirected = claims({ storageKey: "companies/company_b/documents/doc_9/x.pdf" });
    expect(verifyClaims(redirected, signature).ok).toBe(false);
  });

  it("refuses an upload grant replayed as a download", () => {
    const upload = claims({ method: "PUT" });
    const signature = signClaims(upload);
    expect(verifyClaims(claims({ method: "GET" }), signature).ok).toBe(false);
  });

  it("refuses a grant whose size cap was raised", () => {
    const granted = claims({ maxBytes: 1024 });
    const signature = signClaims(granted);
    expect(verifyClaims(claims({ maxBytes: 100 * 1024 * 1024 }), signature).ok).toBe(false);
  });

  it("refuses a grant whose expiry was pushed out (§370)", () => {
    const granted = claims();
    const signature = signClaims(granted);
    const extended = claims({ expiresAt: granted.expiresAt + 86_400_000 });
    expect(verifyClaims(extended, signature).ok).toBe(false);
  });

  it("refuses a grant that has simply run out (§370)", () => {
    const expired = claims({ expiresAt: Date.now() - 600_000 });
    const result = verifyClaims(expired, signClaims(expired));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EXPIRED");
  });

  it("refuses an empty or truncated signature", () => {
    const value = claims();
    expect(verifyClaims(value, "").ok).toBe(false);
    expect(verifyClaims(value, signClaims(value).slice(0, 32)).ok).toBe(false);
  });

  it("round-trips through a query string without losing a claim", () => {
    const value = claims({ method: "GET", disposition: "inline", fileName: "Report.pdf" });
    delete value.maxBytes;

    const params = encodeClaims(value);
    const decoded = decodeClaims(value.storageKey, params);

    expect(decoded).not.toBeNull();
    expect(verifyClaims(decoded!.claims, decoded!.signature)).toEqual({ ok: true });
  });

  it("refuses a query string with no signature at all", () => {
    expect(decodeClaims("k", new URLSearchParams({ m: "GET", exp: "1" }))).toBeNull();
  });
});

/**
 * AWS SigV4 (PRD #29 §5, §359).
 *
 * Verified against the signature AWS publishes for its own worked example, so
 * this is correctness against the spec rather than against itself. If this
 * test passes, a real S3, R2, MinIO or B2 bucket will accept the URL.
 */
describe("S3 presigning", () => {
  const config = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
  };

  it("reproduces the signature from the AWS documented example", () => {
    const query = presignQuery(config, {
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });

    expect(new URLSearchParams(query).get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("binds the key into the signature", () => {
    const base = {
      method: "GET" as const,
      host: "examplebucket.s3.amazonaws.com",
      expiresInSeconds: 300,
      now: new Date("2026-09-12T00:00:00Z"),
    };

    const a = new URLSearchParams(presignQuery(config, { ...base, path: "/a.txt" }));
    const b = new URLSearchParams(presignQuery(config, { ...base, path: "/b.txt" }));

    expect(a.get("X-Amz-Signature")).not.toBe(b.get("X-Amz-Signature"));
  });

  it("carries the session token when one is configured", () => {
    const query = presignQuery(
      { ...config, sessionToken: "tok" },
      {
        method: "GET",
        host: "h",
        path: "/k",
        expiresInSeconds: 60,
        now: new Date("2026-09-12T00:00:00Z"),
      },
    );
    expect(new URLSearchParams(query).get("X-Amz-Security-Token")).toBe("tok");
  });

  /** Getting this wrong breaks exactly the keys with unusual characters. */
  it("encodes to RFC 3986, including the characters encodeURIComponent leaves", () => {
    expect(uriEncode("a b")).toBe("a%20b");
    expect(uriEncode("a/b")).toBe("a%2Fb");
    expect(uriEncode("a/b", false)).toBe("a/b");
    expect(uriEncode("it's(fine)*")).toBe("it%27s%28fine%29%2A");
  });

  it("formats the AMZ date and scope stamp", () => {
    expect(amzDates(new Date("2013-05-24T00:00:00Z"))).toEqual({
      amzDate: "20130524T000000Z",
      dateStamp: "20130524",
    });
  });

  it("builds a URL whose path keeps its separators", () => {
    const url = presignUrl(config, {
      method: "PUT",
      host: "bucket.example.com",
      path: "/companies/c1/documents/d1/obj.pdf",
      expiresInSeconds: 60,
      now: new Date("2026-09-12T00:00:00Z"),
    });
    expect(url).toContain("https://bucket.example.com/companies/c1/documents/d1/obj.pdf?");
    expect(url).toContain("X-Amz-Signature=");
  });
});

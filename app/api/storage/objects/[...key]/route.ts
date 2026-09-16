import path from "node:path";

import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { decodeClaims, verifyClaims } from "@/lib/core/storage/url-signing";
import { contentDisposition, isWellFormedKey } from "@/lib/core/storage";
import { logger } from "@/lib/core/observability/logger";
import { uploadSessionAcceptsBytes } from "@/lib/modules/documents/storage/upload.service";

type Params = { params: Promise<{ key: string[] }> };

/**
 * The local storage adapter's object endpoint (PRD #29 §9, §117).
 *
 * This is where a signed URL from `LocalStorageProvider` actually lands, and
 * it deliberately behaves like an object store rather than like the rest of
 * this application:
 *
 *   there is no session here, and there must not be — a presigned S3 URL does
 *   not carry one either. The signature *is* the authorisation, and it was
 *   issued by the upload or download service after the full permission check
 *   (PRD #29 §72).
 *
 * So the things checked are: the signature verifies, it was issued for this
 * exact key and this exact method, it has not expired, and the body is no
 * larger than was authorised (PRD #29 §310, §360, §370). An upload grant is
 * also single use: it is refused once its upload session has closed, and it
 * never overwrites an object already at the key — the same condition the S3
 * adapter signs in as `If-None-Match: *` (PRD #47 §83).
 *
 * Nothing here is reachable with `STORAGE_DRIVER=s3` — the browser talks to
 * the bucket directly then, and this route is never signed for.
 */

function provider(): LocalStorageProvider {
  return new LocalStorageProvider({
    root: process.env.DOCUMENT_STORAGE_ROOT ?? path.join(process.cwd(), ".storage"),
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });
}

/** Storage speaks in plain HTTP status codes, not in NESTO's error envelope. */
function deny(status: number): Response {
  return new Response(null, { status });
}

function authorise(
  storageKey: string,
  url: URL,
  method: "PUT" | "GET",
): { ok: true; claims: ReturnType<typeof decodeClaims> } | { ok: false; response: Response } {
  if (!isWellFormedKey(storageKey)) return { ok: false, response: deny(400) };

  const decoded = decodeClaims(storageKey, url.searchParams);
  if (!decoded || decoded.claims.method !== method) return { ok: false, response: deny(403) };

  const verdict = verifyClaims(decoded.claims, decoded.signature);
  if (!verdict.ok) {
    // Both a forged grant and an expired one answer 403, so the response
    // cannot be used to tell them apart (PRD #29 §370).
    logger.warn("storage.object.refused", { reason: verdict.reason, method });
    return { ok: false, response: deny(403) };
  }

  return { ok: true, claims: decoded };
}

/** Receives an authorised upload (PRD #29 §9). */
export async function PUT(request: Request, { params }: Params) {
  const { key } = await params;
  const storageKey = key.map(decodeURIComponent).join("/");
  const url = new URL(request.url);

  const authorised = authorise(storageKey, url, "PUT");
  if (!authorised.ok) return authorised.response;

  const claims = authorised.claims!.claims;

  // A declared length over the ceiling is refused before a byte is buffered;
  // the measured body is checked again below, since the header is a claim.
  const declaredLength = Number(request.headers.get("content-length"));
  if (claims.maxBytes !== undefined && Number.isFinite(declaredLength) && declaredLength > claims.maxBytes) {
    return deny(413);
  }

  // A spent grant answers like an expired one (PRD #29 §370): the session
  // behind this key has completed, failed, been aborted or timed out.
  if (!(await uploadSessionAcceptsBytes(storageKey))) {
    logger.warn("storage.object.refused", { reason: "UPLOAD_SESSION_CLOSED", method: "PUT" });
    return deny(403);
  }

  const body = new Uint8Array(await request.arrayBuffer());

  // The size ceiling was bound into the signature, so a browser cannot send
  // more than the server agreed to accept (PRD #29 §310).
  if (claims.maxBytes !== undefined && body.byteLength > claims.maxBytes) {
    return deny(413);
  }
  if (body.byteLength === 0) return deny(400);

  const written = await provider().putObjectIfAbsent(storageKey, body, claims.contentType ?? "application/octet-stream");
  // Something is already there: what S3 answers to a failed If-None-Match.
  if (!written) return deny(412);

  return new Response(null, { status: 200 });
}

/** Serves an authorised download or preview (PRD #29 §102, §106). */
export async function GET(request: Request, { params }: Params) {
  const { key } = await params;
  const storageKey = key.map(decodeURIComponent).join("/");
  const url = new URL(request.url);

  const authorised = authorise(storageKey, url, "GET");
  if (!authorised.ok) return authorised.response;

  const claims = authorised.claims!.claims;
  const bytes = await provider().getObject(storageKey);
  if (!bytes) return deny(404);

  const disposition = claims.disposition ?? "attachment";

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": claims.contentType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(disposition, claims.fileName ?? "file"),
      // The browser does not get to decide this is something else
      // (PRD #29 §107).
      "X-Content-Type-Options": "nosniff",
      // A private file: never held by a shared cache (PRD #29 §190, §191).
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; object-src 'none'; sandbox",
    },
  });
}

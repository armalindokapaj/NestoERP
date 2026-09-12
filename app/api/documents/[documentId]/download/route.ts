import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import * as documents from "@/lib/modules/documents/document.service";
import { createDownloadGrant } from "@/lib/modules/documents/storage/download.service";

type Params = { params: Promise<{ documentId: string }> };

/**
 * Application-proxied download (PRD #13 §18, PRD #29 §307).
 *
 * The signed-grant endpoint at `POST /api/documents/:id/download` is the
 * normal path and keeps binaries off the app server (PRD #29 §389). This one
 * stays for the cases where that is the wrong trade: a deployment that wants
 * revocation to be instant rather than three minutes away, and every
 * server-side consumer that already holds a session.
 *
 * Either way the authorisation is identical — session, company, permission,
 * parent access and storage state, re-run on every request.
 *
 * `?inline=1` is honoured only for a document the registry marked previewable;
 * everything else is forced to download, with `nosniff` so the browser cannot
 * decide otherwise (PRD #29 §43, §107).
 */
export async function GET(request: Request, { params }: Params) {
  const { documentId } = await params;

  return withContext(async (context) => {
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    const file = await documents.readDocumentFile(context, documentId, { inline });

    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": file.disposition,
        "X-Content-Type-Options": "nosniff",
        // A private response: never cached by a shared proxy (PRD #29 §191).
        "Cache-Control": "private, no-store",
      },
    });
  });
}

/**
 * POST /api/documents/:documentId/download — a signed download grant
 * (PRD #29 §100, §102).
 *
 * The normal path. Issuing the URL *is* the access decision, so the whole
 * authorisation sequence runs first and the grant that comes back lives for
 * three minutes — because it cannot be recalled once issued (PRD #29 §306,
 * §308).
 *
 * POST rather than GET because handing out a capability is not something a
 * proxy, a prefetch or a history entry should be able to repeat (§101).
 */
export async function POST(_request: Request, { params }: Params) {
  const { documentId } = await params;

  return withContext(async (context) => {
    const limit = checkRateLimit("DOWNLOAD_GRANT", context.membershipId);
    if (!limit.allowed) {
      return apiError("VALIDATION_ERROR", "Too many download requests. Try again shortly.");
    }

    return apiOk(await createDownloadGrant(context, documentId));
  });
}

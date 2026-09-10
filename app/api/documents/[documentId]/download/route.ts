import { withContext } from "@/lib/api/respond";
import * as documents from "@/lib/modules/documents/document.service";

type Params = { params: Promise<{ documentId: string }> };

/**
 * Authenticated proxy download (PRD #13 §17, §18, §104, §156).
 *
 * There is no public object URL and no long-lived signed link to copy: every
 * request re-runs session, company, permission, parent access and document
 * state before a byte is sent.
 *
 * `?inline=1` is honoured only for formats that cannot execute in the browser;
 * everything else is forced to download, with `nosniff` so the browser cannot
 * decide otherwise (PRD #13 §157, §278).
 */
export async function GET(request: Request, { params }: Params) {
  const { documentId } = await params;

  return withContext(async (context) => {
    const file = await documents.readDocumentFile(context, documentId);

    const wantsInline = new URL(request.url).searchParams.get("inline") === "1";
    const disposition = wantsInline && file.inline ? "inline" : "attachment";

    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        // A private response: never cached by a shared proxy (PRD #13 §222).
        "Cache-Control": "private, no-store",
      },
    });
  });
}

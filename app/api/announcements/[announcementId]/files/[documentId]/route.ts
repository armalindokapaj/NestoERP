import { withContext } from "@/lib/api/respond";
import { readAnnouncementFile } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string; documentId: string }> };

/**
 * GET — one file of an announcement (Activity Center §47, §150).
 *
 * Announcement files are read by everybody who can read the announcement —
 * including a Group announcement read from another company of the group — and
 * need no Documents grant. The announcement decides the reader on every
 * request; the file must be that announcement's own and in a readable storage
 * state. `?inline=1` only for a previewable file; `nosniff` always.
 */
export async function GET(request: Request, { params }: Params) {
  const { announcementId, documentId } = await params;
  return withContext(async (context) => {
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    const file = await readAnnouncementFile(context, announcementId, documentId, { inline });
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": file.disposition,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  });
}

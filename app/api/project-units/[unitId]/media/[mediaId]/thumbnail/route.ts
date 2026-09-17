import { withContext } from "@/lib/api/respond";
import { readDocumentThumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import { unitMediaDocumentId } from "@/lib/modules/project-structure/unit-files.service";

type Params = { params: Promise<{ unitId: string; mediaId: string }> };

/**
 * GET — an image's thumbnail (E-05D §40, §88). Two doors, both required: the
 * unit, through its project, and then the image's document, through the
 * Documents download gate. Opening the unit does not open the file.
 *
 * `private` caching only: the bytes are one person's authorised view.
 */
export async function GET(_request: Request, { params }: Params) {
  const { unitId, mediaId } = await params;
  return withContext(async (context) => {
    const documentId = await unitMediaDocumentId(context, unitId, mediaId);
    const thumbnail = await readDocumentThumbnail(context, documentId);
    return new Response(Buffer.from(thumbnail.body), {
      status: 200,
      headers: {
        "Content-Type": thumbnail.contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        ETag: thumbnail.etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

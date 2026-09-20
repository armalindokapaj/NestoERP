import { withContext } from "@/lib/api/respond";
import { readProjectMediaThumbnail } from "@/lib/modules/project-media/project-media.service";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; mediaId: string }> }) {
  const { projectId, mediaId } = await params;
  return withContext(async (context) => {
    const thumbnail = await readProjectMediaThumbnail(context, projectId, mediaId);
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

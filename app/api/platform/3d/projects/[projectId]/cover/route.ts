import { withPlatformContext } from "@/lib/api/respond";
import { readProject3DExperienceCover } from "@/lib/modules/project-3d/project-3d.service";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return withPlatformContext(async (context) => {
    const thumbnail = await readProject3DExperienceCover(context, projectId);
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

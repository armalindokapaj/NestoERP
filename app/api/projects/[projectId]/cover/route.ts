import { AccessError } from "@/lib/access/guards";
import { withContext } from "@/lib/api/respond";
import { readDocumentThumbnail } from "@/lib/modules/documents/storage/thumbnail.service";
import { contextForProject } from "@/lib/modules/projects/project.portfolio";
import { projectCoverDocumentId } from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/:projectId/cover — the project's cover thumbnail
 * (E-05A §8, §44, §73).
 *
 * Two doors, both required: the project, through the person's membership in its
 * company, and then the cover document, through the documents module's download
 * gate in that same company. Opening the project does not open the render.
 *
 * `private` caching only: the bytes are one person's authorised view.
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (session) => {
    const context = await contextForProject(session, projectId);
    const documentId = await projectCoverDocumentId(context, projectId);
    if (!documentId) throw new AccessError("NOT_FOUND");

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

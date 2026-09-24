import { AccessError } from "@/lib/access/guards";
import { withContext } from "@/lib/api/respond";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { StorageError } from "@/lib/core/storage/storage.errors";
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
 * `private` caching only: the bytes are one person's authorised view. A cover
 * that cannot be served is counted (Projects Workspace Grid §172); the card
 * shows its placeholder instead (§105).
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  // `group: "read"` — the Group workspace's project list shows these covers, and
  // the two doors below are the project's own company's, not the session's
  // (Workspace Context §45, §59).
  return withContext(async (session) => {
    try {
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
    } catch (error) {
      incrementCounter(Metric.PROJECT_COVER_LOAD_ERROR, { reason: coverFailure(error) });
      throw error;
    }
  }, { group: "read" });
}

/** A small, fixed set of reasons, so the counter's series stay bounded. */
function coverFailure(error: unknown): string {
  if (error instanceof StorageError) return error.storageCode.toLowerCase();
  if (error instanceof AccessError) return error.code.toLowerCase();
  return "internal";
}

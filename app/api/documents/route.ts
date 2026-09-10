import { apiOk, apiError, withContext } from "@/lib/api/respond";
import { parseDocumentListQuery } from "@/lib/modules/documents/document.query";
import { createDocumentSchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";

/**
 * GET  /api/documents — scoped, filtered, paginated list (PRD #13 §141).
 * POST /api/documents — multipart upload (PRD #13 §20, §141).
 *
 * V0.1 uses the server-proxy upload the PRD permits for files of this size.
 * The storage abstraction and the tenant-safe key layout are already in place,
 * so moving to direct-to-object-storage later is an adapter and a route, not a
 * redesign (PRD #13 §20, §273).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await documents.listDocuments(context, parseDocumentListQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const form = await request.formData().catch(() => null);
    if (!form) return apiError("VALIDATION_ERROR", "Expected a multipart upload.");

    const file = form.get("file");
    if (!(file instanceof File)) return apiError("VALIDATION_ERROR", "Choose a file to upload.");

    const input = createDocumentSchema.parse({
      name: form.get("name") ?? undefined,
      description: form.get("description") ?? undefined,
      context: form.get("context") ?? undefined,
      projectId: form.get("projectId") ?? undefined,
      clientId: form.get("clientId") ?? undefined,
    });

    const document = await documents.createDocument(context, input, {
      fileName: file.name,
      mimeType: file.type || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    return apiOk({ data: document }, { status: 201 });
  });
}

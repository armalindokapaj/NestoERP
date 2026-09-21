import { apiOk, apiError, withContext } from "@/lib/api/respond";
import { parseDocumentListQuery } from "@/lib/modules/documents/document.query";
import { createDocumentSchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { listDocumentsForWorkspace } from "@/lib/modules/documents/document.workspace";

/**
 * GET  /api/documents — scoped, filtered, paginated list (PRD #13 §141).
 * POST /api/documents — multipart upload, for programmatic callers.
 *
 * The browser does not use this route. A browser upload goes through
 * `POST /api/documents/uploads`, gets a signed URL and pushes the bytes
 * straight at storage, which is what keeps binaries off the app server
 * (PRD #29 §9, §389).
 *
 * This one stays for API clients that hold the bytes already and would rather
 * make one call than three. It is not a shortcut: it runs the same pipeline —
 * parent access, type and size validation, quota, object write, HEAD
 * verification, magic-byte detection, checksum and the scan gate
 * (PRD #29 §233).
 *
 * The list is the one read that also answers in the Group workspace: there it is
 * the union of the documents the person may read in each company, every row
 * naming its company, and `?company=` narrows it to one they may read
 * (Workspace Context §35, §86, §87). The upload above stays a company write.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      return apiOk(await listDocumentsForWorkspace(context, parseDocumentListQuery(url.searchParams)));
    },
    { group: "read" },
  );
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

import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { prisma } from "@/lib/database/prisma";
import { completeUpload } from "@/lib/modules/documents/storage/upload.service";

type Params = { params: Promise<{ documentId: string }> };

const schema = z.object({
  uploadSessionId: z.string().trim().min(1).max(64),
  checksumSha256: z.string().trim().regex(/^[0-9a-f]{64}$/i).optional(),
});

/** POST /api/documents/:documentId/versions/complete — verify the new version (PRD #38 §67). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { documentId } = await params;
    const input = schema.parse(await readJson(request));
    // The session must belong to this document: a session id from somewhere
    // else is not found here.
    const session = await prisma.documentUploadSession.findFirst({
      where: { id: input.uploadSessionId, documentId, companyId: context.companyId, memberId: context.membershipId },
      select: { id: true },
    });
    if (!session) throw new AccessError("NOT_FOUND");
    return apiOk(await completeUpload(context, session.id, { checksumSha256: input.checksumSha256 }));
  });
}

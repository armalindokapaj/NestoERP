import { z } from "zod";

import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createEnvironmentUpload } from "@/lib/modules/project-3d/project-3d.environment-assets";

const schema = z.object({ kind: z.enum(["backdrop", "ies"]), sizeBytes: z.number().int().positive() });

/** Step 1 of a backdrop-photo or IES-profile upload: a private key and a grant to send the bytes to storage. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = schema.parse(await readJson(request));
    return apiOk({ data: await createEnvironmentUpload(context, projectId, input.kind, input.sizeBytes) }, { status: 201 });
  });
}

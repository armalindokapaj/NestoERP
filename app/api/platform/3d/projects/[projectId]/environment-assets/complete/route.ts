import { z } from "zod";

import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { completeEnvironmentUpload } from "@/lib/modules/project-3d/project-3d.environment-assets";

const schema = z.object({ kind: z.enum(["backdrop", "ies"]), ref: z.string().max(120) });

/** Step 3: the server checks the file that arrived and answers with the reference to save. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = schema.parse(await readJson(request));
    return apiOk({ data: { ref: await completeEnvironmentUpload(context, projectId, input.kind, input.ref) } });
  });
}

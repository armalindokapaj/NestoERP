import { z } from "zod";

import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { completeThreeDModelUpload } from "@/lib/modules/platform/platform-control.service";

type Params = { params: Promise<{ versionId: string }> };

export async function POST(request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { versionId } = await params;
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await readJson(request));
    return apiOk({ data: await completeThreeDModelUpload(context, versionId, reason) });
  });
}

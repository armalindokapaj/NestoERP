import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { threeDUploadSchema } from "@/lib/modules/platform/platform-control.schema";
import { createThreeDModelUpload } from "@/lib/modules/platform/platform-control.service";
import { z } from "zod";

export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const input = threeDUploadSchema.extend({ configurationId: z.string().trim().min(1).max(128) }).parse(await readJson(request));
    return apiOk({ data: await createThreeDModelUpload(context, input.configurationId, input) }, { status: 201 });
  });
}

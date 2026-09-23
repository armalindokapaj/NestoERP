import { apiOk, withContext } from "@/lib/api/respond";
import { quickCreateProjectsQuerySchema } from "@/lib/modules/quick-create/quick-create.schema";
import { projectChoices } from "@/lib/modules/quick-create/quick-create.service";

/** GET — the projects the person may open in the chosen company, for a flow that lives under one (Quick Create §71, §148). Group workspace: `read`. */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const input = quickCreateProjectsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return apiOk({ data: await projectChoices(context, input) });
    },
    { group: "read" },
  );
}

import { readJson, withContext } from "@/lib/api/respond";
import { linkProjectSchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** Links a project to a deal won before the project existed (PRD #17 §423). */
export async function POST(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = linkProjectSchema.parse(await readJson(request));
    await opportunities.linkProject(context, opportunityId, input.projectId);
    return new Response(null, { status: 204 });
  });
}

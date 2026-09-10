import { apiOk, withContext } from "@/lib/api/respond";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const url = new URL(request.url);

  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25);

  return withContext(async (context) =>
    apiOk(await projects.listActivity(context, projectId, { page, limit })),
  );
}

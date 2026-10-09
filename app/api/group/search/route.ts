import { apiOk, withGroupContext } from "@/lib/api/respond";
import { groupSearch } from "@/lib/modules/group/group-workspace.query";

export async function GET(request: Request) {
  return withGroupContext(async (context) => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return apiOk({ data: await groupSearch(context, query) });
  });
}

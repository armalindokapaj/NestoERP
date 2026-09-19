import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { platformSearch } from "@/lib/modules/platform/platform-control.query";

export async function GET(request: Request) {
  return withPlatformContext(async (context) => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return apiOk({ data: await platformSearch(context, query) });
  });
}

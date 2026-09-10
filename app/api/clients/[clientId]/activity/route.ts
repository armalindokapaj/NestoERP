import { apiOk, withContext } from "@/lib/api/respond";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string }> };

/** Client history, filtered to the modules this user may see (PRD #12 §102). */
export async function GET(request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const { page, limit } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return apiOk(await clients.listActivity(context, clientId, { page, limit }));
  });
}

import { withContext } from "@/lib/api/respond";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string }> };

/** Its own endpoint: ARCHIVED is not a status a PATCH may set (PRD #12 §70). */
export async function POST(_request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => {
    await clients.restoreClient(context, clientId);
    return new Response(null, { status: 204 });
  });
}

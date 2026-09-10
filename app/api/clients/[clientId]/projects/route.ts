import { apiOk, withContext } from "@/lib/api/respond";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string }> };

/**
 * Projects linked to a client, narrowed to the caller's own project scope: a
 * client may have four and this reader may see two (PRD #12 §92, §93).
 */
export async function GET(_request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await clients.listClientProjects(context, clientId) }),
  );
}

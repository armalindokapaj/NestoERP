import { apiOk, withContext } from "@/lib/api/respond";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string }> };

/**
 * Projects linked to a client, narrowed to the caller's own project scope: a
 * client may have four and this reader may see two (PRD #12 §92, §93).
 *
 * `total` is every such project; `data` holds at most `cap` of them, so a
 * client with more than the cap is never silently cut short (AUD-08 §4).
 */
export async function GET(_request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => {
    const { rows, total, cap } = await clients.listClientProjectsWithTotal(context, clientId);
    return apiOk({ data: rows, total, cap });
  });
}

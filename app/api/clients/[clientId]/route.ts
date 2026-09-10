import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateClientSchema } from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string }> };

/**
 * A client outside the caller's scope answers 404 rather than 403, so the
 * response cannot be used to discover that it exists (PRD #12 §129).
 */
export async function GET(_request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => apiOk({ data: await clients.getClient(context, clientId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => {
    const body = await readJson(request);
    // companyId, createdBy, archivedAt and preArchiveStatus are absent from the
    // schema, so they cannot be set from a request body (PRD #12 §124).
    const input = updateClientSchema.parse(body);
    return apiOk({ data: await clients.updateClient(context, clientId, input) });
  });
}

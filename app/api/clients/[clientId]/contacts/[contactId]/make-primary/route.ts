import { apiOk, withContext } from "@/lib/api/respond";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string; contactId: string }> };

/**
 * Promoting a contact stands the previous primary down in the same
 * transaction, so a client can never hold two (PRD #12 §84, §164).
 */
export async function POST(_request: Request, { params }: Params) {
  const { clientId, contactId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await clients.makePrimaryContact(context, clientId, contactId) }),
  );
}

import { withContext } from "@/lib/api/respond";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string; contactId: string }> };

/** Contacts are never hard-deleted; they are archived (PRD #12 §89). */
export async function POST(_request: Request, { params }: Params) {
  const { clientId, contactId } = await params;
  return withContext(async (context) => {
    await clients.archiveContact(context, clientId, contactId);
    return new Response(null, { status: 204 });
  });
}

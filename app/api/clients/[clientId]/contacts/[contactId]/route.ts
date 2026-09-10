import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateContactSchema } from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string; contactId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { clientId, contactId } = await params;
  return withContext(async (context) => {
    const contacts = await clients.listContacts(context, clientId, { archived: true });
    const contact = contacts.find((entry) => entry.id === contactId);
    if (!contact) return apiOk({ data: null }, { status: 404 });
    return apiOk({ data: contact });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { clientId, contactId } = await params;
  return withContext(async (context) => {
    const input = updateContactSchema.parse(await readJson(request));
    return apiOk({ data: await clients.updateContact(context, clientId, contactId, input) });
  });
}

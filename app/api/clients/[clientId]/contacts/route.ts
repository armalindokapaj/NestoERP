import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createContactSchema } from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const archived = url.searchParams.get("archived") === "true";
    return apiOk({ data: await clients.listContacts(context, clientId, { archived }) });
  });
}

export async function POST(request: Request, { params }: Params) {
  const { clientId } = await params;
  return withContext(async (context) => {
    const input = createContactSchema.parse(await readJson(request));
    return apiOk({ data: await clients.createContact(context, clientId, input) }, { status: 201 });
  });
}

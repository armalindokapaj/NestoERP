import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseClientListQuery } from "@/lib/modules/clients/client.query";
import { createClientSchema } from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";

/**
 * GET  /api/clients — scoped, filtered, paginated list (PRD #12 §118, §121).
 * POST /api/clients — create, requiring client.create (PRD #12 §123).
 *
 * A soft duplicate answers 409 with the matches attached, so the caller can
 * show them and resubmit with `acceptDuplicate` (PRD #12 §53).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await clients.listClients(context, parseClientListQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = createClientSchema.parse(body);
    return apiOk({ data: await clients.createClient(context, input) }, { status: 201 });
  });
}

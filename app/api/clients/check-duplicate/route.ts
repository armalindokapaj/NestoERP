import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { duplicateCheckSchema } from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";

/**
 * Soft duplicate lookup (PRD #12 §125, §126).
 *
 * Company-scoped and permission-scoped: it returns only clients the caller
 * could already discover, so it cannot become a way to enumerate the company.
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = duplicateCheckSchema.parse(await readJson(request));
    return apiOk({ data: await clients.checkDuplicates(context, input) });
  });
}

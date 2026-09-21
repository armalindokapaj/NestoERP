import { apiOk, withContext } from "@/lib/api/respond";
import * as account from "@/lib/modules/account/account.service";

/** Signs out every session except the one making the request. */
export async function POST() {
  return withContext(async (context) => apiOk({ data: { revoked: await account.revokeOtherSessions(context) } }), { group: "any" });
}

import { apiOk, withContext } from "@/lib/api/respond";
import * as account from "@/lib/modules/account/account.service";

/** The signed-in person's active sessions (PRD #38 §20). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await account.listSessions(context) }));
}

/** Signs out everywhere, including the session making the request. */
export async function DELETE() {
  return withContext(async (context) => apiOk({ data: { revoked: await account.revokeAllSessions(context) } }));
}

import { withContext } from "@/lib/api/respond";
import * as account from "@/lib/modules/account/account.service";

type Params = { params: Promise<{ sessionId: string }> };

/** Ends one of the caller's own sessions; anybody else's id is NOT_FOUND. */
export async function DELETE(_request: Request, { params }: Params) {
  return withContext(
    async (context) => {
      const { sessionId } = await params;
      await account.revokeOwnSession(context, sessionId);
      return new Response(null, { status: 204 });
    },
    { group: "any" },
  );
}

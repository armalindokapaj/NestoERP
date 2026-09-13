import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { changePasswordSchema } from "@/lib/modules/account/account.schema";
import * as account from "@/lib/modules/account/account.service";

/** Changes the signed-in person's password; other sessions end (PRD #38 §20). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = changePasswordSchema.parse(await readJson(request));
    const outcome = await account.changePassword(context, input, {
      ipAddress: clientAddress(request.headers),
      userAgent: userAgentOf(request.headers),
    });
    return apiOk({ data: outcome });
  });
}

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { revokeAccessGrant, revokeGrantSchema } from "@/lib/modules/organization/access-grant.service";

type Params = { params: Promise<{ grantId: string }> };

/** POST /api/organization/access-grants/:grantId/revoke — the delegated access ends now and stays as history (E-06 §18). */
export async function POST(request: Request, { params }: Params) {
  const { grantId } = await params;
  return withContext(async (context) => {
    const input = revokeGrantSchema.parse(await readJson(request));
    await revokeAccessGrant(context, grantId, input);
    return apiOk({ data: { ok: true } });
  });
}

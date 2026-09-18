import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { grantAccess, grantAccessSchema, grantListQuerySchema, listAccessGrants } from "@/lib/modules/organization/access-grant.service";

/** GET /api/organization/access-grants — delegated access in the group, as far as the reader keeps it (E-06 §18). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk({ data: await listAccessGrants(context, grantListQuerySchema.parse(Object.fromEntries(url.searchParams))) });
  });
}

/** POST /api/organization/access-grants — delegate one module to one person, within the grantor's own ceiling (E-06 §18, §78). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = grantAccessSchema.parse(await readJson(request));
    return apiOk({ data: await grantAccess(context, input) }, { status: 201 });
  });
}

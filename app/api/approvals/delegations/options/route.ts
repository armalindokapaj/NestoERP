import { apiOk, withContext } from "@/lib/api/respond";
import { delegateOptions } from "@/lib/modules/approvals/approvals.delegation";
import { providerKeySchema } from "@/lib/modules/approvals/approvals.schema";

/** GET /api/approvals/delegations/options?q=&provider= — who could stand in for me (PRD #41 §34). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const provider = providerKeySchema.safeParse(params.get("provider"));
    return apiOk({ data: await delegateOptions(context, { q: params.get("q") ?? undefined, providerKey: provider.success ? provider.data : null }) });
  });
}

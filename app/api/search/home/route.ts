import { apiOk, withContext, withMeta } from "@/lib/api/respond";
import { searchHome } from "@/lib/modules/productivity/my-work.service";

/**
 * GET — what Global Search shows before anything is typed: a few favorites and
 * recent records, already authorised and resolved (Fast Re-entry §45, §91, §195,
 * §197). Group workspace: `read`; user-global, every row naming its company.
 */
export async function GET() {
  return withContext(async (context) => apiOk(await withMeta(context, searchHome(context))), { group: "read" });
}

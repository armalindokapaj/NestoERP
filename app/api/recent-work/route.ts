import { apiOk, withContext } from "@/lib/api/respond";
import { clearRecentWorkForWorkspace, listRecentWorkForWorkspace } from "@/lib/modules/productivity/recent-work.service";

/**
 * GET — records this member opened lately and can still open (PRD #45 §106, §181).
 *
 * Group workspace: `read`. Recent work is the person's own, so the Group
 * workspace shows the recent accessible work across their companies, each row
 * naming its company (Workspace Context §43). `company` narrows to one company
 * the person may use and is ignored for any other (§87).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const company = new URL(request.url).searchParams.get("company");
      return apiOk({ data: await listRecentWorkForWorkspace(context, { companyId: company }) });
    },
    { group: "read" },
  );
}

/**
 * DELETE — clear this member's recent work (PRD #45 §110).
 *
 * Group workspace: `any`. Clearing is the person's own light write with no
 * company to get wrong: it removes their own recent rows in the companies the
 * Group workspace reads, and nobody else's.
 */
export async function DELETE() {
  return withContext(async (context) => apiOk({ data: { removed: await clearRecentWorkForWorkspace(context) } }), { group: "any" });
}

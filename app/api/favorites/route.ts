import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addFavoriteForWorkspace, listFavoritesForWorkspace } from "@/lib/modules/productivity/favorites.service";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";

/**
 * GET — this member's favorites, each re-resolved against their access now (PRD #45 §79, §83).
 *
 * Group workspace: `read`. Favorites are the person's own, so the Group
 * workspace shows all of them — each company's list, resolved in that company's
 * own context, every row naming its company (Workspace Context §44). The
 * `company` parameter narrows to one company the person may use and is ignored
 * for any other (§87).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const company = new URL(request.url).searchParams.get("company");
      return apiOk({ data: await listFavoritesForWorkspace(context, { companyId: company }) });
    },
    { group: "read" },
  );
}

/**
 * POST — star a record this member can open; starring twice is one favorite (PRD #45 §78, §85).
 *
 * Group workspace: `any`. A favorite is the person's own light write with no
 * company to get wrong: the record decides it. The service finds the one
 * company the record lives in among the person's own memberships and stores it
 * for their membership there — a record they cannot open in any of them is
 * simply not found (§44).
 */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const input = entityRefSchema.parse(await readJson(request));
      return apiOk({ data: await addFavoriteForWorkspace(context, input) }, { status: 201 });
    },
    { group: "any" },
  );
}

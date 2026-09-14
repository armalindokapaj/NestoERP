import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addFavorite, listFavorites } from "@/lib/modules/productivity/favorites.service";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";

/** GET — this member's favorites, each re-resolved against their access now (PRD #45 §79, §83). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listFavorites(context) }));
}

/** POST — star a record this member can open; starring twice is one favorite (PRD #45 §78, §85). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = entityRefSchema.parse(await readJson(request));
    return apiOk({ data: await addFavorite(context, input) }, { status: 201 });
  });
}

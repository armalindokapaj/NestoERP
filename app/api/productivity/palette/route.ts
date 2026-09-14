import { apiOk, withContext } from "@/lib/api/respond";
import { listFavorites } from "@/lib/modules/productivity/favorites.service";
import { listRecentWork } from "@/lib/modules/productivity/recent-work.service";

/** GET — favorites and recent records for the command palette, resolved against access now (PRD #45 §91, §114, §119, §319). */
export async function GET() {
  return withContext(async (context) => {
    const [favorites, recent] = await Promise.all([listFavorites(context), listRecentWork(context, { limit: 12 })]);
    return apiOk({ data: { favorites, recent } });
  });
}

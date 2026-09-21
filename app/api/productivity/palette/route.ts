import { apiOk, withContext } from "@/lib/api/respond";
import { listFavoritesForWorkspace } from "@/lib/modules/productivity/favorites.service";
import { listRecentWorkForWorkspace } from "@/lib/modules/productivity/recent-work.service";

/**
 * GET — favorites and recent records for the command palette, resolved against access now (PRD #45 §91, §114, §119, §319).
 *
 * Group workspace: `read`. The palette is the shell's, so it follows the
 * workspace: the person's favorites and recent work across their companies, each
 * row naming its company, opened through the enter-company hop
 * (Workspace Context §43, §44).
 */
export async function GET() {
  return withContext(
    async (context) => {
      const [favorites, recent] = await Promise.all([listFavoritesForWorkspace(context), listRecentWorkForWorkspace(context, { limit: 12 })]);
      return apiOk({ data: { favorites, recent } });
    },
    { group: "read" },
  );
}

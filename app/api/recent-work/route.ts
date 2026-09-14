import { apiOk, withContext } from "@/lib/api/respond";
import { clearRecentWork, listRecentWork } from "@/lib/modules/productivity/recent-work.service";

/** GET — records this member opened lately and can still open (PRD #45 §106, §181). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listRecentWork(context) }));
}

/** DELETE — clear this member's recent work (PRD #45 §110). */
export async function DELETE() {
  return withContext(async (context) => apiOk({ data: { removed: await clearRecentWork(context) } }));
}

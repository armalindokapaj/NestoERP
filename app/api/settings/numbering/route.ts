import { apiOk, withContext } from "@/lib/api/respond";
import { listNumberingSchemes } from "@/lib/modules/settings/numbering.service";

/** GET /api/settings/numbering — every scheme with a live preview (PRD #24 §114). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listNumberingSchemes(context) }));
}

import { apiOk, withContext } from "@/lib/api/respond";
import { attentionList, getSalesOverview } from "@/lib/modules/sales/overview/overview.service";

/** The module dashboard, scoped to the reader (PRD #17 §199, §413). */
export async function GET() {
  return withContext(async (context) => {
    const [overview, attention] = await Promise.all([
      getSalesOverview(context),
      attentionList(context),
    ]);
    return apiOk({ data: { overview, attention } });
  });
}

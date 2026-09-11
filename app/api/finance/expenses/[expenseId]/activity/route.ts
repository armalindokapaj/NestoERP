import { apiOk, withContext } from "@/lib/api/respond";
import { listRecordActivity } from "@/lib/modules/finance/finance.activity";

type Params = { params: Promise<{ expenseId: string }> };

/**
 * The record's own history (PRD #15 §193, §194).
 *
 * Scoped to one record, which the reader has already been shown to reach: a
 * module-wide finance trail would hand somebody the amounts off every record
 * they cannot open.
 */
export async function GET(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    return apiOk(
      await listRecordActivity(context, "Expense", expenseId, {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: 25,
      }),
    );
  });
}

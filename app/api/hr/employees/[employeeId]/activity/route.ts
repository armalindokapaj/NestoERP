import { apiOk, withContext } from "@/lib/api/respond";
import { listEmployeeActivity } from "@/lib/modules/hr/hr.activity";

type Params = { params: Promise<{ employeeId: string }> };

/** One employee's HR history (PRD #16 §136, §137). */
export async function GET(request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    return apiOk(
      await listEmployeeActivity(context, employeeId, {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: 25,
      }),
    );
  });
}

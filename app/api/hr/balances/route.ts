import { apiError, apiOk, withContext } from "@/lib/api/respond";
import * as leave from "@/lib/modules/hr/leave/leave.service";

/** Leave balances for one employee and year (PRD #16 §79, §178). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    // An employment, with or without a login; none is the reader's own (E-04 §7).
    const employeeId = url.searchParams.get("employeeId");

    const yearValue = Number.parseInt(
      url.searchParams.get("year") ?? String(new Date().getUTCFullYear()),
      10,
    );
    if (!Number.isFinite(yearValue) || yearValue < 2000 || yearValue > 2100) {
      return apiError("VALIDATION_ERROR", "That year is not valid.");
    }

    return apiOk({ data: await leave.getBalances(context, employeeId, yearValue) });
  });
}

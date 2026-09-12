import { withContext } from "@/lib/api/respond";
import { exportContracts, type ContractExportType } from "@/lib/modules/contracts/contract.export";
import { parseContractQuery, parseObligationQuery } from "@/lib/modules/contracts/contract.query";

/**
 * CSV export (PRD #18 §225, §226).
 *
 * The same query, the same service, the same redaction as the screen — so the
 * file can never contain a column the reader could not see (PRD #18 §227).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const raw = url.searchParams.get("type");
    const type: ContractExportType =
      raw === "obligations" ? "obligations" : raw === "amendments" ? "amendments" : "contracts";

    const { filename, csv } = await exportContracts(
      context,
      type,
      parseContractQuery(url.searchParams),
      parseObligationQuery(url.searchParams),
    );

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}

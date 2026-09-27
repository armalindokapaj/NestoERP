import { withContext } from "@/lib/api/respond";
import { exportResponse, recordExport } from "@/lib/core/export/exporter";
import { exportSelector } from "@/lib/core/export/export-params";
import { EXPORT_TYPES, exportContracts, parseContractExport } from "@/lib/modules/contracts/contract.export";

/**
 * CSV export (PRD #18 §225, §226; AUD-08 §7).
 *
 * The same query — the section (`view`) included — the same service, the same
 * redaction as the screen, every page of it, so the file can never contain a
 * column the reader could not see (PRD #18 §227) nor lose the section the
 * reader was on (DT-02). An unknown export or filter is refused, and past the
 * row cap the request is refused whole with a JSON error, never a short file.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = exportSelector(params, "type", EXPORT_TYPES, "contracts");
    const { query, obligationQuery } = parseContractExport(context, type, params);
    const prepared = await exportContracts(context, type, query, obligationQuery);
    await recordExport(context, { id: "contracts", module: "contracts", filename: prepared.filename });
    return exportResponse(prepared);
  });
}

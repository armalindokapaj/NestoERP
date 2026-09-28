import { withPlatformContext } from "@/lib/api/respond";
import { exportAuditLog } from "@/lib/modules/platform/platform-audit.query";

/** The filtered Audit Log as CSV (Admin Audit PRD #6 §73); a capped file says so in its name. */
export async function GET(request: Request) {
  return withPlatformContext(async (context) => {
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    const { csv, truncated } = await exportAuditLog(context, raw);
    const name = `nesto-audit-${new Date().toISOString().slice(0, 10)}${truncated ? "-first-5000" : ""}.csv`;
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  });
}

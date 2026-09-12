import { withContext } from "@/lib/api/respond";
import { prisma } from "@/lib/database/prisma";
import { assertModule, assertPermission } from "@/lib/access/guards";
import { buildHseMemberWhere } from "@/lib/modules/hse/hse.scope";

/**
 * Colleagues a safety record may be assigned to (PRD #22 §40, §69, §120).
 *
 * Fetched on demand by the assign dialog rather than rendered into every record
 * page. Guarded like any other endpoint: the module gate, then the view
 * permission — a picker of everybody in the company is not public.
 */
export async function GET() {
  return withContext(async (context) => {
    assertModule(context, "hse");
    assertPermission(context, "hse.view");

    const rows = await prisma.companyMember.findMany({
      where: buildHseMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    });

    return Response.json({
      members: rows.map((row) => ({
        id: row.id,
        name: `${row.user.firstName} ${row.user.lastName}`,
      })),
    });
  });
}

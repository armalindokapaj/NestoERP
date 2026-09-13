import { withContext } from "@/lib/api/respond";
import { assertModule, assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import { buildSalesOwnerWhere } from "@/lib/modules/sales/sales.scope";

/**
 * Colleagues a lead or opportunity may be owned by (PRD #17 §41, §88).
 *
 * Fetched on demand by the assign dialog rather than rendered into every
 * record page, and guarded like any other endpoint: a list of everybody in the
 * company is not public.
 */
export async function GET() {
  return withContext(async (context) => {
    assertModule(context, "sales");
    assertPermission(context, "sales.lead.view");

    const rows = await prisma.companyMember.findMany({
      where: buildSalesOwnerWhere(context),
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

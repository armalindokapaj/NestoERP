import { withContext } from "@/lib/api/respond";
import { assertModule, assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import { buildContractOwnerWhere } from "@/lib/modules/contracts/contract.scope";

/**
 * Colleagues a contract may be owned by (PRD #18 §60).
 *
 * The owner is who answers for the contract's obligations, so the list is the
 * module's own owner scope rather than everybody with a login.
 */
export async function GET() {
  return withContext(async (context) => {
    assertModule(context, "contracts");
    assertPermission(context, "legal.contract.view");

    const rows = await prisma.companyMember.findMany({
      where: buildContractOwnerWhere(context),
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

import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildTeamScopeWhere } from "@/lib/modules/team/team.scope";

/**
 * Options for the project form (PRD #10 §36, §37).
 *
 * Both lists are read inside the current company and the user's own scope, so a
 * form cannot offer a relationship the service would then refuse.
 *
 * Managers follow the same rules as the service (PRD #10 §118, PRD #47 §62).
 * Without `project.manager.assign` the only choices the service accepts are
 * the caller and whoever manages the project already, so that is the whole
 * list — a company directory is not handed to somebody who may not use it.
 * With the grant, the list is the people the caller's Team scope lets them see,
 * never a wider directory than the Team module itself would show.
 *
 * On edit, the project's current client and manager stay in their lists even
 * when the editor could not choose them today: a select that silently loses
 * its value would unlink them on the next save.
 */
export async function projectFormOptions(
  context: UserContext,
  current: { clientId?: string | null; managerMemberId?: string | null } = {},
) {
  const mayAssignManager = can(context, "project.manager.assign");

  const managerWhere: Prisma.CompanyMemberWhereInput = {
    companyId: context.companyId,
    status: "ACTIVE",
    OR: [
      mayAssignManager ? buildTeamScopeWhere(context) : { id: context.membershipId },
      ...(current.managerMemberId ? [{ id: current.managerMemberId }] : []),
    ],
  };

  const clientWhere: Prisma.ClientWhereInput = {
    OR: [
      { AND: [buildClientScopeWhere(context), { status: { not: "ARCHIVED" } }] },
      ...(current.clientId ? [{ id: current.clientId, companyId: context.companyId }] : []),
    ],
  };

  const [clients, managers] = await Promise.all([
    prisma.client.findMany({
      where: clientWhere,
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: managerWhere,
      select: {
        id: true,
        jobTitle: true,
        user: { select: { firstName: true, lastName: true } },
        role: { select: { name: true } },
      },
      orderBy: [{ user: { firstName: "asc" } }],
    }),
  ]);

  return {
    clients: clients.map((client) => ({
      value: client.id,
      label: client.code ? `${client.name} (${client.code})` : client.name,
    })),
    managers: managers.map((member) => ({
      value: member.id,
      label: `${member.user.firstName} ${member.user.lastName} — ${member.role.name}`,
    })),
  };
}

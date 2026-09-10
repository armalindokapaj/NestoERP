import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Options for the project form (PRD #10 §36, §37).
 *
 * Both lists are read inside the current company and the user's own client
 * scope, so a form cannot offer a relationship the service would then refuse.
 */
export async function projectFormOptions(context: UserContext) {
  const [clients, managers] = await Promise.all([
    prisma.client.findMany({
      where: { AND: [buildClientScopeWhere(context), { status: { not: "ARCHIVED" } }] },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, status: "ACTIVE" },
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

import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Options for the upload form (PRD #13 §87, §88).
 *
 * Both lists are read inside the caller's own scope, so the form cannot offer a
 * parent the service would then refuse (PRD #13 §91).
 */
export async function documentFormOptions(context: UserContext) {
  const canFileToCompany = can(context, "document.company.create");

  const [projects, clients] = await Promise.all([
    prisma.project.findMany({
      where: {
        AND: [buildProjectScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    can(context, "client.view")
      ? prisma.client.findMany({
          where: { AND: [buildClientScopeWhere(context), { status: { not: "ARCHIVED" } }] },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return {
    projects: projects.map((project) => ({
      value: project.id,
      label: `${project.name} (${project.code})`,
    })),
    clients: clients.map((client) => ({ value: client.id, label: client.name })),
    canFileToCompany,
  };
}

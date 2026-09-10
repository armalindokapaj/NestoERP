import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";

/**
 * The parent-access registry (PRD #13 §42–§45).
 *
 * A generic `document.view` is never enough. Every document is reachable only
 * through its parent's permissions:
 *
 *   document.view + company + parent module permission + parent record access
 *
 * Each parent shape registers a resolver here rather than every Documents
 * endpoint re-implementing the rule. An unregistered shape **fails closed**: a
 * document filed under a module whose resolver does not exist yet is excluded
 * from lists and refused on detail, rather than quietly assumed safe
 * (PRD #13 §45, §136, §243).
 */

export type DocumentParentRef = {
  projectId: string | null;
  clientId: string | null;
  module: string | null;
  entityType: string | null;
  entityId: string | null;
};

/* -------------------------------------------------------------------------- */
/* Module gate                                                                 */
/* -------------------------------------------------------------------------- */

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Modules the caller may reach at all. */
function reachableModules(context: UserContext): ModuleKey[] {
  return (Object.keys(context.moduleAccess) as ModuleKey[]).filter((key) => {
    const access = context.moduleAccess[key];
    return access.enabled && access.accessLevel !== "NONE";
  });
}

/**
 * Modules the caller reaches at *company* level.
 *
 * A company-level document has no project or client to narrow it, so it needs
 * company-level access to the module it was filed under. That is what keeps
 * "Company Financial Summary.pdf" away from an Architect whose Finance access
 * is scoped to their own projects (PRD #13 §39, §46, §202, §283).
 */
function companyLevelModules(context: UserContext): ModuleKey[] {
  return reachableModules(context).filter((key) => {
    const scope = getModuleScope(context, key);
    return scope === "COMPANY" || scope === "SYSTEM";
  });
}

/**
 * A document filed under a module the caller cannot reach is invisible whatever
 * its parent record says.
 */
function moduleAllowed(context: UserContext, moduleName: string | null): boolean {
  if (moduleName === null) return true;
  if (!isModuleKey(moduleName)) return false; // fail closed on an unknown module
  return reachableModules(context).includes(moduleName);
}

/* -------------------------------------------------------------------------- */
/* Entity resolvers                                                            */
/* -------------------------------------------------------------------------- */

type EntityResolver = (context: UserContext, entityId: string) => Promise<boolean>;

/**
 * Registered `entityType` resolvers.
 *
 * `task` is here because Tasks is a real module now; anything not listed is
 * refused until its module registers one (PRD #13 §44, §199, §289).
 */
const ENTITY_RESOLVERS: Record<string, EntityResolver> = {
  async project(context, entityId) {
    const found = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async client(context, entityId) {
    const found = await prisma.client.findFirst({
      where: { AND: [buildClientScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },

  async task(context, entityId) {
    if (!can(context, "task.view")) return false;
    const { buildTaskScopeWhere } = await import("@/lib/access/scope");
    const found = await prisma.task.findFirst({
      where: { AND: [buildTaskScopeWhere(context), { id: entityId }] },
      select: { id: true },
    });
    return Boolean(found);
  },
};

/* -------------------------------------------------------------------------- */
/* Access decision                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Can this caller reach the record a document hangs off?
 *
 * The order matters: company isolation is applied by the caller, then the
 * module gate, then the parent record itself.
 */
export async function canReachDocumentParent(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<boolean> {
  if (!moduleAllowed(context, ref.module)) return false;

  if (ref.projectId) {
    const found = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: ref.projectId }] },
      select: { id: true },
    });
    return Boolean(found);
  }

  if (ref.clientId) {
    if (!can(context, "client.view")) return false;
    const found = await prisma.client.findFirst({
      where: { AND: [buildClientScopeWhere(context), { id: ref.clientId }] },
      select: { id: true },
    });
    return Boolean(found);
  }

  if (ref.entityType && ref.entityId) {
    const resolver = ENTITY_RESOLVERS[ref.entityType];
    // Fail closed: an entity type nobody has registered is not reachable.
    if (!resolver) return false;
    return resolver(context, ref.entityId);
  }

  // A company-level document: no narrowing parent, so it needs company-level
  // access to its filing module.
  if (ref.module === null) return can(context, "document.company.view");
  return isModuleKey(ref.module) && companyLevelModules(context).includes(ref.module);
}

/** May this caller file a *new* document against that parent (PRD #13 §43, §91)? */
export async function canAttachToDocumentParent(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<boolean> {
  if (!can(context, "document.create")) return false;
  if (ref.projectId === null && ref.clientId === null && ref.entityId === null) {
    // A general company document needs the company-document grant on top
    // (PRD #13 §92).
    return can(context, "document.company.create");
  }
  return canReachDocumentParent(context, ref);
}

/* -------------------------------------------------------------------------- */
/* List query                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The authorised `where` for a document list (PRD #13 §134, §135).
 *
 * Built as a set of OR branches rather than by loading every company document
 * and filtering in memory — which would be both slow and one refactor away
 * from a leak.
 */
export function buildDocumentAccessWhere(context: UserContext): Prisma.DocumentWhereInput {
  const reachable = reachableModules(context);
  const companyLevel = companyLevelModules(context);

  const moduleGate = (allowed: ModuleKey[]): Prisma.DocumentWhereInput => ({
    OR: [{ module: null }, { module: { in: allowed } }],
  });

  const branches: Prisma.DocumentWhereInput[] = [
    // A project document follows project access.
    {
      AND: [
        { projectId: { not: null } },
        { project: buildProjectScopeWhere(context) },
        moduleGate(reachable),
      ],
    },
  ];

  // A client document follows client access.
  if (can(context, "client.view")) {
    branches.push({
      AND: [
        { projectId: null, clientId: { not: null } },
        { client: buildClientScopeWhere(context) },
        moduleGate(reachable),
      ],
    });
  }

  // A task document follows task access.
  if (can(context, "task.view")) {
    branches.push({
      AND: [
        { projectId: null, clientId: null, entityType: "task" },
        moduleGate(reachable),
      ],
    });
  }

  // A company document needs company-level access to its filing module, or the
  // dedicated company-document grant when it has no module at all.
  if (can(context, "document.company.view")) {
    branches.push({
      AND: [{ projectId: null, clientId: null, entityType: null, module: null }],
    });
  }
  if (companyLevel.length > 0) {
    branches.push({
      AND: [
        { projectId: null, clientId: null, entityType: null },
        { module: { in: companyLevel } },
      ],
    });
  }

  return { companyId: context.companyId, OR: branches };
}

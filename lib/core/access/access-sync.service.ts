import type { AccessLevel, DataScope, PrismaClient } from "@prisma/client";

import { CORE_MODULE_KEYS, MODULE_KEYS, modules } from "@/config/modules";
import { PERMISSIONS, moduleForPermission, permissionAction } from "@/config/permissions";
import { roleModuleAccess } from "@/config/role-defaults";
import { ROLE_KEYS, roles } from "@/config/roles";

/**
 * Writes the canonical access configuration into the database (PRD #9 §14-§21,
 * PRD #38 §19).
 *
 * Roles, permissions, modules and the role × module × permission matrix are
 * all derived from `config/`. This is not demo data: every environment needs
 * it, production included, so it lives here rather than only in the seed, and
 * both the seed and `scripts/access-sync.ts` call it.
 *
 * The matrix is replaced inside one transaction, so no reader ever sees a role
 * with its grants deleted and not yet recreated.
 */
export async function syncAccessConfiguration(prisma: PrismaClient) {
  for (const key of ROLE_KEYS) {
    const definition = roles[key];
    await prisma.role.upsert({
      where: { key },
      update: { name: definition.label, description: definition.description },
      create: { key, name: definition.label, description: definition.description },
    });
  }

  for (const key of PERMISSIONS) {
    const owningModule = moduleForPermission(key);
    await prisma.permission.upsert({
      where: { key },
      update: { module: owningModule ?? "core", action: permissionAction(key) },
      create: { key, module: owningModule ?? "core", action: permissionAction(key) },
    });
  }

  for (const key of MODULE_KEYS) {
    const definition = modules[key];
    await prisma.module.upsert({
      where: { key },
      update: {
        name: definition.label,
        description: definition.description,
        route: definition.route,
        status: "ACTIVE",
      },
      create: {
        key,
        name: definition.label,
        description: definition.description,
        route: definition.route,
        status: "ACTIVE",
      },
    });
  }

  const [roleRows, permissionRows, moduleRows] = await Promise.all([
    prisma.role.findMany(),
    prisma.permission.findMany(),
    prisma.module.findMany(),
  ]);

  const roleId = new Map(roleRows.map((row) => [row.key, row.id]));
  const permissionId = new Map(permissionRows.map((row) => [row.key, row.id]));
  const moduleId = new Map(moduleRows.map((row) => [row.key, row.id]));

  const rolePermissionRows: { roleId: string; permissionId: string; scope: DataScope }[] = [];
  const moduleAccessRows: { roleId: string; moduleId: string; accessLevel: AccessLevel; scope: DataScope }[] = [];

  for (const key of ROLE_KEYS) {
    const rid = roleId.get(key)!;
    for (const moduleKey of MODULE_KEYS) {
      const access = roleModuleAccess[key][moduleKey];
      moduleAccessRows.push({
        roleId: rid,
        moduleId: moduleId.get(moduleKey)!,
        accessLevel: access.accessLevel,
        scope: access.scope,
      });
      for (const permission of access.permissions) {
        rolePermissionRows.push({
          roleId: rid,
          permissionId: permissionId.get(permission)!,
          // The scope stored beside the grant is the module's scope: it is what
          // record-level authorisation reads back (PRD #5 §47).
          scope: access.scope,
        });
      }
    }
  }

  await prisma.$transaction([
    // Start from a clean matrix so a removed grant really disappears.
    prisma.rolePermission.deleteMany({}),
    prisma.roleModuleAccess.deleteMany({}),
    prisma.roleModuleAccess.createMany({ data: moduleAccessRows }),
    prisma.rolePermission.createMany({ data: rolePermissionRows, skipDuplicates: true }),
    // A permission the registry no longer declares is removed, not left
    // behind to be granted by a stale row nothing in the code checks.
    prisma.permission.deleteMany({ where: { key: { notIn: [...PERMISSIONS] } } }),
  ]);

  // A core module added after a company was created is switched on for it: a
  // company cannot be without the shell (PRD #39 §127). Existing switches are
  // never changed here.
  const companies = await prisma.company.findMany({ select: { id: true } });
  const coreModuleIds = CORE_MODULE_KEYS.map((key) => moduleId.get(key)).filter((id): id is string => Boolean(id));
  if (companies.length > 0 && coreModuleIds.length > 0) {
    await prisma.companyModule.createMany({
      data: companies.flatMap((company) => coreModuleIds.map((id) => ({ companyId: company.id, moduleId: id, enabled: true }))),
      skipDuplicates: true,
    });
  }

  return {
    roles: ROLE_KEYS.length,
    permissions: PERMISSIONS.length,
    modules: MODULE_KEYS.length,
    rolePermissions: rolePermissionRows.length,
    roleModuleAccess: moduleAccessRows.length,
  };
}

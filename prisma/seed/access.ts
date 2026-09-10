/**
 * Seeds the access configuration: roles, permissions, modules, the role ×
 * permission grants and the role × module matrix (PRD #9 §14–§21).
 *
 * Everything is derived from config/role-defaults.ts. The seed does not hold a
 * second interpretation of the access matrix — it writes the canonical one into
 * the database so that server code, the UI and SQL all agree (PRD #9 §20).
 */
import type { AccessLevel, DataScope, PrismaClient } from "@prisma/client";

import { MODULE_KEYS, modules } from "../../config/modules";
import { PERMISSIONS, moduleForPermission, permissionAction } from "../../config/permissions";
import { roleModuleAccess } from "../../config/role-defaults";
import { ROLE_KEYS, roles } from "../../config/roles";

export async function seedAccessConfiguration(prisma: PrismaClient) {
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

  const roleRows = await prisma.role.findMany();
  const permissionRows = await prisma.permission.findMany();
  const moduleRows = await prisma.module.findMany();

  const roleId = new Map(roleRows.map((row) => [row.key, row.id]));
  const permissionId = new Map(permissionRows.map((row) => [row.key, row.id]));
  const moduleId = new Map(moduleRows.map((row) => [row.key, row.id]));

  // Start from a clean matrix so a removed grant really disappears.
  await prisma.rolePermission.deleteMany({});
  await prisma.roleModuleAccess.deleteMany({});

  const rolePermissionRows: { roleId: string; permissionId: string; scope: DataScope }[] = [];
  const moduleAccessRows: {
    roleId: string;
    moduleId: string;
    accessLevel: AccessLevel;
    scope: DataScope;
  }[] = [];

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

  await prisma.roleModuleAccess.createMany({ data: moduleAccessRows });
  await prisma.rolePermission.createMany({ data: rolePermissionRows, skipDuplicates: true });

  return {
    roles: ROLE_KEYS.length,
    permissions: PERMISSIONS.length,
    modules: MODULE_KEYS.length,
    rolePermissions: rolePermissionRows.length,
    roleModuleAccess: moduleAccessRows.length,
  };
}

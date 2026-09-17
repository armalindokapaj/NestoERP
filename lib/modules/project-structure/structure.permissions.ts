import type { Prisma } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import type { StructureCapabilities } from "./structure.types";

/**
 * Who may see and change which structures (E-05B §58, §59, §78-§82).
 *
 * Authenticated person + the Projects module + the project in their scope + the
 * action's permission. Never "belongs to the same company" alone (§78): an
 * Architect's scope is the projects they are assigned to, so their grant to
 * create units reaches those projects and no others. Buildings, floors and
 * units are reached only through their project, so a reader who cannot open
 * the project learns nothing about its structure — not a unit code, not a
 * building name (§81).
 */

export const MODULE = "projects" as const;
export const BUILDING_ENTITY = "ProjectBuilding";
export const FLOOR_ENTITY = "ProjectFloor";
export const UNIT_ENTITY = "ProjectUnit";

export function structureOpen(context: UserContext): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, "project.view") && can(context, "project.structure.view");
}

/** Projects whose structure this reader can open: the only door to it. */
export function structureProjectDoor(context: UserContext): Prisma.ProjectWhereInput | null {
  return structureOpen(context) ? buildProjectScopeWhere(context) : null;
}

const NOTHING = { id: { in: [] as string[] } };

export function readableBuildingWhere(context: UserContext): Prisma.ProjectBuildingWhereInput {
  const door = structureProjectDoor(context);
  return door ? { companyId: context.companyId, project: { is: door } } : NOTHING;
}

export function readableFloorWhere(context: UserContext): Prisma.ProjectFloorWhereInput {
  const door = structureProjectDoor(context);
  return door ? { companyId: context.companyId, project: { is: door } } : NOTHING;
}

export function readableUnitWhere(context: UserContext): Prisma.ProjectUnitWhereInput {
  const door = structureProjectDoor(context);
  return door ? { companyId: context.companyId, project: { is: door } } : NOTHING;
}

/**
 * What the reader may do to a project they can open. Deciding on the project
 * already being in scope is the caller's job — every service reaches the
 * project through the door before asking.
 */
export function structureCapabilities(context: UserContext): StructureCapabilities {
  const open = structureOpen(context);
  const has = (permission: Parameters<typeof can>[1]) => open && can(context, permission);
  return {
    canManageStructure: has("project.structure.manage"),
    canCreateBuilding: has("project.building.create"),
    canUpdateBuilding: has("project.building.update"),
    canDeleteBuilding: has("project.building.delete"),
    canCreateFloor: has("project.floor.create"),
    canUpdateFloor: has("project.floor.update"),
    canDeleteFloor: has("project.floor.delete"),
    canCreateUnit: has("project.unit.create"),
    canUpdateUnit: has("project.unit.update"),
    canDeleteUnit: has("project.unit.delete"),
    canMoveUnit: has("project.unit.move"),
  };
}

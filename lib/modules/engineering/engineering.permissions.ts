import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Who reaches which engineering records (PRD #46 §175-§193, §241-§255).
 *
 * Authenticated member + company + module + permission + project scope +
 * record + state. Every engineering record belongs to a project and is reached
 * only through that project's door — a guessed id on a project the reader
 * cannot open answers exactly like an id that does not exist (§247, §248). The
 * files behind a record are still Documents, read under Document permissions
 * as well (§249, §253).
 */

export const MODULE = "engineering" as const;
export const DOCUMENT_RECORD = "engineering_document" as const;
export const RFI_RECORD = "rfi" as const;
export const SUBMITTAL_RECORD = "technical_submittal" as const;
export const TRANSMITTAL_RECORD = "transmittal" as const;
export const DOCUMENT_ACTIVITY = "EngineeringDocument";
export const RFI_ACTIVITY = "Rfi";
export const SUBMITTAL_ACTIVITY = "TechnicalSubmittal";
export const TRANSMITTAL_ACTIVITY = "DocumentTransmittal";
/** Integration link type for references from engineering records and work packages (§135, §138). */
export const LINK_TYPE = "ENGINEERING_RECORD";

const NONE = { id: { in: [] as string[] } };

export function engineeringOpen(context: UserContext, permission: Permission = "rfi.view"): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, permission) && can(context, "project.view");
}

export function engineeringProjectDoor(context: UserContext, permission: Permission): Prisma.ProjectWhereInput | null {
  return engineeringOpen(context, permission) ? buildProjectScopeWhere(context) : null;
}

export function readableEngineeringDocumentWhere(context: UserContext): Prisma.EngineeringDocumentWhereInput {
  const door = engineeringProjectDoor(context, "engineering_document.view");
  return door ? { companyId: context.companyId, project: { is: door } } : NONE;
}

export function readableRfiWhere(context: UserContext): Prisma.RfiWhereInput {
  const door = engineeringProjectDoor(context, "rfi.view");
  return door ? { companyId: context.companyId, project: { is: door } } : NONE;
}

export function readableSubmittalWhere(context: UserContext): Prisma.TechnicalSubmittalWhereInput {
  const door = engineeringProjectDoor(context, "submittal.view");
  return door ? { companyId: context.companyId, project: { is: door } } : NONE;
}

export function readableTransmittalWhere(context: UserContext): Prisma.DocumentTransmittalWhereInput {
  const door = engineeringProjectDoor(context, "transmittal.view");
  return door ? { companyId: context.companyId, project: { is: door } } : NONE;
}

/** Whether the reader may see the files on engineering records at all (§127, §253). */
export function filesOpen(context: UserContext): boolean {
  return canAccessModule(context, "documents") && can(context, "document.view");
}

export function filesWritable(context: UserContext): boolean {
  return filesOpen(context) && can(context, "document.create");
}

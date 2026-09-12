import type { MembershipStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { businessDateString } from "@/lib/modules/finance/finance.fields";
import type {
  ItemRef,
  LocationRef,
  MemberRef,
  ModuleLinkRef,
  WarehouseRef,
} from "./inventory.types";

/** The shapes every Inventory DTO shares (PRD #20 §265–§271). */

type MemberRow = {
  id: string;
  status: MembershipStatus;
  user: { firstName: string; lastName: string };
};

export function toMemberRef(row: MemberRow | null | undefined): MemberRef | null {
  if (!row) return null;
  return {
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    active: row.status === "ACTIVE",
  };
}

export async function loadMemberRef(memberId: string | null): Promise<MemberRef | null> {
  if (!memberId) return null;
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  return toMemberRef(member);
}

export function toItemRef(
  row: { id: string; sku: string; name: string; baseUnit: string } | null | undefined,
): ItemRef | null {
  if (!row) return null;
  return { id: row.id, sku: row.sku, name: row.name, baseUnit: row.baseUnit };
}

export function toWarehouseRef(
  row:
    | { id: string; code: string; name: string; warehouseType: WarehouseRef["type"] }
    | null
    | undefined,
): WarehouseRef | null {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, type: row.warehouseType };
}

export function toLocationRef(
  row: { id: string; code: string; name: string | null; warehouseId: string } | null | undefined,
): LocationRef | null {
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, warehouseId: row.warehouseId };
}

/**
 * A link to the document that caused a movement (PRD #20 §179).
 *
 * `href` is null when the reader may see that something caused it but not open
 * the thing itself — a movement never becomes a way into another module.
 */
export function moduleLink(
  id: string,
  label: string,
  href: string,
  reachable: boolean,
): ModuleLinkRef {
  return { id, label, href: reachable ? href : null };
}

export function dateString(value: Date | null | undefined): string | null {
  return value ? businessDateString(value) : null;
}

export function canSeeStock(context: UserContext): boolean {
  return can(context, "inventory.balance.view");
}

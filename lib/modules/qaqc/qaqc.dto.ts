import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { MemberRef, ModuleLinkRef, ProjectRef } from "./qaqc.types";

/**
 * Turning rows into DTOs (PRD #21 §22).
 *
 * Redaction is absence, not a flag. A reader who cannot reach the Procurement
 * delivery behind a material inspection receives `source: null` — not a label
 * with the link removed, which would still tell them a delivery exists and what
 * it was called (PRD #21 §231).
 */

type MemberRow = {
  id: string;
  status?: string;
  user: { firstName: string; lastName: string };
} | null;

export function toMemberRef(row: MemberRow | undefined): MemberRef | null {
  if (!row) return null;
  return {
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    active: row.status === undefined ? true : row.status === "ACTIVE",
  };
}

export async function loadMemberRef(memberId: string | null): Promise<MemberRef | null> {
  if (!memberId) return null;
  const row = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  return toMemberRef(row);
}

/** Loads several members at once, so a list does not fire one query per row. */
export async function loadMembers(
  ids: (string | null | undefined)[],
): Promise<Map<string, MemberRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();

  const rows = await prisma.companyMember.findMany({
    where: { id: { in: wanted } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  return new Map(rows.map((row) => [row.id, toMemberRef(row)!]));
}

export function toProjectRef(
  row: { id: string; code: string; name: string } | null | undefined,
): ProjectRef | null {
  return row ? { id: row.id, code: row.code, name: row.name } : null;
}

export function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Whether a date has passed, for a record that is still open (PRD #21 §38).
 *
 * A closed record is never "overdue": the date it missed is history, and
 * flagging it forever would drown the list that matters.
 */
export function isOverdue(due: Date | null, stillOpen: boolean, today = new Date()): boolean {
  if (!due || !stillOpen) return false;
  return due.getTime() < today.setHours(0, 0, 0, 0);
}

/**
 * The Procurement delivery behind a quality record (PRD #21 §183, §231).
 *
 * Two different questions, answered separately:
 *
 *   - **Which delivery is this inspection about?** A quality fact. A material
 *     inspection is definitionally about a delivery, and an inspector who
 *     cannot see which one cannot do the work at all (§4). `qaqc.material.view`
 *     answers it.
 *   - **May I open Procurement's own pages for it?** A Procurement fact, and a
 *     separate grant. Quality is not a way around Procurement's scope (§183).
 *
 * So the reference appears with the number and without the link for an
 * inspector who holds only quality access.
 */
export function procurementLink(
  context: UserContext,
  receipt: { id: string; receiptNumber: string; purchaseOrderId: string } | null | undefined,
): ModuleLinkRef | null {
  if (!receipt) return null;
  if (!can(context, "qaqc.material.view") && !can(context, "procurement.receipt.view")) {
    return null;
  }

  return {
    id: receipt.id,
    label: receipt.receiptNumber,
    href:
      can(context, "procurement.receipt.view") && can(context, "procurement.order.view")
        ? `/procurement/orders/${receipt.purchaseOrderId}/receipts`
        : null,
  };
}

/** Whether a reader may see quantity figures on a material inspection (§22). */
export function canSeeMaterialFigures(context: UserContext): boolean {
  return can(context, "qaqc.material.view");
}

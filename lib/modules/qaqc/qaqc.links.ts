import { invalidRecordLink } from "@/lib/access/guards";
import { assertSameProject } from "@/lib/access/references";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import {
  buildDefectScopeWhere,
  buildInspectionScopeWhere,
  buildQaqcReceiptWhere,
  buildRequestScopeWhere,
} from "./qaqc.scope";

/**
 * Linked records named in a quality form (PRD #47 §20, §21, §51).
 *
 * An NCR's inspection, a defect's inspection, an inspection's request, the
 * delivery a record is about: every one of those ids arrives in the body, and a
 * database foreign key only proves the row exists — not that it is this
 * company's, or one the caller could open. Each is resolved here through the
 * reader's own scope for that record type before it is written.
 *
 * A link the caller cannot reach answers the same as one that does not exist,
 * naming the field and nothing else, so the form cannot be used to probe.
 */

export async function requireLinkedInspection(
  context: UserContext,
  field: string,
  inspectionId: string,
): Promise<{ id: string; projectId: string | null }> {
  const row = await prisma.qualityInspection.findFirst({
    where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
    select: { id: true, projectId: true },
  });
  if (!row) throw invalidRecordLink(field, "SCOPE_DENIED");
  return row;
}

export async function requireLinkedDefect(
  context: UserContext,
  field: string,
  defectId: string,
): Promise<{ id: string; projectId: string }> {
  const row = await prisma.qualityDefect.findFirst({
    where: { AND: [buildDefectScopeWhere(context), { id: defectId }] },
    select: { id: true, projectId: true },
  });
  if (!row) throw invalidRecordLink(field, "SCOPE_DENIED");
  return row;
}

export async function requireLinkedRequest(
  context: UserContext,
  field: string,
  requestId: string,
): Promise<{ id: string; projectId: string | null; status: string }> {
  const row = await prisma.inspectionRequest.findFirst({
    where: { AND: [buildRequestScopeWhere(context), { id: requestId }] },
    select: { id: true, projectId: true, status: true },
  });
  if (!row) throw invalidRecordLink(field, "SCOPE_DENIED");
  return row;
}

/** A delivery within the reader's quality reach (see `buildQaqcReceiptWhere`). */
export async function requireLinkedReceipt(
  context: UserContext,
  field: string,
  goodsReceiptId: string,
): Promise<{ id: string; projectId: string | null }> {
  const row = await prisma.goodsReceipt.findFirst({
    where: { AND: [buildQaqcReceiptWhere(context), { id: goodsReceiptId }] },
    select: { id: true, projectId: true },
  });
  if (!row) throw invalidRecordLink(field, "SCOPE_DENIED");
  return row;
}

/**
 * A delivery line belongs to the delivery the record names (PRD #47 §20).
 *
 * A line on its own says nothing about whose delivery it is, so one is only
 * accepted alongside the delivery it sits on — never instead of it.
 */
export async function requireLinkedReceiptItem(
  field: string,
  goodsReceiptItemId: string,
  goodsReceiptId: string | null,
): Promise<{ id: string }> {
  if (!goodsReceiptId) throw invalidRecordLink(field, "SCOPE_DENIED");
  const row = await prisma.goodsReceiptItem.findFirst({
    where: { id: goodsReceiptItemId, goodsReceiptId },
    select: { id: true },
  });
  if (!row) throw invalidRecordLink(field, "SCOPE_DENIED");
  return row;
}

/**
 * A project record's links are on the same project (PRD #47 §51).
 *
 * A company-level record — an NCR against a supplier, with no project — may
 * point at project work it can see; a project record may point at company-level
 * records; two different sites never meet.
 */
export function assertLinkOnProject(
  field: string,
  recordProjectId: string | null,
  linkedProjectId: string | null,
): void {
  if (!recordProjectId) return;
  assertSameProject(field, recordProjectId, linkedProjectId, { allowUnlinked: true });
}

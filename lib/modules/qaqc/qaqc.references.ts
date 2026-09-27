import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Ids a quality form names that the database cannot check alone (AUD-09 §5,
 * FV-09). These relations are single-column foreign keys, so another
 * company's row satisfies them: every id is confirmed here to be this
 * company's, and to belong to the parent it is named under, before it is
 * stored. A forged id is refused on the field that carried it.
 */

/**
 * The delivery line a request or inspection is about.
 *
 * `sent` is what the edit names: `undefined` when the form did not carry the
 * field — no quality form renders it, the material flows set it — so the
 * stored line is kept while the delivery stays the same, and dropped when the
 * delivery changes, because a line of another delivery is incompatible
 * (AUD-09 §4, §5, FV-05, FV-10).
 */
export async function resolveReceiptItem(
  context: UserContext,
  input: { sent: string | null | undefined; receiptId: string | null; stored?: { receiptId: string | null; itemId: string | null } },
): Promise<string | null> {
  const { sent, receiptId, stored } = input;
  if (sent === undefined) {
    if (!stored || stored.receiptId !== receiptId) return null;
    return stored.itemId;
  }
  if (!sent) return null;
  if (stored && stored.itemId === sent && stored.receiptId === receiptId) return sent;
  if (!receiptId) {
    throw new AccessError("VALIDATION_ERROR", "Choose the delivery this line belongs to.", { field: "goodsReceiptItemId", code: "INVALID_RECEIPT_ITEM" });
  }
  const item = await prisma.goodsReceiptItem.findFirst({
    where: { id: sent, goodsReceiptId: receiptId, goodsReceipt: { companyId: context.companyId } },
    select: { id: true },
  });
  if (!item) {
    throw new AccessError("VALIDATION_ERROR", "That delivery line does not exist.", { field: "goodsReceiptItemId", code: "INVALID_RECEIPT_ITEM" });
  }
  return item.id;
}

/** The request an inspection answers: this company's, and one the reader could reach. */
export async function requireCompanyRequest(context: UserContext, requestId: string): Promise<{ id: string; projectId: string | null }> {
  const request = await prisma.inspectionRequest.findFirst({
    where: { id: requestId, companyId: context.companyId },
    select: { id: true, projectId: true },
  });
  if (!request) throw new AccessError("VALIDATION_ERROR", "That inspection request does not exist.", { field: "requestId", code: "INVALID_REQUEST" });
  return request;
}

/** The inspection a defect was found in: this company's. */
export async function requireCompanyInspection(context: UserContext, inspectionId: string): Promise<{ id: string; projectId: string | null }> {
  const inspection = await prisma.qualityInspection.findFirst({
    where: { id: inspectionId, companyId: context.companyId },
    select: { id: true, projectId: true },
  });
  if (!inspection) throw new AccessError("VALIDATION_ERROR", "That inspection does not exist.", { field: "inspectionId", code: "INVALID_INSPECTION" });
  return inspection;
}

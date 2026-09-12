import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";

/**
 * Document numbers (PRD #19 §44, §99, §136).
 *
 * Every buying document carries a company-unique reference in a readable
 * series: `PR-2026-0014`, `PO-2026-0007`, `GRN-2026-0031`.
 *
 * Generated inside the same transaction that writes the record, from the
 * highest number already in that year's series, and retried on the unique
 * constraint. Two people raising a request in the same second is the ordinary
 * case, not the exceptional one, so the constraint is the arbiter rather than
 * an application-level lock (PRD #19 §239, §240).
 */

export type NumberedModel = "purchaseRequest" | "purchaseOrder" | "goodsReceipt" | "rFQ";

const FIELD: Record<NumberedModel, string> = {
  purchaseRequest: "requestNumber",
  purchaseOrder: "poNumber",
  goodsReceipt: "receiptNumber",
  rFQ: "rfqNumber",
};

const PREFIX: Record<NumberedModel, string> = {
  purchaseRequest: "PR",
  purchaseOrder: "PO",
  goodsReceipt: "GRN",
  rFQ: "RFQ",
};

/** The next number in this year's series for one company. */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  model: NumberedModel,
  companyId: string,
  today = new Date(),
): Promise<string> {
  const year = today.getUTCFullYear();
  const prefix = `${PREFIX[model]}-${year}-`;
  const field = FIELD[model];

  // The delegate is picked by name because the four models differ only in which
  // column holds the number; a switch would be four copies of one query.
  const delegate = tx[model] as unknown as {
    findFirst(args: unknown): Promise<Record<string, string> | null>;
  };

  const last = await delegate.findFirst({
    where: { companyId, [field]: { startsWith: prefix } },
    orderBy: { [field]: "desc" },
    select: { [field]: true },
  });

  const previous = last?.[field];
  const sequence = previous ? Number.parseInt(previous.slice(prefix.length), 10) : 0;

  if (previous && Number.isNaN(sequence)) {
    throw new AccessError(
      "CONFLICT",
      "The document numbering series is in an unexpected shape. Set the number by hand.",
      { code: "NUMBERING_BROKEN" },
    );
  }

  return `${prefix}${String(sequence + 1).padStart(4, "0")}`;
}

import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";

/**
 * Stock document numbers (PRD #20 §88, §108, §155).
 *
 * `GRN-2026-0007`, `ISS-2026-0031`, and so on: company-unique, readable, and
 * generated inside the transaction that writes the record. The unique
 * constraint is the arbiter when two people post at the same second, which is
 * the ordinary case in a store rather than the exceptional one.
 */

export type NumberedModel =
  | "inventoryReceipt"
  | "stockIssue"
  | "stockReturn"
  | "stockTransfer"
  | "stockAdjustment"
  | "stockReservation";

const FIELD: Record<NumberedModel, string> = {
  inventoryReceipt: "receiptNumber",
  stockIssue: "issueNumber",
  stockReturn: "returnNumber",
  stockTransfer: "transferNumber",
  stockAdjustment: "adjustmentNumber",
  stockReservation: "reservationNumber",
};

const PREFIX: Record<NumberedModel, string> = {
  inventoryReceipt: "GRN",
  stockIssue: "ISS",
  stockReturn: "RET",
  stockTransfer: "TRF",
  stockAdjustment: "ADJ",
  stockReservation: "RSV",
};

export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  model: NumberedModel,
  companyId: string,
  today = new Date(),
): Promise<string> {
  const year = today.getUTCFullYear();
  const prefix = `${PREFIX[model]}-${year}-`;
  const field = FIELD[model];

  // Picked by name because the six models differ only in which column holds the
  // number; a switch would be six copies of one query.
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
      "The document numbering series is in an unexpected shape.",
      { code: "NUMBERING_BROKEN" },
    );
  }

  return `${prefix}${String(sequence + 1).padStart(4, "0")}`;
}

import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";

/**
 * Quality record numbers (PRD #21 §36, §61, §113, §124, §142).
 *
 * `NCR-2026-0007`, `INS-2026-0031`, and so on: company-unique, readable, and
 * generated inside the transaction that writes the record. The unique
 * constraint is the arbiter when two inspectors save at the same second.
 *
 * A quality number is quoted in correspondence and on site paperwork long after
 * the record itself is closed, so it never gets reused and never gets rewritten.
 */

export type NumberedModel =
  | "inspectionRequest"
  | "qualityInspection"
  | "qualityDefect"
  | "nonConformanceReport"
  | "correctiveAction";

const FIELD: Record<NumberedModel, string> = {
  inspectionRequest: "requestNumber",
  qualityInspection: "inspectionNumber",
  qualityDefect: "defectNumber",
  nonConformanceReport: "ncrNumber",
  correctiveAction: "actionNumber",
};

const PREFIX: Record<NumberedModel, string> = {
  inspectionRequest: "IR",
  qualityInspection: "INS",
  qualityDefect: "DEF",
  nonConformanceReport: "NCR",
  correctiveAction: "CA",
};

export async function nextQualityNumber(
  tx: Prisma.TransactionClient,
  model: NumberedModel,
  companyId: string,
  today = new Date(),
): Promise<string> {
  const year = today.getUTCFullYear();
  const prefix = `${PREFIX[model]}-${year}-`;
  const field = FIELD[model];

  // Picked by name because the five models differ only in which column holds
  // the number; a switch would be five copies of one query.
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
      "The quality numbering series is in an unexpected shape.",
      { code: "NUMBERING_BROKEN" },
    );
  }

  return `${prefix}${String(sequence + 1).padStart(4, "0")}`;
}

/**
 * The next reinspection in a chain (PRD #21 §156).
 *
 * Reinspections are numbered by sequence against their parent, so "INS-2026-0031
 * R2" reads as the second re-look at one piece of work rather than as an
 * unrelated inspection that happens to be about the same thing.
 */
export function reinspectionLabel(baseNumber: string, sequence: number): string {
  return `${baseNumber} R${sequence}`;
}

import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";

/**
 * Safety record numbers (PRD #22 §35, §59, §79, §102, §143).
 *
 * `HZ-2026-0112`, `INC-2026-0027`, `PTW-2026-0062`: company-unique, readable,
 * and generated inside the transaction that writes the record, with the unique
 * constraint as the arbiter when two people report at the same second.
 *
 * A permit number is written on a board at the entrance to a confined space and
 * a hazard number is quoted in a site diary, so a number is never reused and
 * never rewritten.
 */

export type NumberedModel =
  | "hseInspection"
  | "hseHazard"
  | "hseIncident"
  | "hseRiskAssessment"
  | "hseAction"
  | "toolboxTalk"
  | "hseWorkPermit"
  | "ppeCheck"
  | "environmentalObservation"
  | "stopWorkRecord";

const FIELD: Record<NumberedModel, string> = {
  hseInspection: "inspectionNumber",
  hseHazard: "hazardNumber",
  hseIncident: "incidentNumber",
  hseRiskAssessment: "assessmentNumber",
  hseAction: "actionNumber",
  toolboxTalk: "talkNumber",
  hseWorkPermit: "permitNumber",
  ppeCheck: "checkNumber",
  environmentalObservation: "observationNumber",
  stopWorkRecord: "stopWorkNumber",
};

const PREFIX: Record<NumberedModel, string> = {
  hseInspection: "HSE-INS",
  hseHazard: "HZ",
  hseIncident: "INC",
  hseRiskAssessment: "RA",
  hseAction: "HSE-ACT",
  toolboxTalk: "TBT",
  hseWorkPermit: "PTW",
  ppeCheck: "PPE",
  environmentalObservation: "ENV",
  stopWorkRecord: "SW",
};

export async function nextHseNumber(
  tx: Prisma.TransactionClient,
  model: NumberedModel,
  companyId: string,
  today = new Date(),
): Promise<string> {
  const year = today.getUTCFullYear();
  const prefix = `${PREFIX[model]}-${year}-`;
  const field = FIELD[model];

  // Picked by name because the ten models differ only in which column holds the
  // number; a switch would be ten copies of one query.
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
      "The HSE numbering series is in an unexpected shape.",
      { code: "NUMBERING_BROKEN" },
    );
  }

  return `${prefix}${String(sequence + 1).padStart(4, "0")}`;
}
